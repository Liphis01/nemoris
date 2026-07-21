"""Fake / reference sync server (M2 slice 1).

Run it with:  uvicorn sync_server.main:app --port 9000
Data dir override:  SYNC_SERVER_DATA_DIR=/path uvicorn sync_server.main:app ...

Thin HTTP layer over sync_server.store.SyncStore. The per-device backend's
sync client talks to this over plain HTTP (raw-binary zip bodies, metadata in
query/headers — no multipart, so the client stays stdlib-urllib only). This
same app is what a "self-hosted" deployment would run; a managed backend
(Supabase) would instead adapt the store operations behind the same protocol.
"""

import os
from pathlib import Path

from fastapi import Body, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import Response

from .store import SyncAuthError, SyncConflict, SyncStore


DATA_DIR = Path(
    os.environ.get("SYNC_SERVER_DATA_DIR", Path(__file__).resolve().parent / "data")
)
store = SyncStore(DATA_DIR)
app = FastAPI(title="Nemoris sync server (fake)")


def _account(authorization):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    try:
        return store.account_for_token(authorization[len("Bearer "):])
    except SyncAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error


@app.post("/auth/request-code")
def request_code(payload: dict = Body(...)):
    try:
        code = store.request_code(payload.get("email"))
    except SyncAuthError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    # A real server emails this; the fake returns it so the flow is testable.
    return {"code": code}


@app.post("/auth/verify")
def verify(payload: dict = Body(...)):
    try:
        token = store.verify(payload.get("email"), payload.get("code"))
    except SyncAuthError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return {"token": token}


@app.get("/collection/meta")
def collection_meta(authorization: str = Header(None)):
    return store.get_meta(_account(authorization))


@app.post("/collection")
async def push_collection(
    request: Request,
    base_version: int = Query(0),
    schema_version: str = Query(""),
    device_id: str = Query(""),
    force: bool = Query(False),
    authorization: str = Header(None)
):
    email = _account(authorization)
    zip_bytes = await request.body()

    try:
        return store.push(
            email,
            base_version=base_version,
            schema_version=schema_version,
            zip_bytes=zip_bytes,
            device_id=device_id or None,
            force=force
        )
    except SyncConflict as conflict:
        raise HTTPException(
            status_code=409,
            detail={"server_version": conflict.server_version}
        ) from conflict


@app.get("/collection")
def pull_collection(authorization: str = Header(None)):
    result = store.pull(_account(authorization))

    if result is None:
        raise HTTPException(status_code=404, detail="No collection yet")

    return Response(
        content=result["zip_bytes"],
        media_type="application/zip",
        headers={
            "X-Collection-Version": str(result["version"]),
            "X-Schema-Version": result["schema_version"] or ""
        }
    )
