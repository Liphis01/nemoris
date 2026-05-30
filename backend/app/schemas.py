from pydantic import BaseModel, Field
from typing import Annotated, Optional, List, Literal, Any, Dict


QuestionType = Literal[
    "text",
    "map",
    "timeline"
]

GroupType = Literal[
    "map"
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

    tags: List[str] = Field(default_factory=list)

    group_id: Optional[int] = None

    data: dict[str, Any] = Field(default_factory=dict)

    collection_ids: List[int] = Field(default_factory=list)


class QuestionUpdate(BaseModel):

    question: Optional[str] = None

    answer: Optional[str] = None

    type_q: Optional[QuestionType] = None

    media: Optional[str] = None

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

    tags: List[str]

    group_id: Optional[int]

    data: Optional[dict[str, Any]] = None

    class Config:
        from_attributes = True


class SetCollections(BaseModel):
    collection_ids: List[int]


AnswerQuality = Annotated[int, Field(ge=0, le=3)]


class AnswerRequest(BaseModel):
    question_id: int

    # 0 = Again/Faux, 1 = Hard/Dur, 2 = Good/Bon, 3 = Easy/Facile
    quality: AnswerQuality


class ReviewSettings(BaseModel):
    catchup_daily_target: int = Field(
        ge=1,
        le=10000
    )


class MapAnswerRequest(BaseModel):
    items: Dict[int, AnswerQuality]


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


class CollectionCreate(BaseModel):

    name: str = Field(
        min_length=1,
        max_length=100
    )
