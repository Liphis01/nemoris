import { requestJson } from "./http";


export function listCollections() {
  return requestJson("/collections");
}


export function getCollection(id) {
  return requestJson(`/collections/${id}`);
}


export function listCollectionQuestionCandidates(filters = {}, options = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;

    params.set(key, String(value));
  });

  const query = params.toString();

  return requestJson(
    `/collections/question_candidates${query ? `?${query}` : ""}`,
    options
  );
}


export function listCollectionQuestions(id) {
  return requestJson(`/collections/${id}/questions`);
}


export function createCollection(payload) {
  return requestJson("/collections", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}


export function updateCollection(id, payload) {
  return requestJson(`/collections/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}


export function deleteCollection(id) {
  return requestJson(`/collections/${id}`, {
    method: "DELETE"
  });
}
