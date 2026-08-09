from dataclasses import dataclass
from typing import Literal

from .image_modes import IMAGE_MODES
from .map_modes import MAP_MODES
from .sequence_modes import SEQUENCE_MODES
from .text_modes import TEXT_MODES
from .answer_policy import ANSWER_POLICY_PRESET_RELAXED


QuestionGrouping = Literal["required", "optional", "forbidden"]

PRESENTATION_SINGLE_CARD = "single_card"
PRESENTATION_MAP_GROUP = "map_group"
PRESENTATION_MEDIA_GROUP = "media_group"
PRESENTATION_TEXT_GROUP = "text_group"
PRESENTATION_TIMELINE_GROUP = "timeline_group"
PRESENTATION_SEQUENCE_GROUP = "sequence_group"

PRESENTATION_KINDS = (
    PRESENTATION_SINGLE_CARD,
    PRESENTATION_MAP_GROUP,
    PRESENTATION_MEDIA_GROUP,
    PRESENTATION_TEXT_GROUP,
    PRESENTATION_TIMELINE_GROUP,
    PRESENTATION_SEQUENCE_GROUP
)


@dataclass(frozen=True)
class QuestionTypeContract:
    type_q: str
    grouping: QuestionGrouping
    persisted_validator: str
    runtime_presentations: tuple[str, ...]
    modes: tuple[str, ...]
    history_key: str | None
    answer_grader: str
    default_answer_policy: str
    matching_authority: str
    training_support: str
    retry_shape: str
    manage_editor: str
    calendar_filter_label: str
    pack_sync_handling: str
    mobile_support: str


@dataclass(frozen=True)
class GroupTypeContract:
    type_group: str
    question_type: str
    runtime_presentation: str
    modes: tuple[str, ...]
    history_key: str | None
    default_answer_policy: str
    matching_authority: str
    training_support: str
    retry_shape: str
    manage_editor: str
    calendar_filter_label: str
    pack_sync_handling: str


QUESTION_TYPE_CONTRACTS = {
    "text": QuestionTypeContract(
        type_q="text",
        grouping="optional",
        persisted_validator="QuestionCreate/QuestionUpdate",
        runtime_presentations=(PRESENTATION_SINGLE_CARD, PRESENTATION_TEXT_GROUP),
        modes=TEXT_MODES,
        history_key="text_mode",
        answer_grader="routers.review.apply_answer_batch",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend when raw answers are present; self-graded single cards",
        training_support="single cards and text groups",
        retry_shape="single_card or text_group",
        manage_editor="TextQuestionEditor/TextGroupEditor",
        calendar_filter_label="TEXT",
        pack_sync_handling="question row; optional text group",
        mobile_support="supported as a single card"
    ),
    "map": QuestionTypeContract(
        type_q="map",
        grouping="required",
        persisted_validator="map_zones/save_map_zones",
        runtime_presentations=(PRESENTATION_MAP_GROUP,),
        modes=MAP_MODES,
        history_key="map_mode",
        answer_grader="routers.review.apply_answer_batch",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend when raw/resolved answers are present",
        training_support="map group",
        retry_shape="map_group",
        manage_editor="CreateMapGroupEditor/Map zone editor",
        calendar_filter_label="MAP",
        pack_sync_handling="map group plus zone question rows",
        mobile_support="not supported"
    ),
    "timeline": QuestionTypeContract(
        type_q="timeline",
        grouping="forbidden",
        persisted_validator="timeline.validate_timeline_data",
        runtime_presentations=(PRESENTATION_TIMELINE_GROUP,),
        modes=("event_to_date",),
        history_key=None,
        answer_grader="timeline.grade_timeline_answer",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend date grader",
        training_support="timeline items",
        retry_shape="timeline_group",
        manage_editor="TimelineQuestionEditor",
        calendar_filter_label="TIMELINE",
        pack_sync_handling="question row with data.timeline",
        mobile_support="not supported"
    ),
    "media": QuestionTypeContract(
        type_q="media",
        grouping="optional",
        persisted_validator="QuestionCreate/QuestionUpdate media fields",
        runtime_presentations=(PRESENTATION_SINGLE_CARD, PRESENTATION_MEDIA_GROUP),
        modes=IMAGE_MODES,
        history_key="image_mode",
        answer_grader="routers.review.apply_answer_batch",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend when raw/resolved answers are present",
        training_support="single cards and media groups",
        retry_shape="single_card or media_group",
        manage_editor="MediaGroupEditor/media fields",
        calendar_filter_label="MEDIA",
        pack_sync_handling="question row; optional media group",
        mobile_support="supported as a single card"
    ),
    "sequence": QuestionTypeContract(
        type_q="sequence",
        grouping="required",
        persisted_validator="sequence_groups.save_sequence_group_items",
        runtime_presentations=(PRESENTATION_SEQUENCE_GROUP,),
        modes=SEQUENCE_MODES,
        history_key="sequence_mode",
        answer_grader="sequence_answers.grade_sequence_answer",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend",
        training_support="sequence group",
        retry_shape="sequence_group",
        manage_editor="SequenceGroupEditor",
        calendar_filter_label="SEQUENCE",
        pack_sync_handling="sequence group plus item question rows",
        mobile_support="not supported"
    )
}


GROUP_TYPE_CONTRACTS = {
    "map": GroupTypeContract(
        type_group="map",
        question_type="map",
        runtime_presentation=PRESENTATION_MAP_GROUP,
        modes=MAP_MODES,
        history_key="map_mode",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend when raw/resolved answers are present",
        training_support="supported",
        retry_shape="map_group",
        manage_editor="CreateMapGroupEditor",
        calendar_filter_label="MAP",
        pack_sync_handling="group media/data plus zone rows"
    ),
    "media": GroupTypeContract(
        type_group="media",
        question_type="media",
        runtime_presentation=PRESENTATION_MEDIA_GROUP,
        modes=IMAGE_MODES,
        history_key="image_mode",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend when raw/resolved answers are present",
        training_support="supported",
        retry_shape="media_group",
        manage_editor="MediaGroupEditor",
        calendar_filter_label="MEDIA",
        pack_sync_handling="group row plus media question rows"
    ),
    "text": GroupTypeContract(
        type_group="text",
        question_type="text",
        runtime_presentation=PRESENTATION_TEXT_GROUP,
        modes=TEXT_MODES,
        history_key="text_mode",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend when raw/resolved answers are present",
        training_support="supported",
        retry_shape="text_group",
        manage_editor="TextGroupEditor",
        calendar_filter_label="TEXT",
        pack_sync_handling="group row plus text question rows"
    ),
    "sequence": GroupTypeContract(
        type_group="sequence",
        question_type="sequence",
        runtime_presentation=PRESENTATION_SEQUENCE_GROUP,
        modes=SEQUENCE_MODES,
        history_key="sequence_mode",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend",
        training_support="supported",
        retry_shape="sequence_group",
        manage_editor="SequenceGroupEditor",
        calendar_filter_label="SEQUENCE",
        pack_sync_handling="group order/data plus sequence item rows"
    )
}


def question_type_contract(type_q):
    return QUESTION_TYPE_CONTRACTS.get(str(type_q or ""))


def group_type_contract(type_group):
    return GROUP_TYPE_CONTRACTS.get(str(type_group or ""))
