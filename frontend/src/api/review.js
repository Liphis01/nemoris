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


export function getReview(selectedTags = [], limit = 200, collectionId = null) {
  // Keep review filtering server-side because the backend owns due selection
  // and runtime map grouping.
  const params = new URLSearchParams();

  selectedTags.forEach(tag => params.append("tags", tag));

  if (limit) params.append("limit", limit);
  if (collectionId) params.append("collection_id", collectionId);

  return requestJson(`/review?${params}`);
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
