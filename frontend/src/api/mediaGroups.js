import { requestJson } from "./http";


export function getMediaGroupItems(groupId) {
  return requestJson(`/media-groups/${groupId}/items`);
}


export function patchMediaGroupItems(groupId, payload) {
  return requestJson(`/media-groups/${groupId}/items`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}


export function uploadMediaGroupMedia(groupId, file) {
  const formData = new FormData();
  formData.append("file", file);

  return requestJson(`/media-groups/${groupId}/upload`, {
    method: "POST",
    body: formData
  });
}


export function importMediaGroupMediaUrl(groupId, url) {
  return requestJson(`/media-groups/${groupId}/upload/url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url })
  });
}
