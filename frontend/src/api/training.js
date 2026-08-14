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

  (options.questionIds || options.question_ids || []).forEach((questionId) => {
    if (questionId !== undefined && questionId !== null) {
      params.append("question_id", String(questionId));
    }
  });

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


export function gradeTrainingSequence(payload, mode, contextCount) {
  // Sequences are server-graded, so training must NOT go through /answer_sequence
  // or a practice run would write real FSRS history. This grades without
  // scheduling.
  return requestJson("/training/grade_sequence", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...(payload?.items ? { items: payload.items } : {}),
      ...(payload?.rail ? { rail: payload.rail } : {}),
      ...(payload?.run ? { run: payload.run } : {}),
      ...(payload?.runStart !== undefined ? { run_start: payload.runStart } : {}),
      ...(payload?.targetIds ? { target_ids: payload.targetIds } : {}),
      ...(payload?.scheduledIds ? { scheduled_ids: payload.scheduledIds } : {}),
      ...(payload?.stopReason ? { stop_reason: payload.stopReason } : {}),
      ...(payload?.qualities ? { qualities: payload.qualities } : {}),
      group_id: payload?.groupId,
      commit: payload?.commit ?? false,
      ...(mode ? { mode } : {}),
      ...(Number.isFinite(contextCount) ? { context_count: contextCount } : {})
    })
  });
}

export function gradeTrainingCloze(payload) {
  return requestJson("/training/grade_cloze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      group_id: payload.groupId,
      question_id: payload.questionId,
      answer: payload.answer || "",
      commit: false
    })
  });
}

export function gradeTrainingNumeric(payload) {
  return requestJson("/training/grade_numeric", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question_id: payload.questionId,
      answer: payload.answer || "",
      commit: false
    })
  });
}

export function gradeTrainingGrid(payload) {
  return requestJson("/training/grade_grid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group_id: payload.groupId, items: payload.items, mode: payload.mode, commit: false })
  });
}

export function gradeTrainingSet(payload) {
  return requestJson("/training/grade_set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      group_id: payload.groupId,
      question_ids: payload.questionIds,
      answers: payload.answers,
      mode: payload.mode,
      commit: false
    })
  });
}
export function gradeTrainingEnumeration(payload) { return requestJson("/training/grade_enumeration", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question_id:payload.questionId,answers:payload.answers,commit:false})}); }


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
