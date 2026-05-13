from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Any


QuestionType = Literal[
    "text",
    "map"
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

    map_id: Optional[int] = None

    code: Optional[str] = None

    aliases: List[str] = Field(default_factory=list)


class QuestionUpdate(BaseModel):

    question: Optional[str] = None

    answer: Optional[str] = None

    type_q: Optional[QuestionType] = None

    media: Optional[str] = None

    tags: Optional[List[str]] = None

    group_id: Optional[int] = None

    map_id: Optional[int] = None

    code: Optional[str] = None

    aliases: Optional[List[str]] = None


class QuestionOut(BaseModel):

    id: int

    type_q: QuestionType

    question: Optional[str]

    answer: Optional[str]

    media: Optional[str]

    tags: List[str]

    group_id: Optional[int]

    code: Optional[str]

    aliases: List[str]

    class Config:
        from_attributes = True


class SetCollections(BaseModel):
    collection_ids: List[int]


class AnswerRequest(BaseModel):
    question_id: int

    quality: int = Field(
        ge=0,
        le=2
    )


class MapZoneUpdate(BaseModel):

    group_id: int

    code: str = Field(
        min_length=1,
        max_length=100
    )

    question: str = Field(
        min_length=1
    )

    aliases: List[str] = []


class CollectionCreate(BaseModel):

    name: str = Field(
        min_length=1,
        max_length=100
    )

    media: Optional[str] = None

    data: dict[str, Any] = Field(
        default_factory=dict
    )