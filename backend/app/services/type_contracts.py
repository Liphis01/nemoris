from dataclasses import dataclass
from typing import Literal

from .image_modes import IMAGE_MODES
from .map_modes import MAP_MODES
from .sequence_modes import SEQUENCE_MODES
from .text_modes import TEXT_MODES
from .cloze_modes import CLOZE_MODES
from .numeric_modes import NUMERIC_MODES
from .grid_modes import GRID_MODES
from .set_modes import SET_MODES
from .enumeration_modes import ENUMERATION_MODES
from .answer_policy import ANSWER_POLICY_PRESET_RELAXED


QuestionGrouping = Literal["required", "optional", "forbidden"]

PRESENTATION_SINGLE_CARD = "single_card"
PRESENTATION_MAP_GROUP = "map_group"
PRESENTATION_MEDIA_GROUP = "media_group"
PRESENTATION_TEXT_GROUP = "text_group"
PRESENTATION_CLOZE_GROUP = "cloze_group"
PRESENTATION_GRID_CELL = "grid_cell"
PRESENTATION_GRID_ROW = "grid_row"
PRESENTATION_SET_GROUP = "set_group"
PRESENTATION_TIMELINE_GROUP = "timeline_group"
PRESENTATION_SEQUENCE_GROUP = "sequence_group"

PRESENTATION_KINDS = (
    PRESENTATION_SINGLE_CARD,
    PRESENTATION_MAP_GROUP,
    PRESENTATION_MEDIA_GROUP,
    PRESENTATION_TEXT_GROUP,
    PRESENTATION_CLOZE_GROUP,
    PRESENTATION_GRID_CELL,
    PRESENTATION_GRID_ROW,
    PRESENTATION_SET_GROUP,
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
    "numeric": QuestionTypeContract(
        type_q="numeric",
        grouping="forbidden",
        persisted_validator="numeric.validate_question_numeric",
        runtime_presentations=(PRESENTATION_SINGLE_CARD,),
        modes=NUMERIC_MODES,
        history_key="numeric_mode",
        answer_grader="numeric answer endpoint",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend",
        training_support="single cards",
        retry_shape="single_card",
        manage_editor="NumericQuestionEditor",
        calendar_filter_label="NUMERIC",
        pack_sync_handling="question row with data.numeric",
        mobile_support="synced but excluded from mobile review"
    ),
    "cloze": QuestionTypeContract(
        type_q="cloze",
        grouping="required",
        persisted_validator="cloze.save_cloze_group",
        runtime_presentations=(PRESENTATION_CLOZE_GROUP,),
        modes=CLOZE_MODES,
        history_key="cloze_mode",
        answer_grader="cloze answer endpoint",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend",
        training_support="cloze group",
        retry_shape="cloze_group",
        manage_editor="ClozeGroupEditor",
        calendar_filter_label="CLOZE",
        pack_sync_handling="source group plus deterministic generated question rows",
        mobile_support="synced but excluded from mobile review"
    ),
    "grid": QuestionTypeContract(
        type_q="grid", grouping="required", persisted_validator="grid.save_grid_group",
        runtime_presentations=(PRESENTATION_GRID_CELL, PRESENTATION_GRID_ROW), modes=GRID_MODES,
        history_key="grid_mode", answer_grader="grid answer endpoint",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED, matching_authority="backend",
        training_support="grid group", retry_shape="grid_cell or grid_row",
        manage_editor="GridGroupEditor", calendar_filter_label="GRID",
        pack_sync_handling="source group plus deterministic generated question rows",
        mobile_support="synced but excluded from mobile review"
    ),
    "set": QuestionTypeContract(
        type_q="set", grouping="required", persisted_validator="set_groups.save_set_group",
        runtime_presentations=(PRESENTATION_SET_GROUP,), modes=SET_MODES,
        history_key="set_mode", answer_grader="set answer endpoint",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED, matching_authority="backend",
        training_support="set group", retry_shape="set_group",
        manage_editor="SetGroupEditor", calendar_filter_label="SET",
        pack_sync_handling="source group plus deterministic generated question rows",
        mobile_support="synced but excluded from mobile review"
    ),
    "enumeration": QuestionTypeContract(
        type_q="enumeration", grouping="forbidden", persisted_validator="enumeration.validate_question_enumeration",
        runtime_presentations=(PRESENTATION_SINGLE_CARD,), modes=ENUMERATION_MODES,
        history_key="enumeration_mode", answer_grader="enumeration answer endpoint",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED, matching_authority="backend",
        training_support="single card", retry_shape="single_card",
        manage_editor="EnumerationQuestionEditor", calendar_filter_label="ENUMERATION",
        pack_sync_handling="question row with data.enumeration", mobile_support="synced but excluded from mobile review"
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
    "cloze": GroupTypeContract(
        type_group="cloze",
        question_type="cloze",
        runtime_presentation=PRESENTATION_CLOZE_GROUP,
        modes=CLOZE_MODES,
        history_key="cloze_mode",
        default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend",
        training_support="supported",
        retry_shape="cloze_group",
        manage_editor="ClozeGroupEditor",
        calendar_filter_label="CLOZE",
        pack_sync_handling="source group plus deterministic generated rows"
    ),
    "grid": GroupTypeContract(
        type_group="grid", question_type="grid", runtime_presentation=PRESENTATION_GRID_ROW,
        modes=GRID_MODES, history_key="grid_mode", default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend", training_support="supported", retry_shape="grid_cell or grid_row",
        manage_editor="GridGroupEditor", calendar_filter_label="GRID",
        pack_sync_handling="source group plus deterministic generated rows"
    ),
    "set": GroupTypeContract(
        type_group="set", question_type="set", runtime_presentation=PRESENTATION_SET_GROUP,
        modes=SET_MODES, history_key="set_mode", default_answer_policy=ANSWER_POLICY_PRESET_RELAXED,
        matching_authority="backend", training_support="supported", retry_shape="set_group",
        manage_editor="SetGroupEditor", calendar_filter_label="SET",
        pack_sync_handling="source group plus deterministic generated rows"
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
