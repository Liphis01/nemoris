import { requestJson, requestOk } from "./http";


export function getReviewSettings() {
  return requestJson("/review/settings");
}


export function updateReviewSettings(payload) {
  return requestJson("/review/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}


export function rebalanceReviewCalendar() {
  return requestJson("/review/rebalance", {
    method: "POST"
  });
}


export function getStartupRebalanceNotice() {
  return requestJson("/review/startup_notice");
}


export function getReviewSummary() {
  return requestJson("/review/summary");
}


export function getReview() {
  return requestJson("/review");
}


export function getReviewIntake() {
  return requestJson("/review/intake");
}


export function sendAnswer(questionId, quality, reviewDate = undefined) {
  return requestOk("/answer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      question_id: questionId,
      quality,
      ...(reviewDate ? { review_date: reviewDate } : {})
    })
  });
}


export function reviseAnswer(questionId, quality, reviewDate = undefined) {
  return requestOk("/answer/revise", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      question_id: questionId,
      quality,
      ...(reviewDate ? { review_date: reviewDate } : {})
    })
  });
}


// "Acquis": end the relearning loop for these cards. Carries no grade -- the
// backend reschedules from the frozen first-fail state.
export function graduateRelearning(questionIds, reviewDate = undefined) {
  return requestOk("/answer/relearning_graduate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      question_ids: questionIds,
      ...(reviewDate ? { review_date: reviewDate } : {})
    })
  });
}


function answerContextPayload(contextCount) {
  return Number.isFinite(contextCount)
    ? { context_count: contextCount }
    : {};
}


function resolveGroupedAnswerArgs(contextCount, reviewDate) {
  if (typeof contextCount === "string" && reviewDate === undefined) {
    return {
      contextCount: undefined,
      reviewDate: contextCount
    };
  }

  return { contextCount, reviewDate };
}


// `answers` carries what the learner actually typed/clicked/picked, keyed like
// `items`. Optional on every path: the server stores it when present and
// behaves exactly as before when it is omitted.
function answersPayload(answers) {
  return answers && Object.keys(answers).length > 0 ? { answers } : {};
}


function candidatesPayload(candidates) {
  return candidates && Object.keys(candidates).length > 0 ? { candidates } : {};
}


export function sendMapAnswer(
  items,
  mode = undefined,
  contextCount = undefined,
  answers = undefined,
  candidates = undefined,
  reviewDate = undefined
) {
  const resolved = resolveGroupedAnswerArgs(contextCount, reviewDate);
  const resolvedCandidates = (
    typeof candidates === "string" && reviewDate === undefined
      ? undefined
      : candidates
  );
  const resolvedReviewDate = (
    typeof candidates === "string" && reviewDate === undefined
      ? candidates
      : resolved.reviewDate
  );

  // items is an object of question_id -> quality, one entry per atomic map zone.
  return requestOk("/answer_map", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items,
      ...(mode ? { mode } : {}),
      ...answerContextPayload(resolved.contextCount),
      ...answersPayload(answers),
      ...candidatesPayload(resolvedCandidates),
      ...(resolvedReviewDate ? { review_date: resolvedReviewDate } : {})
    })
  });
}


export function sendMediaAnswer(
  items,
  mode = undefined,
  contextCount = undefined,
  answers = undefined,
  candidates = undefined,
  reviewDate = undefined
) {
  const resolved = resolveGroupedAnswerArgs(contextCount, reviewDate);
  const resolvedCandidates = (
    typeof candidates === "string" && reviewDate === undefined
      ? undefined
      : candidates
  );
  const resolvedReviewDate = (
    typeof candidates === "string" && reviewDate === undefined
      ? candidates
      : resolved.reviewDate
  );

  // items is an object of question_id -> quality, one entry per atomic image.
  return requestOk("/answer_media", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items,
      ...(mode ? { mode } : {}),
      ...answerContextPayload(resolved.contextCount),
      ...answersPayload(answers),
      ...candidatesPayload(resolvedCandidates),
      ...(resolvedReviewDate ? { review_date: resolvedReviewDate } : {})
    })
  });
}


export function sendTextAnswer(
  items,
  mode = undefined,
  contextCount = undefined,
  answers = undefined,
  candidates = undefined,
  reviewDate = undefined
) {
  const resolved = resolveGroupedAnswerArgs(contextCount, reviewDate);
  const resolvedCandidates = (
    typeof candidates === "string" && reviewDate === undefined
      ? undefined
      : candidates
  );
  const resolvedReviewDate = (
    typeof candidates === "string" && reviewDate === undefined
      ? candidates
      : resolved.reviewDate
  );

  // items is an object of question_id -> quality, one entry per text pair.
  return requestOk("/answer_text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items,
      ...(mode ? { mode } : {}),
      ...answerContextPayload(resolved.contextCount),
      ...answersPayload(answers),
      ...candidatesPayload(resolvedCandidates),
      ...(resolvedReviewDate ? { review_date: resolvedReviewDate } : {})
    })
  });
}


export function sendTimelineAnswer(
  items,
  presentationContext = undefined,
  reviewDate = undefined
) {
  const resolvedContext = (
    typeof presentationContext === "string" && reviewDate === undefined
      ? undefined
      : presentationContext
  );
  const resolvedReviewDate = (
    typeof presentationContext === "string" && reviewDate === undefined
      ? presentationContext
      : reviewDate
  );

  // items is an object of question_id -> normalized timeline guesses.
  return requestJson("/answer_timeline", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items,
      ...(resolvedContext ? { presentation_context: resolvedContext } : {}),
      ...(resolvedReviewDate ? { review_date: resolvedReviewDate } : {})
    })
  });
}


export function sendSequenceAnswer(
  payload,
  mode = undefined,
  contextCount = undefined,
  reviewDate = undefined
) {
  const resolved = resolveGroupedAnswerArgs(contextCount, reviewDate);
  const {
    items,
    rail,
    run,
    runStart,
    targetIds,
    scheduledIds,
    stopReason,
    qualities,
    candidates,
    groupId,
    commit = true
  } = payload || {};

  // Sequences are graded on the server, so this reads the response instead of
  // discarding it. `rail` states what was on screen -- the server cannot
  // reconstruct it, and ordering grading is impossible without it. `commit:
  // false` grades without scheduling so the learner can refine a hit first.
  return requestJson("/answer_sequence", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...(items ? { items } : {}),
      ...(rail ? { rail } : {}),
      ...(run ? { run } : {}),
      ...(runStart !== undefined ? { run_start: runStart } : {}),
      ...(targetIds ? { target_ids: targetIds } : {}),
      ...(scheduledIds ? { scheduled_ids: scheduledIds } : {}),
      ...(stopReason ? { stop_reason: stopReason } : {}),
      ...(qualities && Object.keys(qualities).length ? { qualities } : {}),
      ...candidatesPayload(candidates),
      ...(groupId !== undefined ? { group_id: groupId } : {}),
      commit,
      ...(mode ? { mode } : {}),
      ...answerContextPayload(resolved.contextCount),
      ...(resolved.reviewDate ? { review_date: resolved.reviewDate } : {})
    })
  });
}
