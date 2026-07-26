from fastapi import APIRouter, HTTPException

from ..schemas import ProfileUpdateRequest
from ..services.profile import (
    ProfileAuthError,
    ProfileConflictError,
    ProfileError,
    get_profile_status,
    save_profile
)


router = APIRouter()


@router.get("/profile")
def read_profile():
    try:
        return get_profile_status()
    except ProfileAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except ProfileError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.put("/profile")
def update_profile(payload: ProfileUpdateRequest):
    try:
        return save_profile(payload.username, payload.avatar_emoji, payload.avatar_color)
    except ProfileConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ProfileAuthError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    except ProfileError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
