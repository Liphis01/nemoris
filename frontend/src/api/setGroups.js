import { requestJson } from "./http";

export function getSetGroup(groupId) {
  return requestJson(`/set-groups/${groupId}`);
}

export function patchSetGroup(groupId, payload) {
  return requestJson(`/set-groups/${groupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
