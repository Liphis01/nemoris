import { requestJson } from "./http";


export function listTrainingScopes() {
  return requestJson("/training/scopes");
}


export function getTrainingItems(options = {}) {
  const params = new URLSearchParams();

  if (options.scopeType) {
    params.set("scope_type", options.scopeType);
  }

  if (options.groupId !== undefined && options.groupId !== null) {
    params.set("group_id", String(options.groupId));
  }

  if (options.tag) {
    params.set("tag", options.tag);
  }

  const query = params.toString();

  return requestJson(`/training${query ? `?${query}` : ""}`);
}


export function gradeTrainingTimeline(items) {
  return requestJson("/training/grade_timeline", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items })
  });
}


export function recordGroupTrainingAttempt(groupId, payload) {
  return requestJson(`/training/groups/${groupId}/attempt_record`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
