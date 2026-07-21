from fastapi import APIRouter, Body, HTTPException, Query

from ..services.sync import (
    code_schema_version,
    delete_account_data as delete_account_data_service,
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
from ..services.supabase_sync_client import SupabaseSyncClient
from ..services.sync_state import is_signed_in, load_sync_state, save_sync_state


router = APIRouter()


def _persist_rotated_tokens(token):
    state = load_sync_state()
    state["token"] = token
    save_sync_state(state)


def _build_client(state):
    url = state.get("server_url") or ""
    key = state.get("server_key") or ""

    # A publishable key (or a supabase.co URL) selects the Supabase adapter;
    # otherwise it's our own reference protocol (fake/self-hosted server).
    if key or ".supabase.co" in url:
        return SupabaseSyncClient(
            url, key, on_tokens_updated=_persist_rotated_tokens
        )

    return HttpSyncClient(url)


def _client():
    try:
        return _build_client(load_sync_state())
    except SyncClientError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def _status_payload():
    state = load_sync_state()
    payload = {
        "signed_in": is_signed_in(state),
        "account_email": state.get("account_email"),
        "server_url": state.get("server_url", ""),
        "server_key": state.get("server_key", ""),
        "last_server_version": state.get("last_server_version", 0),
        "code_schema_version": code_schema_version(),
        "server_meta": None
    }

    if payload["signed_in"] and payload["server_url"]:
        # Best-effort: a signed-in status still returns even if the server is
        # briefly unreachable.
        try:
            payload["server_meta"] = _build_client(state).get_meta(
                state["token"]
            )
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

    if "key" in payload:
        state["server_key"] = str(payload.get("key") or "").strip()

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


@router.delete("/sync/account-data")
def delete_account_data():
    # Wipes this account's cloud DATA (collection + media); the underlying
    # login identity is untouched (see services/supabase_sync_client.py —
    # this app never holds the key needed to delete an Auth identity).
    try:
        delete_account_data_service(_client())
    except SyncClientAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except (SyncClientError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return _status_payload()
