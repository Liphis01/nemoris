import { requestJson } from "./http";


export function listGroups() {
  // Group list includes summary counts used by the Manage browser.
  return requestJson("/groups");
}


export function createGroup(payload) {
  // Creating a group only creates visual context; questions/zones are added
  // separately.
  return requestJson("/groups", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}


export function updateGroup(id, payload) {
  return requestJson(`/groups/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}


export function deleteGroup(id) {
  return requestJson(`/groups/${id}`, {
    method: "DELETE"
  });
}
