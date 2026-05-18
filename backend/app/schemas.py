from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Any


QuestionType = Literal[
    "text",
    "map",
    "map_zone"
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


class AnswerRequest(BaseModel):
    question_id: int

    # int between 0 and 2 (0 = wrong, 1 = hard, 2 = easy)
    quality: int = Field(
        ge=0,
        le=2
    )


class MapZoneUpdate(BaseModel):

    group_id: int

    question: str = Field(
        min_length=1
    )

    data: dict[str, Any] = Field(
        default_factory=dict
    )


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

    media: Optional[str] = None

    data: dict[str, Any] = Field(
        default_factory=dict
    )
