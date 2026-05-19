import { requestJson, requestOk } from "./http";


export function getReview(selectedTags = [], limit = 200, collectionId = null) {
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
  return requestOk("/answer_map", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items })
  });
}
