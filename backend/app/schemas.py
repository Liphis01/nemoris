from pydantic import BaseModel, Field
from typing import Annotated, Optional, List, Literal, Any, Dict
from datetime import date


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


class GroupUpdate(BaseModel):

    name: Optional[str] = None

    media: Optional[str] = None

    data: Optional[dict[str, Any]] = None


class GroupOut(BaseModel):

    id: int

    type_group: GroupType

    name: str

    media: Optional[str]

    data: dict[str, Any]

    class Config:
        from_attributes = True


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

    class Config:
        from_attributes = True


class SetCollections(BaseModel):
    collection_ids: List[int]


class MediaUrlImport(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


AnswerQuality = Annotated[int, Field(ge=0, le=3)]


class AnswerRequest(BaseModel):
    question_id: int

    # 0 = Again/Faux, 1 = Hard/Dur, 2 = Good/Bon, 3 = Easy/Facile
    quality: AnswerQuality
    review_date: Optional[date] = None


class ReviewSettings(BaseModel):
    catchup_daily_target: int = Field(
        ge=1,
        le=10000
    )


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


class CollectionCreate(BaseModel):

    name: str = Field(
        min_length=1,
        max_length=100
    )

    question_ids: List[int] = Field(default_factory=list)


class CollectionUpdate(BaseModel):

    name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=100
    )

    question_ids: Optional[List[int]] = None


class TagPosition(BaseModel):

    x: float

    y: float


class TagHierarchyUpdate(BaseModel):

    parents: Dict[str, List[str]] = Field(default_factory=dict)

    labels: Dict[str, str] = Field(default_factory=dict)

    positions: Dict[str, TagPosition] = Field(default_factory=dict)
