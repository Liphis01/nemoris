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


export function getReview(options = {}) {
  const params = new URLSearchParams();

  if (options.includeNew) {
    params.set("include_new", "true");
  }

  const query = params.toString();

  return requestJson(`/review${query ? `?${query}` : ""}`);
}


export function sendAnswer(questionId, quality) {
  return requestOk("/answer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      question_id: questionId,
      quality
    })
  });
}


export function reviseAnswer(questionId, quality) {
  return requestOk("/answer/revise", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      question_id: questionId,
      quality
    })
  });
}


export function sendMapAnswer(items) {
  // items is an object of question_id -> quality, one entry per atomic map zone.
  return requestOk("/answer_map", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items })
  });
}


export function sendImageAnswer(items) {
  // items is an object of question_id -> quality, one entry per atomic image.
  return requestOk("/answer_image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items })
  });
}


export function sendTimelineAnswer(items) {
  // items is an object of question_id -> normalized timeline guesses.
  return requestJson("/answer_timeline", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items })
  });
}
