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


export function sendMapAnswer(
  items,
  mode = undefined,
  contextCount = undefined,
  reviewDate = undefined
) {
  const resolved = resolveGroupedAnswerArgs(contextCount, reviewDate);

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
      ...(resolved.reviewDate ? { review_date: resolved.reviewDate } : {})
    })
  });
}


export function sendMediaAnswer(
  items,
  mode = undefined,
  contextCount = undefined,
  reviewDate = undefined
) {
  const resolved = resolveGroupedAnswerArgs(contextCount, reviewDate);

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
      ...(resolved.reviewDate ? { review_date: resolved.reviewDate } : {})
    })
  });
}


export function sendTextAnswer(
  items,
  mode = undefined,
  contextCount = undefined,
  reviewDate = undefined
) {
  const resolved = resolveGroupedAnswerArgs(contextCount, reviewDate);

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
      ...(resolved.reviewDate ? { review_date: resolved.reviewDate } : {})
    })
  });
}


export function sendTimelineAnswer(items, reviewDate = undefined) {
  // items is an object of question_id -> normalized timeline guesses.
  return requestJson("/answer_timeline", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items,
      ...(reviewDate ? { review_date: reviewDate } : {})
    })
  });
}


export function sendSequenceAnswer(
  items,
  mode = undefined,
  contextCount = undefined,
  reviewDate = undefined
) {
  const resolved = resolveGroupedAnswerArgs(contextCount, reviewDate);

  // items is an object of question_id -> { position }. Sequences are graded on
  // the server, so this reads the response instead of discarding it.
  return requestJson("/answer_sequence", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items,
      ...(mode ? { mode } : {}),
      ...answerContextPayload(resolved.contextCount),
      ...(resolved.reviewDate ? { review_date: resolved.reviewDate } : {})
    })
  });
}
