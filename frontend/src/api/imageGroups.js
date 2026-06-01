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


export function uploadImageGroupMedia(groupId, file) {
  const formData = new FormData();
  formData.append("file", file);

  return requestJson(`/image-groups/${groupId}/upload`, {
    method: "POST",
    body: formData
  });
}
