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

  if (options.collectionId !== undefined && options.collectionId !== null) {
    params.set("collection_id", String(options.collectionId));
  }

  if (options.tag) {
    params.set("tag", options.tag);
  }

  if (options.mapMode) {
    params.set("map_mode", options.mapMode);
  }

  if (options.imageMode) {
    params.set("image_mode", options.imageMode);
  }

  if (options.textMode) {
    params.set("text_mode", options.textMode);
  }

  if (options.sequenceMode) {
    params.set("sequence_mode", options.sequenceMode);
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


export function gradeTrainingSequence(items) {
  // Sequences are server-graded, so training must NOT go through /answer_sequence
  // or a practice run would write real FSRS history. This grades without
  // scheduling.
  return requestJson("/training/grade_sequence", {
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


export function recordCollectionTrainingAttempt(collectionId, payload) {
  return requestJson(`/training/collections/${collectionId}/attempt_record`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
