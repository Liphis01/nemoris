import {
  IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
  IMAGE_MODE_MULTIPLE_CHOICE_MEDIA,
  IMAGE_MODE_TYPE_ALL,
  IMAGE_MODE_TYPE_PROMPT,
  normalizeImageMode
} from "./imageModes";
import {
  MAP_MODE_CLICK_PROMPT,
  MAP_MODE_MULTIPLE_CHOICE,
  MAP_MODE_TYPE_ALL,
  MAP_MODE_TYPE_PROMPT,
  normalizeMapMode
} from "./mapModes";
import {
  SEQUENCE_MODE_GAP_FILL,
  SEQUENCE_MODE_MULTIPLE_CHOICE,
  SEQUENCE_MODE_RECITE,
  SEQUENCE_MODE_REORDER,
  SEQUENCE_MODE_TYPE_POSITION,
  normalizeSequenceMode
} from "./sequenceModes";
import {
  TEXT_MODE_MATCH,
  TEXT_MODE_TYPE_ALL,
  normalizeTextMode
} from "./textModes";


export const REVIEW_CHOICE_MODE_MIN_CONTEXT = 5;
const SEQUENCE_GOAL_RECITATION = "recitation";


function safeCount(value) {
  const count = Number(value || 0);

  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}


function questionIds(items) {
  return new Set(
    (items || [])
      .map(item => item?.question_id)
      .filter(id => id !== undefined && id !== null)
      .map(String)
  );
}


function railBlankQuestionIds(rail) {
  return new Set(
    (rail || [])
      .filter(slot => slot?.kind === "blank")
      .map(slot => slot.question_id)
      .filter(id => id !== undefined && id !== null)
      .map(String)
  );
}


function sameSet(left, right) {
  if (left.size !== right.size) return false;

  for (const value of left) {
    if (!right.has(value)) return false;
  }

  return true;
}


function normalizeMode(typeQ, mode) {
  if (typeQ === "map") return normalizeMapMode(mode);
  if (typeQ === "media") return normalizeImageMode(mode);
  if (typeQ === "text") return normalizeTextMode(mode);
  if (typeQ === "sequence") return normalizeSequenceMode(mode);

  return mode;
}


export function reviewModeIsMeaningful(typeQ, mode, options = {}) {
  const items = options.items || [];
  const itemCount = safeCount(options.itemCount ?? items.length);
  const activeContextCount = safeCount(
    options.activeContextCount ?? itemCount
  );
  const choiceContextCount = safeCount(
    options.choiceContextCount ??
    options.contextItems?.length ??
    activeContextCount
  );

  if (itemCount <= 0) return false;

  if (typeQ === "map") {
    if (mode === MAP_MODE_MULTIPLE_CHOICE) {
      return choiceContextCount >= REVIEW_CHOICE_MODE_MIN_CONTEXT;
    }
    if (mode === MAP_MODE_CLICK_PROMPT) {
      return activeContextCount >= REVIEW_CHOICE_MODE_MIN_CONTEXT;
    }

    return [MAP_MODE_TYPE_ALL, MAP_MODE_TYPE_PROMPT].includes(mode);
  }

  if (typeQ === "media") {
    if (mode === IMAGE_MODE_TYPE_ALL) return itemCount > 1;
    if ([
      IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
      IMAGE_MODE_MULTIPLE_CHOICE_MEDIA
    ].includes(mode)) {
      return choiceContextCount >= REVIEW_CHOICE_MODE_MIN_CONTEXT;
    }

    return mode === IMAGE_MODE_TYPE_PROMPT;
  }

  if (typeQ === "text") {
    if (mode === TEXT_MODE_MATCH) {
      return itemCount >= REVIEW_CHOICE_MODE_MIN_CONTEXT;
    }

    return mode === TEXT_MODE_TYPE_ALL;
  }

  if (typeQ === "sequence") {
    if (mode === SEQUENCE_MODE_MULTIPLE_CHOICE) {
      return choiceContextCount >= REVIEW_CHOICE_MODE_MIN_CONTEXT;
    }
    if (mode === SEQUENCE_MODE_REORDER) {
      return itemCount >= REVIEW_CHOICE_MODE_MIN_CONTEXT;
    }
    if (mode === SEQUENCE_MODE_GAP_FILL) {
      if (!Array.isArray(options.rail)) return itemCount > 0;

      const blankIds = railBlankQuestionIds(options.rail);

      return blankIds.size > 0 && sameSet(blankIds, questionIds(items));
    }

    return [
      SEQUENCE_MODE_TYPE_POSITION,
      SEQUENCE_MODE_RECITE
    ].includes(mode);
  }

  return true;
}


export function reviewModeFallback(typeQ, mode, options = {}) {
  const normalizedMode = normalizeMode(typeQ, mode);

  if (reviewModeIsMeaningful(typeQ, normalizedMode, options)) {
    return normalizedMode;
  }

  if (typeQ === "map") return MAP_MODE_TYPE_PROMPT;
  if (typeQ === "media") return IMAGE_MODE_TYPE_PROMPT;
  if (typeQ === "text") return TEXT_MODE_TYPE_ALL;

  if (typeQ === "sequence") {
    if (
      options.reviewGoal === SEQUENCE_GOAL_RECITATION &&
      reviewModeIsMeaningful(typeQ, SEQUENCE_MODE_GAP_FILL, options)
    ) {
      return SEQUENCE_MODE_GAP_FILL;
    }

    return SEQUENCE_MODE_TYPE_POSITION;
  }

  return normalizedMode;
}


export function normalizeReviewRetryMode(presentation) {
  const typeQ = presentation?.type_q;

  if (!["map", "media", "text", "sequence"].includes(typeQ)) {
    return presentation?.mode;
  }

  const items = presentation?.items || [];
  const contextItems = presentation?.context_items || items;

  return reviewModeFallback(typeQ, presentation?.mode, {
    items,
    itemCount: items.length,
    activeContextCount: items.length,
    choiceContextCount: contextItems.length,
    contextItems,
    rail: presentation?.rail,
    reviewGoal: presentation?.review_goal
  });
}
