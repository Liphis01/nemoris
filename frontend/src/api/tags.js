import { requestJson } from "./http";


// Hierarchy plus per-tag question counts, for the picker, manager and labels.
export function getTags() {
  return requestJson("/tags");
}


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


export function applyTagActions(baseRevision, actions) {
  return requestJson("/tags/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_revision: baseRevision, actions })
  });
}


export function getTagInbox() {
  return requestJson("/tags/inbox");
}


export function resolveTagInbox(payload) {
  return requestJson("/tags/inbox/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}


export function resolveTagConflict(payload) {
  return requestJson("/tags/conflicts/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
