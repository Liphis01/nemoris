import { requestJson } from "./http";


export function getSequenceGroupItems(groupId) {
  return requestJson(`/sequence-groups/${groupId}/items`);
}


export function patchSequenceGroupItems(groupId, payload) {
  // The array order of payload.items is the rank: the backend assigns
  // position = index + 1 and ignores anything sent in data.position.
  return requestJson(`/sequence-groups/${groupId}/items`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
