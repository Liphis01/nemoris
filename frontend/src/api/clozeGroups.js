import { requestJson } from "./http";

export function getClozeGroup(groupId) {
  return requestJson(`/cloze-groups/${groupId}`);
}

export function patchClozeGroup(groupId, payload) {
  return requestJson(`/cloze-groups/${groupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
