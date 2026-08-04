from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Annotated, Optional, List, Literal, Any, Dict, Union
from datetime import date

from .services.svg_maps.contracts import MapImportOntology, validate_map_package


QuestionType = Literal[
    "text",
    "map",
    "timeline",
    "media",
    "sequence"
]

GroupType = Literal[
    "map",
    "media",
    "text",
    "sequence"
]

MapMode = Literal[
    "type_all",
    "click_prompt",
    "type_prompt",
    "multiple_choice"
]

ImageMode = Literal[
    "type_all",
    "type_prompt",
    "multiple_choice_label",
    "multiple_choice_image"
]

TextMode = Literal[
    "type_all",
    "match"
]

SequenceMode = Literal[
    "type_position",
    "next_in_sequence",
    "multiple_choice",
    "reorder"
]

TrainingGroupMode = Literal[
    "type_all",
    "click_prompt",
    "type_prompt",
    "multiple_choice",
    "multiple_choice_label",
    "multiple_choice_image",
    "match",
    "type_position",
    "next_in_sequence",
    "reorder"
]


# =========================================================
# GROUPS
# =========================================================

class GroupCreate(BaseModel):

    type_group: GroupType

    name: str = Field(
        min_length=1,
        max_length=100
    )

    media: Optional[str] = None

    data: dict[str, Any] = Field(
        default_factory=dict
    )

    @field_validator("data")
    @classmethod
    def validate_map_data(cls, value):
        if isinstance(value, dict) and value.get("map") is not None:
            validate_map_package(value["map"])
        return value


class GroupUpdate(BaseModel):

    name: Optional[str] = None

    media: Optional[str] = None

    data: Optional[dict[str, Any]] = None

    @field_validator("data")
    @classmethod
    def validate_map_data(cls, value):
        if isinstance(value, dict) and value.get("map") is not None:
            validate_map_package(value["map"])
        return value


class GroupOut(BaseModel):

    id: int

    type_group: GroupType

    name: str

    media: Optional[str]

    data: dict[str, Any]

    class Config:
        from_attributes = True


class GroupSuspend(BaseModel):
    suspended: bool


class GroupMini(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


# =========================================================
# QUESTIONS
# =========================================================

class QuestionCreate(BaseModel):

    question: str = Field(min_length=1)

    answer: Optional[str] = ""

    type_q: QuestionType = "text"

    media: Optional[str] = None

    answer_media: Optional[str] = None

    tags: List[str] = Field(default_factory=list)

    group_id: Optional[int] = None

    data: dict[str, Any] = Field(default_factory=dict)

    collection_ids: List[int] = Field(default_factory=list)


class QuestionUpdate(BaseModel):

    question: Optional[str] = None

    answer: Optional[str] = None

    type_q: Optional[QuestionType] = None

    media: Optional[str] = None

    answer_media: Optional[str] = None

    tags: Optional[List[str]] = None

    group_id: Optional[int] = None

    data: Optional[dict[str, Any]] = None

    collection_ids: Optional[List[int]] = None

    # Set aside by the user: excluded from reviews and from automatic intake.
    suspended: Optional[bool] = None


class QuestionOut(BaseModel):

    id: int

    type_q: QuestionType

    question: Optional[str]

    answer: Optional[str]

    media: Optional[str]

    answer_media: Optional[str] = None

    tags: List[str]

    group_id: Optional[int]

    data: Optional[dict[str, Any]] = None

    suspended: bool = False

    class Config:
        from_attributes = True


class SetCollections(BaseModel):
    collection_ids: List[int]


class MediaUrlImport(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class MapImportUrlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    expected_zone_count: Optional[int] = Field(default=None, ge=1, le=50000)
    name: Optional[str] = Field(default=None, max_length=100)
    ontology: MapImportOntology = "auto"


class MapImportPatchRequest(BaseModel):
    expected_zone_count: Optional[int] = Field(default=None, ge=1, le=50000)
    acknowledgements: Optional[List[str]] = None
    ontology: Optional[MapImportOntology] = None
    selected_interpretation_id: Optional[str] = Field(
        default=None, max_length=64
    )


class MapImportCommitRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)


class MapRepairInitializeRequest(BaseModel):
    interpretation_id: str = Field(min_length=1, max_length=64)


class MapRepairCreateZoneAction(BaseModel):
    type: Literal["create_zone"]
    shape_refs: List[str] = Field(min_length=1, max_length=50000)


class MapRepairAssignToZoneAction(BaseModel):
    type: Literal["assign_to_zone"]
    shape_refs: List[str] = Field(min_length=1, max_length=50000)
    zone_id: str = Field(min_length=1, max_length=32)


class MapRepairSetRoleAction(BaseModel):
    type: Literal["set_role"]
    shape_refs: List[str] = Field(min_length=1, max_length=50000)
    role: Literal["unresolved", "decoration", "label", "excluded"]


class MapRepairMergeZonesAction(BaseModel):
    type: Literal["merge_zones"]
    zone_ids: List[str] = Field(min_length=2, max_length=50000)
    primary_zone_id: str = Field(min_length=1, max_length=32)


class MapRepairExplodeZoneAction(BaseModel):
    type: Literal["explode_zone"]
    zone_id: str = Field(min_length=1, max_length=32)


class MapRepairHistoryAction(BaseModel):
    type: Literal["undo", "redo", "reset_branch"]


MapRepairAction = Annotated[
    Union[
        MapRepairCreateZoneAction,
        MapRepairAssignToZoneAction,
        MapRepairSetRoleAction,
        MapRepairMergeZonesAction,
        MapRepairExplodeZoneAction,
        MapRepairHistoryAction,
    ],
    Field(discriminator="type"),
]


class MapRepairActionRequest(BaseModel):
    base_revision: int = Field(ge=0)
    action: MapRepairAction


class PackExportRequest(BaseModel):
    version: Optional[int] = Field(default=None, ge=1)
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    license: str = Field(default="", max_length=200)


class PackPublishDraftRequest(PackExportRequest):
    tags: List[str] = Field(default_factory=list, max_length=20)
    themes: List[str] = Field(default_factory=list, max_length=12)


class PackInstallRecordRequest(BaseModel):
    installed_version: int = Field(default=1, ge=1)


class PackRatingRequest(BaseModel):
    rating: int = Field(ge=1, le=5)


class PackCommentCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class ProfileUpdateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=20)
    avatar_emoji: str = Field(min_length=1, max_length=16)
    avatar_color: str = Field(min_length=1, max_length=20)


AnswerQuality = Annotated[int, Field(ge=0, le=3)]


class AnswerRequest(BaseModel):
    question_id: int

    # 0 = Again/Faux, 1 = Hard/Dur, 2 = Good/Bon, 3 = Easy/Facile
    quality: AnswerQuality
    review_date: Optional[date] = None


class RelearningGraduateRequest(BaseModel):
    # "Acquis": the user finished relearning these cards this session. It carries
    # no grade -- the schedule is derived from the frozen first-fail state.
    question_ids: List[int]
    review_date: Optional[date] = None


PaceTier = Literal[
    "leger",
    "regulier",
    "soutenu",
    "intensif"
]


class ReviewSettings(BaseModel):
    # Either form is accepted: a tier (which sets the number) or the raw number
    # kept for users predating the tiers. Both optional so the older payload
    # shape still validates; at least one must be present.
    catchup_daily_target: Optional[int] = Field(
        default=None,
        ge=1,
        le=10000
    )
    pace_tier: Optional[PaceTier] = None

    @model_validator(mode="after")
    def require_a_target(self):
        if self.catchup_daily_target is None and self.pace_tier is None:
            raise ValueError(
                "catchup_daily_target or pace_tier is required"
            )

        return self


class SyncPreferences(BaseModel):
    auto_sync_enabled: bool = False


class MapAnswerRequest(BaseModel):
    items: Dict[int, AnswerQuality]
    mode: Optional[MapMode] = None
    context_count: Optional[int] = Field(default=None, ge=0)
    review_date: Optional[date] = None


class MediaAnswerRequest(BaseModel):
    items: Dict[int, AnswerQuality]
    mode: Optional[ImageMode] = None
    context_count: Optional[int] = Field(default=None, ge=0)
    review_date: Optional[date] = None


class TextAnswerRequest(BaseModel):
    items: Dict[int, AnswerQuality]
    mode: Optional[TextMode] = None
    context_count: Optional[int] = Field(default=None, ge=0)
    review_date: Optional[date] = None


TimelinePrecision = Literal[
    "year",
    "month",
    "day"
]


class TimelineDateValue(BaseModel):
    year: int
    month: Optional[int] = None
    day: Optional[int] = None
    precision: TimelinePrecision


class TimelineAnswerItem(BaseModel):
    start: TimelineDateValue
    end: Optional[TimelineDateValue] = None
    # The learner's felt-difficulty on a correct answer. None means "use the
    # auto grade from distance". The server never lets this upgrade a miss
    # (see reconcile_timeline_quality), so it can only refine a genuine hit.
    quality: Optional[AnswerQuality] = None


class TimelineAnswerRequest(BaseModel):
    items: Dict[int, TimelineAnswerItem]
    review_date: Optional[date] = None


class SequenceAnswerItem(BaseModel):
    # The rank the player's answer lands on. None means "no answer resolved"
    # (blank input, unmatched label) and always grades as a miss. An object
    # rather than a bare int so a future server-resolved `text` field can be
    # added without breaking the endpoint.
    position: Optional[int] = Field(default=None, ge=1)


class SequenceAnswerRequest(BaseModel):
    items: Dict[int, SequenceAnswerItem]
    mode: Optional[SequenceMode] = None
    context_count: Optional[int] = Field(default=None, ge=0)
    review_date: Optional[date] = None


class TrainingAttemptRecordRequest(BaseModel):
    elapsed_ms: int = Field(gt=0)
    question_count: int = Field(ge=0)
    found_count: int = Field(ge=0)
    content_fingerprint: str = Field(min_length=1)
    mode: Optional[TrainingGroupMode] = None


class MapZoneBulkItem(BaseModel):

    id: Optional[int] = None

    code: str = Field(
        min_length=1
    )

    answer: Optional[str] = ""

    aliases: List[str] = Field(
        default_factory=list
    )


class MapZonesGroupUpdate(BaseModel):

    name: Optional[str] = None

    media: Optional[str] = None

    tags: Optional[List[str]] = None


class MapZonesBulkUpdate(BaseModel):

    group: Optional[MapZonesGroupUpdate] = None

    zones: List[MapZoneBulkItem] = Field(
        default_factory=list
    )


class MediaGroupItemBulkItem(BaseModel):

    id: Optional[int] = None

    answer: Optional[str] = ""

    media: Optional[str] = ""

    # Ordered list of images for this item, cover first. None means "not sent"
    # (fall back to the single `media`); an item with several images picks one at
    # ask time so the picture cannot be rote-memorised.
    media_pool: Optional[List[str]] = None

    aliases: List[str] = Field(
        default_factory=list
    )

    data: dict[str, Any] = Field(
        default_factory=dict
    )


class MediaGroupItemsGroupUpdate(BaseModel):

    name: Optional[str] = None

    media: Optional[str] = None

    tags: Optional[List[str]] = None


class MediaGroupItemsBulkUpdate(BaseModel):

    group: Optional[MediaGroupItemsGroupUpdate] = None

    items: List[MediaGroupItemBulkItem] = Field(
        default_factory=list
    )

    deleted_item_ids: List[int] = Field(
        default_factory=list
    )


class TextGroupItemBulkItem(BaseModel):

    id: Optional[int] = None

    question: Optional[str] = ""

    answer: Optional[str] = ""

    aliases: List[str] = Field(
        default_factory=list
    )

    data: dict[str, Any] = Field(
        default_factory=dict
    )


class TextGroupItemsGroupUpdate(BaseModel):

    name: Optional[str] = None

    tags: Optional[List[str]] = None


class TextGroupItemsBulkUpdate(BaseModel):

    group: Optional[TextGroupItemsGroupUpdate] = None

    items: List[TextGroupItemBulkItem] = Field(
        default_factory=list
    )

    deleted_item_ids: List[int] = Field(
        default_factory=list
    )


class SequenceGroupItemBulkItem(BaseModel):

    id: Optional[int] = None

    answer: Optional[str] = ""

    aliases: List[str] = Field(
        default_factory=list
    )

    data: dict[str, Any] = Field(
        default_factory=dict
    )


class SequenceGroupItemsGroupUpdate(BaseModel):

    name: Optional[str] = None

    tags: Optional[List[str]] = None


class SequenceGroupItemsBulkUpdate(BaseModel):

    group: Optional[SequenceGroupItemsGroupUpdate] = None

    # Array order is the rank: the service assigns position = index + 1 and
    # ignores any position sent in `data`.
    items: List[SequenceGroupItemBulkItem] = Field(
        default_factory=list
    )

    deleted_item_ids: List[int] = Field(
        default_factory=list
    )


class CollectionRuleClause(BaseModel):
    """One clause of a playlist rule, e.g. "tag = drapeaux".

    Only the field matching `kind` is read; the rest stay None. Keeping them
    on one flat model avoids a discriminated union for what the UI edits as a
    single row.
    """

    kind: Literal["group", "tag", "type", "difficulty"]

    group_id: Optional[int] = None
    tag: Optional[str] = None
    type_q: Optional[str] = None
    gte: Optional[float] = None


class CollectionRules(BaseModel):

    match: Literal["any", "all"] = "any"

    clauses: List[CollectionRuleClause] = Field(default_factory=list)


class CollectionPreview(BaseModel):
    """Resolve a rule without saving it, so the builder can show live counts."""

    rules: Optional[CollectionRules] = None

    question_ids: List[int] = Field(default_factory=list)

    excluded_question_ids: List[int] = Field(default_factory=list)

    limit: int = Field(default=40, ge=1, le=200)


class CollectionCreate(BaseModel):

    name: str = Field(
        min_length=1,
        max_length=100
    )

    # Manually pinned questions. With rules in play these are additions on
    # top of what the rules already match, not the whole membership.
    question_ids: List[int] = Field(default_factory=list)

    rules: Optional[CollectionRules] = None

    excluded_question_ids: List[int] = Field(default_factory=list)


class CollectionUpdate(BaseModel):

    name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=100
    )

    question_ids: Optional[List[int]] = None

    rules: Optional[CollectionRules] = None

    excluded_question_ids: Optional[List[int]] = None


class TagPosition(BaseModel):

    x: float

    y: float


class TagHierarchyUpdate(BaseModel):

    # Compatibility clients must still participate in optimistic locking;
    # current clients use the narrower /tags/actions endpoint.
    revision: int = Field(ge=0)

    parents: Dict[str, List[str]] = Field(default_factory=dict)

    labels: Dict[str, str] = Field(default_factory=dict)

    positions: Dict[str, TagPosition] = Field(default_factory=dict)


class TagAction(BaseModel):

    type: Literal[
        "create",
        "set_label",
        "remove_label",
        "set_parents",
        "hide_root",
        "unfile",
        "accept_root",
        "remove_assignments",
        "delete",
        "merge"
    ]
    tag_id: Optional[str] = None
    target_id: Optional[str] = None
    label: Optional[str] = None
    locale: str = "fr"
    suggestion_key: Optional[str] = None
    parent_ids: List[str] = Field(default_factory=list)
    hidden: Optional[bool] = None


class TagActionsRequest(BaseModel):

    base_revision: int = Field(ge=0)
    actions: List[TagAction] = Field(min_length=1)


class TagInboxResolution(BaseModel):

    pack_guid: str
    tag_id: str
    action: Literal["place", "merge", "keep_root", "defer"]
    parent_id: Optional[str] = None
    target_id: Optional[str] = None


class TagConflictResolution(BaseModel):

    pack_guid: str
    conflict_id: str
    choice: Literal["local", "pack"]
