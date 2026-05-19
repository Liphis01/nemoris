import { requestJson } from "./http";


export function getMapZones(groupId) {
  return requestJson(`/maps/${groupId}/zones`);
}


export function patchMapZones(groupId, payload) {
  // Payload contains changed SVG zones; the backend upserts them as individual
  // map questions linked by group_id.
  return requestJson(`/maps/${groupId}/zones`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
