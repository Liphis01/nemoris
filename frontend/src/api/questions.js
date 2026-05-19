import { requestJson } from "./http";


export function listQuestions() {
  return requestJson("/questions");
}


export function createQuestion(payload) {
  return requestJson("/questions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}


export function updateQuestion(id, payload) {
  return requestJson(`/questions/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}


export function deleteQuestion(id) {
  return requestJson(`/questions/${id}`, {
    method: "DELETE"
  });
}


export function setQuestionCollections(id, collectionIds) {
  // Collection membership is edited separately from the core question payload
  // so spreadsheet-style edits do not have to resubmit every field.
  return requestJson(`/questions/${id}/collections`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ collection_ids: collectionIds })
  });
}


export function removeQuestionMedia(id) {
  return requestJson(`/questions/${id}/image`, {
    method: "DELETE"
  });
}


export function uploadMedia(file) {
  // File uploads use FormData; do not set Content-Type manually or the browser
  // will omit the multipart boundary.
  const formData = new FormData();
  formData.append("file", file);

  return requestJson("/upload", {
    method: "POST",
    body: formData
  });
}
