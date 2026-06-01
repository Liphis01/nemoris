import TimelineQuestionEditor from "../../timeline/components/TimelineQuestionEditor";
import {
  createDefaultTimeline,
  formatTimelineAnswer,
  normalizeTimeline
} from "../../timeline/timelineUtils";
import TextQuestionEditor from "./TextQuestionEditor";

function prepareTextDraft(draft) {
  return {
    ...draft,
    type_q: "text",
    data: {}
  };
}

function prepareImageDraft(draft) {
  return {
    ...draft,
    type_q: "image",
    media: draft?.media || "",
    data: draft?.data || {}
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
  timeline: {
    Editor: TimelineQuestionEditor,
    prepareDraft: prepareTimelineDraft
  },
  image: {
    Editor: TextQuestionEditor,
    prepareDraft: prepareImageDraft
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
