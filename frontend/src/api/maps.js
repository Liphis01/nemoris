import { requestJson } from "./http";


export function getMapZones(groupId) {
  return requestJson(`/maps/${groupId}/zones`);
}


export function patchMapZones(groupId, payload) {
  return requestJson(`/maps/${groupId}/zones`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
