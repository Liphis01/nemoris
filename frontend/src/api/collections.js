import { requestJson } from "./http";


export function listCollections() {
  return requestJson("/collections");
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
