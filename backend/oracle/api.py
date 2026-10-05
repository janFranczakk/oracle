"""Local, per-session API. Simulation ticks at 120 Hz; clients receive 20 Hz transforms."""

import asyncio
import contextlib
import math
import time
from contextlib import asynccontextmanager
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import Field, ValidationError

from oracle.datasets.api import router as dataset_router
from oracle.scenes import scene
from oracle.session import Session
from oracle.training.api import router as training_router
from oracle.world import BodyState, EditEvent, Experiment, StrictModel

sessions: dict[str, Session] = {}
clients: dict[str, set[WebSocket]] = {}
last_revision: dict[str, int] = {}


async def broadcast(session_id: str, full: bool = True) -> None:
    session = sessions.get(session_id)
    if session is None:
        return
    payload = session.payload(full)
    for ws in tuple(clients.get(session_id, set())):
        try:
            await asyncio.wait_for(ws.send_json(payload), timeout=0.25)
        except (RuntimeError, OSError, TimeoutError, WebSocketDisconnect):
            clients[session_id].discard(ws)


async def simulation_loop() -> None:
    previous = time.monotonic()
    accumulators: dict[str, float] = {}
    while True:
        await asyncio.sleep(0.05)
        now = time.monotonic()
        elapsed = min(now - previous, 0.2)
        previous = now
        for sid, session in list(sessions.items()):
            if not clients.get(sid):
                session.playing = False
                if now - session.last_active > 1800:
                    sessions.pop(sid, None)
                    clients.pop(sid, None)
                    accumulators.pop(sid, None)
                    last_revision.pop(sid, None)
                continue
            if session.playing:
                accumulator = accumulators.get(sid, 0) + elapsed * session.speed
                steps = int(accumulator / session.origin.environment.dt)
                accumulators[sid] = accumulator - steps * session.origin.environment.dt
                if steps:
                    session.advance(steps)
                    await broadcast(sid, full=last_revision.get(sid) != session.revision)
                    last_revision[sid] = session.revision
            else:
                accumulators[sid] = 0


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(simulation_loop())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="ORACLE · Research API", version="0.3.0", lifespan=lifespan)
app.include_router(dataset_router)
app.include_router(training_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5181", "http://127.0.0.1:5181"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class CreateSession(StrictModel):
    seed: int = Field(default=42, ge=0, le=2**32 - 1)
    scene: Literal["incline", "collision", "empty"] = "incline"


class Command(StrictModel):
    kind: Literal["play", "pause", "step", "seek", "speed", "reset", "edit", "add", "remove"]
    tick: int = Field(default=0, ge=0, le=14400)
    steps: int = Field(default=1, ge=1, le=600)
    speed: Literal[0.25, 0.5, 1, 2, 4] = 1
    object_id: str | None = None
    object: BodyState | None = None
    patch: dict = Field(default_factory=dict)


def get_session(sid: str) -> Session:
    if sid not in sessions:
        raise HTTPException(404, "This session has expired. Reconnect to create a world.")
    sessions[sid].last_active = time.monotonic()
    return sessions[sid]


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "engine": "pymunk-7.2.0",
        "tick_hz": 120,
        "stream_hz": 20,
        "model_available": False,
    }


@app.post("/api/sessions")
def create(config: CreateSession) -> dict:
    if len(sessions) >= 16:
        raise HTTPException(503, "Local session capacity reached. Restart the backend to clear it.")
    sid = uuid4().hex
    sessions[sid] = Session(scene(config.seed, config.scene))
    return {"id": sid, "state": sessions[sid].payload()}


@app.get("/api/sessions/{sid}")
def state(sid: str) -> dict:
    return get_session(sid).payload()


@app.post("/api/sessions/{sid}/scene")
async def configure_scene(sid: str, config: CreateSession) -> dict:
    get_session(sid)
    sessions[sid] = Session(scene(config.seed, config.scene))
    await broadcast(sid)
    return sessions[sid].payload()


@app.post("/api/sessions/{sid}/commands")
async def command(sid: str, cmd: Command) -> dict:
    session = get_session(sid)
    try:
        match cmd.kind:
            case "play":
                session.playing = session.engine.tick < 14400
            case "pause":
                session.playing = False
            case "step":
                session.playing = False
                session.advance(cmd.steps)
            case "seek":
                session.seek(cmd.tick)
            case "speed":
                session.speed = float(cmd.speed)
            case "reset":
                # New recording with the original scene and seed; edits are intentionally discarded.
                sessions[sid] = Session(session.origin)
            case "edit":
                session.update(cmd.object_id or "", cmd.patch)
            case "add":
                if cmd.object is None or cmd.object.id in session.engine.bodies:
                    raise ValueError("Provide an object with a new identifier")
                session.edit(EditEvent(tick=0, kind="upsert", object=cmd.object))
            case "remove":
                session.edit(EditEvent(tick=0, kind="remove", object_id=cmd.object_id))
    except (ValueError, ValidationError) as exc:
        detail = (
            "Invalid object properties. Check the allowed ranges."
            if isinstance(exc, ValidationError)
            else str(exc)
        )
        raise HTTPException(422, detail) from exc
    await broadcast(sid)
    last_revision[sid] = sessions[sid].revision
    return sessions[sid].payload()


@app.get("/api/sessions/{sid}/history")
def history(sid: str) -> dict:
    session = get_session(sid)
    # At most 241 display samples; this is observed history, never a future trajectory.
    stride = max(1, math.ceil(session.duration / 240))
    indices = list(range(0, session.duration + 1, stride))
    if indices[-1] != session.duration:
        indices.append(session.duration)
    return {"frames": [session.history[i].model_dump() for i in indices]}


@app.get("/api/sessions/{sid}/export")
def export(sid: str) -> dict:
    return get_session(sid).export().model_dump()


@app.post("/api/sessions/{sid}/restore")
async def restore(sid: str, experiment: Experiment) -> dict:
    get_session(sid)
    try:
        # Replay in a worker to avoid blocking the stream for other sessions.
        restored = await asyncio.to_thread(Session.restore, experiment)
    except (ValueError, KeyError) as exc:
        raise HTTPException(
            422, "Malformed experiment: its edit history cannot be replayed."
        ) from exc
    sessions[sid] = restored
    await broadcast(sid)
    return restored.payload()


@app.websocket("/ws/{sid}")
async def stream(ws: WebSocket, sid: str) -> None:
    if sid not in sessions:
        await ws.close(code=1008)
        return
    await ws.accept()
    clients.setdefault(sid, set()).add(ws)
    try:
        await ws.send_json(sessions[sid].payload())
        while True:
            await ws.receive_text()
            sessions[sid].last_active = time.monotonic()
    except (WebSocketDisconnect, RuntimeError, KeyError):
        pass
    finally:
        clients[sid].discard(ws)
