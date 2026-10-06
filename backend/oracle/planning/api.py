"""Frozen search and explicit reality share the existing bounded prediction supervisor."""

import asyncio
import importlib.util
from collections.abc import Callable

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from oracle.counterfactual.plans import capture_snapshot
from oracle.counterfactual.schema import AnchorRequest
from oracle.planning.schema import SearchRequest
from oracle.planning.store import PlanningStore, reality_context, verification
from oracle.prediction.service import PredictionService
from oracle.session import Session


def create_router(
    get_session: Callable[[str], Session], store: PlanningStore, service: PredictionService
):
    router = APIRouter(prefix="/api/sessions/{sid}/planning", tags=["Learned rollout planning"])

    def failure(exc: Exception):
        return HTTPException(
            409 if isinstance(exc, RuntimeError) else 422,
            str(exc)
            if type(exc) in {ValueError, RuntimeError}
            else "Planning inputs are incompatible. Check the source and model.",
        )

    def get_report(sid: str, identity: str):
        get_session(sid)
        try:
            return store.get(sid, identity)
        except KeyError as exc:
            raise HTTPException(
                404, "This planning report expired. Search again or use its export."
            ) from exc

    @router.post("/search")
    async def search(sid: str, request: SearchRequest):
        if importlib.util.find_spec("torch") is None:
            raise HTTPException(503, "Install the documented ML dependencies before planning.")
        try:
            plan = capture_snapshot(
                get_session(sid),
                AnchorRequest.model_validate(
                    request.model_dump(include={"generation", "anchor_tick", "revision"})
                ),
            )
            context = {
                "operation": "search",
                "plan": plan.model_dump(mode="json"),
                "request": request.model_dump(mode="json"),
                "model": service.catalog.describe(request.model_id).model_dump(mode="json"),
            }
            result = await asyncio.to_thread(service.run_planning, context)
            get_session(sid)
            return store.put(sid, result)
        except (ValueError, RuntimeError, KeyError, TypeError, OSError, ValidationError) as exc:
            raise failure(exc) from exc

    @router.get("/{identity}")
    def detail(sid: str, identity: str):
        return get_report(sid, identity)

    @router.post("/{identity}/reality")
    async def reality(sid: str, identity: str):
        report = get_report(sid, identity)
        try:
            result = await asyncio.to_thread(service.run_planning, reality_context(report))
            get_report(sid, identity)
            return store.put(sid, {**report, "verification": verification(report, result)})
        except (ValueError, RuntimeError, KeyError, TypeError, OSError) as exc:
            raise failure(exc) from exc

    return router
