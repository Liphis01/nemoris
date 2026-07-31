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


export function suspendGroup(id, suspended) {
  // One request for the whole group: a group can hold hundreds of questions,
  // so the backend applies this as a single bulk update.
  return requestJson(`/groups/${id}/suspend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ suspended })
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
