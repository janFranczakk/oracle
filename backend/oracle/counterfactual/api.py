"""Injected session / worker ownership avoids a second simulation or inference service."""

import asyncio
import importlib.util
from collections.abc import Callable
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from oracle.counterfactual.plans import PlanStore, capture_snapshot, preview_change
from oracle.counterfactual.schema import AnchorRequest, CreateBranch, ExecutionRequest, Plan
from oracle.prediction.service import PredictionService
from oracle.session import Session


def create_router(
    get_session: Callable[[str], Session], store: PlanStore, service: PredictionService
) -> APIRouter:
    router = APIRouter(prefix="/api/sessions/{sid}/counterfactual")

    def get_plan(sid: str, plan_id: str) -> Plan:
        get_session(sid)
        try:
            return store.get(sid, plan_id)
        except KeyError as exc:
            raise HTTPException(404, "This source has expired. Restore its saved plan.") from exc

    def failure(exc: Exception) -> HTTPException:
        if isinstance(exc, RuntimeError):
            return HTTPException(409, str(exc))
        return HTTPException(
            422,
            str(exc)
            if isinstance(exc, ValueError) and not isinstance(exc, ValidationError)
            else "The source or interventions are incompatible. Check their values.",
        )

    @router.post("/capture")
    async def capture(sid: str, request: AnchorRequest) -> dict:
        try:
            return store.put(sid, capture_snapshot(get_session(sid), request))
        except (ValueError, RuntimeError) as exc:
            raise failure(exc) from exc

    @router.post("/import")
    async def restore(sid: str, plan: Plan) -> dict:
        get_session(sid)
        try:
            plan.id = uuid4().hex
            await asyncio.to_thread(
                service.run_counterfactual,
                {"operation": "validate", "plan": plan.model_dump(mode="json")},
            )
            get_session(sid)
            return store.put(sid, plan)
        except (ValueError, RuntimeError, KeyError, TypeError, OSError) as exc:
            raise failure(exc) from exc

    @router.post("/{plan_id}/preview")
    async def preview(sid: str, plan_id: str, request: CreateBranch) -> dict:
        try:
            return preview_change(
                get_plan(sid, plan_id), request.parent_id, request.changes
            ).model_dump(mode="json")
        except (ValueError, RuntimeError, KeyError, TypeError) as exc:
            raise failure(exc) from exc

    @router.post("/{plan_id}/branches")
    async def branch(sid: str, plan_id: str, request: CreateBranch) -> dict:
        get_plan(sid, plan_id)
        try:
            return store.add(sid, plan_id, request)
        except (ValueError, RuntimeError, KeyError, TypeError) as exc:
            raise failure(exc) from exc

    async def run(
        sid: str, plan_id: str, branch_id: str, request: ExecutionRequest, operation: str
    ) -> dict:
        plan = get_plan(sid, plan_id)
        if branch_id not in {b.id for b in plan.branches}:
            raise HTTPException(404, "This branch no longer exists")
        context = {
            "operation": operation,
            "plan": plan.model_dump(mode="json"),
            "branch_id": branch_id,
            "request": request.model_dump(mode="json"),
        }
        try:
            if operation == "predict":
                if importlib.util.find_spec("torch") is None:
                    raise HTTPException(
                        503, "Install the documented ML dependencies before predicting."
                    )
                if request.model_id is None:
                    raise ValueError("Choose a completed model before predicting")
                context["model"] = service.catalog.describe(request.model_id).model_dump(
                    mode="json"
                )
            result = await asyncio.to_thread(service.run_counterfactual, context)
            get_session(sid)
            comparison = store.record_future(sid, result)
            return {**result, "comparison": comparison}
        except (ValueError, RuntimeError, KeyError, TypeError, OSError) as exc:
            raise failure(exc) from exc

    @router.post("/{plan_id}/{branch_id}/predict")
    async def predict(sid: str, plan_id: str, branch_id: str, request: ExecutionRequest) -> dict:
        return await run(sid, plan_id, branch_id, request, "predict")

    @router.post("/{plan_id}/{branch_id}/reality")
    async def reality(sid: str, plan_id: str, branch_id: str, request: ExecutionRequest) -> dict:
        return await run(sid, plan_id, branch_id, request, "reality")

    return router
