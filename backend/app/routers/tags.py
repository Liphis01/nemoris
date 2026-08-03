from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..models import PackSubscription
from ..schemas import (
    TagActionsRequest,
    TagConflictResolution,
    TagHierarchyUpdate,
    TagInboxResolution
)
from ..services.tag_hierarchy import (
    TagRevisionConflict,
    TagValidationError,
    apply_tag_actions,
    load_tag_hierarchy,
    save_tag_hierarchy,
    tag_inbox,
    tag_snapshot
)


router = APIRouter()


def _subscription_or_404(db, pack_guid):
    subscription = (
        db.query(PackSubscription)
        .filter(PackSubscription.pack_guid == pack_guid)
        .first()
    )
    if not subscription:
        raise HTTPException(status_code=404, detail="Pack introuvable")
    return subscription


@router.get("/tags")
def get_tags(db: Session = Depends(get_db)):
    result = tag_snapshot(db)
    db.commit()
    return result


@router.get("/tags/hierarchy")
def get_hierarchy(db: Session = Depends(get_db)):
    hierarchy = load_tag_hierarchy(db)
    db.commit()
    return hierarchy


@router.put("/tags/hierarchy")
def update_hierarchy(data: TagHierarchyUpdate, db: Session = Depends(get_db)):
    """Compatibility endpoint for older clients.

    Current clients use /tags/actions so a picker or import placement cannot
    overwrite an unrelated branch with a stale full-document snapshot.
    """
    try:
        hierarchy = save_tag_hierarchy(db, data.model_dump())
    except TagRevisionConflict as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"message": str(error), "snapshot": tag_snapshot(db)}
        ) from error
    db.commit()
    return hierarchy


@router.post("/tags/actions")
def update_tags(data: TagActionsRequest, db: Session = Depends(get_db)):
    try:
        _hierarchy, created = apply_tag_actions(
            db,
            data.base_revision,
            [action.model_dump() for action in data.actions]
        )
        result = tag_snapshot(db)
        result["created_ids"] = created
        db.commit()
        return result
    except TagRevisionConflict as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"message": str(error), "snapshot": tag_snapshot(db)}
        ) from error
    except TagValidationError as error:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/tags/inbox")
def get_tag_inbox(db: Session = Depends(get_db)):
    result = tag_inbox(db)
    db.commit()
    return result


@router.post("/tags/inbox/resolve")
def resolve_tag_inbox(data: TagInboxResolution, db: Session = Depends(get_db)):
    subscription = _subscription_or_404(db, data.pack_guid)
    entries = list(subscription.tag_pending or [])
    entry = next(
        (item for item in entries if item.get("tag_id") == data.tag_id),
        None
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Élément à classer introuvable")

    if data.action == "defer":
        entry["status"] = "deferred"
    else:
        hierarchy = load_tag_hierarchy(db)
        if data.action == "place":
            if not data.parent_id:
                raise HTTPException(status_code=422, detail="Parent requis")
            action = {
                "type": "set_parents",
                "tag_id": data.tag_id,
                "parent_ids": [data.parent_id]
            }
        elif data.action == "merge":
            if not data.target_id:
                raise HTTPException(status_code=422, detail="Tag cible requis")
            action = {
                "type": "merge",
                "tag_id": data.tag_id,
                "target_id": data.target_id
            }
        else:
            action = {"type": "accept_root", "tag_id": data.tag_id}

        try:
            apply_tag_actions(db, hierarchy["revision"], [action])
        except TagValidationError as error:
            db.rollback()
            raise HTTPException(status_code=422, detail=str(error)) from error
        entry["status"] = "resolved"

    subscription.tag_pending = entries
    result = tag_snapshot(db)
    db.commit()
    return result


@router.post("/tags/conflicts/resolve")
def resolve_tag_conflict(
    data: TagConflictResolution,
    db: Session = Depends(get_db)
):
    subscription = _subscription_or_404(db, data.pack_guid)
    conflicts = list(subscription.tag_conflicts or [])
    conflict = next(
        (item for item in conflicts if item.get("id") == data.conflict_id),
        None
    )
    if not conflict:
        raise HTTPException(status_code=404, detail="Conflit introuvable")

    if data.choice == "pack":
        hierarchy = load_tag_hierarchy(db)
        field = conflict.get("field") or ""
        if field == "parents":
            action = {
                "type": "set_parents",
                "tag_id": conflict.get("tag_id"),
                "parent_ids": conflict.get("incoming") or []
            }
        elif field.startswith("label:"):
            locale = field.split(":", 1)[1]
            action = (
                {
                    "type": "set_label",
                    "tag_id": conflict.get("tag_id"),
                    "locale": locale,
                    "label": conflict.get("incoming")
                }
                if conflict.get("incoming") is not None
                else {
                    "type": "remove_label",
                    "tag_id": conflict.get("tag_id"),
                    "locale": locale
                }
            )
        else:
            raise HTTPException(status_code=422, detail="Type de conflit inconnu")
        try:
            apply_tag_actions(db, hierarchy["revision"], [action])
        except TagValidationError as error:
            db.rollback()
            raise HTTPException(status_code=422, detail=str(error)) from error

    conflict["status"] = "resolved"
    conflict["resolution"] = data.choice
    subscription.tag_conflicts = conflicts
    result = tag_snapshot(db)
    db.commit()
    return result
