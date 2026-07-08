import { requestJson } from "./http";


export function getTextGroupItems(groupId) {
  return requestJson(`/text-groups/${groupId}/items`);
}


export function patchTextGroupItems(groupId, payload) {
  return requestJson(`/text-groups/${groupId}/items`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
