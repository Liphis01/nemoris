import { requestJson } from "./http";

export function getGridGroup(groupId) {
  return requestJson(`/grid-groups/${groupId}`);
}

export function patchGridGroup(groupId, payload) {
  return requestJson(`/grid-groups/${groupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
