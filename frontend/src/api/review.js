import { requestJson, requestOk } from "./http";


export function getReviewSettings() {
  return requestJson("/review/settings");
}


export function updateReviewSettings(payload) {
  return requestJson("/review/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}


export function rebalanceReviewCalendar() {
  return requestJson("/review/rebalance", {
    method: "POST"
  });
}


export function getStartupRebalanceNotice() {
  return requestJson("/review/startup_notice");
}


export function getReviewSummary() {
  return requestJson("/review/summary");
}


export function getBonusReviewStatus() {
  return requestJson("/review/bonus_status");
}


export function getReview(options = {}) {
  const params = new URLSearchParams();

  if (options.includeNew) {
    params.set("include_new", "true");
  }

  const query = params.toString();

  return requestJson(`/review${query ? `?${query}` : ""}`);
}


export function sendAnswer(questionId, quality, reviewDate = undefined) {
  return requestOk("/answer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      question_id: questionId,
      quality,
      ...(reviewDate ? { review_date: reviewDate } : {})
    })
  });
}


export function reviseAnswer(questionId, quality, reviewDate = undefined) {
  return requestOk("/answer/revise", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      question_id: questionId,
      quality,
      ...(reviewDate ? { review_date: reviewDate } : {})
    })
  });
}


function answerContextPayload(contextCount) {
  return Number.isFinite(contextCount)
    ? { context_count: contextCount }
    : {};
}


function resolveGroupedAnswerArgs(contextCount, reviewDate) {
  if (typeof contextCount === "string" && reviewDate === undefined) {
    return {
      contextCount: undefined,
      reviewDate: contextCount
    };
  }

  return { contextCount, reviewDate };
}


export function sendMapAnswer(
  items,
  mode = undefined,
  contextCount = undefined,
  reviewDate = undefined
) {
  const resolved = resolveGroupedAnswerArgs(contextCount, reviewDate);

  // items is an object of question_id -> quality, one entry per atomic map zone.
  return requestOk("/answer_map", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items,
      ...(mode ? { mode } : {}),
      ...answerContextPayload(resolved.contextCount),
      ...(resolved.reviewDate ? { review_date: resolved.reviewDate } : {})
    })
  });
}


export function sendImageAnswer(
  items,
  mode = undefined,
  contextCount = undefined,
  reviewDate = undefined
) {
  const resolved = resolveGroupedAnswerArgs(contextCount, reviewDate);

  // items is an object of question_id -> quality, one entry per atomic image.
  return requestOk("/answer_image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items,
      ...(mode ? { mode } : {}),
      ...answerContextPayload(resolved.contextCount),
      ...(resolved.reviewDate ? { review_date: resolved.reviewDate } : {})
    })
  });
}


export function sendTimelineAnswer(items, reviewDate = undefined) {
  // items is an object of question_id -> normalized timeline guesses.
  return requestJson("/answer_timeline", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items,
      ...(reviewDate ? { review_date: reviewDate } : {})
    })
  });
}
