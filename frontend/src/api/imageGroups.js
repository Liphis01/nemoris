import { requestJson } from "./http";


export function getImageGroupItems(groupId) {
  return requestJson(`/image-groups/${groupId}/items`);
}


export function patchImageGroupItems(groupId, payload) {
  return requestJson(`/image-groups/${groupId}/items`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
