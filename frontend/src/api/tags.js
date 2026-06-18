import { requestJson } from "./http";


export function getTagHierarchy() {
  return requestJson("/tags/hierarchy");
}


export function saveTagHierarchy(payload) {
  return requestJson("/tags/hierarchy", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
