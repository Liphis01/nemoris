import TimelineQuestionEditor from "../../timeline/components/TimelineQuestionEditor";
import {
  createDefaultTimeline,
  formatTimelineAnswer,
  normalizeTimeline
} from "../../timeline/timelineUtils";
import TextQuestionEditor from "./TextQuestionEditor";
import NumericQuestionEditor from "./NumericQuestionEditor";
import EnumerationQuestionEditor from "./EnumerationQuestionEditor";

function prepareTextDraft(draft) {
  return {
    ...draft,
    type_q: "text",
    data: {}
  };
}

function prepareMediaDraft(draft) {
  return {
    ...draft,
    type_q: "media",
    media: draft?.media || "",
    data: draft?.data || {}
  };
}

function prepareNumericDraft(draft) {
  return {
    ...draft,
    answer: "",
    type_q: "numeric",
    group_id: null,
    data: {
      ...(draft?.data || {}),
      numeric: {
        value: "",
        unit: "",
        display_precision: 0,
        relative_tolerance: "0.10",
        zero_absolute_tolerance: ""
      }
    }
  };
}
function prepareEnumerationDraft(draft) {
  return {
    ...draft,
    type_q: "enumeration",
    group_id: null,
    answer: "",
    data: {
      ...(draft?.data || {}),
      enumeration: { members: [], required_count: 1 }
    }
  };
}

export function prepareTimelineDraft(draft) {
  const timeline = normalizeTimeline(draft?.data?.timeline || createDefaultTimeline());

  return {
    ...draft,
    answer: formatTimelineAnswer(timeline),
    type_q: "timeline",
    data: {
      ...(draft?.data || {}),
      timeline
    },
    group_id: null
  };
}

const questionEditorAdapters = {
  text: {
    Editor: TextQuestionEditor,
    prepareDraft: prepareTextDraft
  },
  numeric: {
    Editor: NumericQuestionEditor,
    prepareDraft: prepareNumericDraft
  },
  enumeration: {
    Editor: EnumerationQuestionEditor,
    prepareDraft: prepareEnumerationDraft
  },
  timeline: {
    Editor: TimelineQuestionEditor,
    prepareDraft: prepareTimelineDraft
  },
  media: {
    Editor: TextQuestionEditor,
    prepareDraft: prepareMediaDraft
  }
};

export function getQuestionEditorAdapter(type_q) {
  return questionEditorAdapters[type_q] || questionEditorAdapters.text;
}

export function hasQuestionEditorAdapter(type_q) {
  return Boolean(questionEditorAdapters[type_q]);
}

export function prepareQuestionDraftForType(draft, type_q) {
  return getQuestionEditorAdapter(type_q).prepareDraft({
    ...draft,
    type_q
  });
}
