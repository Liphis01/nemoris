from typing import Literal, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..services.study_summary import build_study_scope_summary


router = APIRouter()


@router.get("/study/summary")
def get_study_summary(
    scope_type: Literal["group", "tag", "collection", "pack"],
    group_id: Optional[int] = None,
    collection_id: Optional[int] = None,
    tag: Optional[str] = None,
    pack_guid: Optional[str] = None,
    db: Session = Depends(get_db)
):
    return build_study_scope_summary(
        db,
        scope_type,
        group_id=group_id,
        collection_id=collection_id,
        tag=tag,
        pack_guid=pack_guid
    )
