from fastapi import APIRouter, Body, HTTPException, Query

from ..services.sync import (
    code_schema_version,
    pull as pull_collection,
    push as push_collection,
    sign_in_request_code,
    sign_in_verify,
    sign_out as sign_out_account
)
from ..services.sync_client import (
    HttpSyncClient,
    SyncClientAuthError,
    SyncClientConflict,
    SyncClientError
)
from ..services.sync_state import is_signed_in, load_sync_state, save_sync_state


router = APIRouter()


def _client():
    state = load_sync_state()

    try:
        return HttpSyncClient(state.get("server_url"))
    except SyncClientError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def _status_payload():
    state = load_sync_state()
    payload = {
        "signed_in": is_signed_in(state),
        "account_email": state.get("account_email"),
        "server_url": state.get("server_url", ""),
        "last_server_version": state.get("last_server_version", 0),
        "code_schema_version": code_schema_version(),
        "server_meta": None
    }

    if payload["signed_in"] and payload["server_url"]:
        # Best-effort: a signed-in status still returns even if the server is
        # briefly unreachable.
        try:
            payload["server_meta"] = HttpSyncClient(
                payload["server_url"]
            ).get_meta(state["token"])
        except SyncClientError:
            payload["server_meta"] = None

    return payload


@router.get("/sync/status")
def sync_status():
    return _status_payload()


@router.put("/sync/server-url")
def set_sync_server_url(payload: dict = Body(...)):
    state = load_sync_state()
    state["server_url"] = str(payload.get("url") or "").strip().rstrip("/")
    save_sync_state(state)

    return _status_payload()


@router.post("/sync/request-code")
def request_code(payload: dict = Body(...)):
    try:
        return sign_in_request_code(_client(), payload.get("email"))
    except (SyncClientError,) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/sync/verify")
def verify(payload: dict = Body(...)):
    try:
        sign_in_verify(_client(), payload.get("email"), payload.get("code"))
    except SyncClientAuthError as error:
        raise HTTPException(status_code=400, detail="Invalid code") from error
    except SyncClientError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return _status_payload()


@router.post("/sync/push")
def push(force: bool = Query(False)):
    try:
        return push_collection(_client(), force=force)
    except SyncClientConflict as conflict:
        # Returned as a normal 200 body (not a 409) so the frontend's flat
        # requestJson can read the structured server_version instead of
        # collapsing it into a string error message.
        return {"status": "conflict", "server_version": conflict.server_version}
    except SyncClientAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except (SyncClientError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/sync/pull")
def pull():
    try:
        return pull_collection(_client())
    except SyncClientAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except (SyncClientError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/sync/sign-out")
def sign_out():
    sign_out_account()

    return _status_payload()
