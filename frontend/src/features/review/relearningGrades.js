// Relearning ("réapprentissage") is the in-session loop a card enters after it
// is failed. On a relearning retry the four grades collapse to a binary choice,
// and the answer never re-grades FSRS: the first fail is the whole scheduling
// story for the day. See the backend `progress_in_relearning` for the mirror.

// "Encore" (still learning) reuses quality 0 and "Acquis" (got it) reuses 1, but
// only locally: Encore keeps the card in the loop, Acquis graduates it via the
// dedicated endpoint. Neither value is sent as a normal grade.
export const STILL_LEARNING_QUALITY = 0;
export const GOT_IT_QUALITY = 1;

// Same { value, icon, title } shape the per-type quality arrays use, so a
// component can swap its options for these when relearning.
export const relearningQualityOptions = [
  { value: STILL_LEARNING_QUALITY, icon: "❌", title: "Encore" },
  { value: GOT_IT_QUALITY, icon: "✅", title: "Acquis" }
];

// A single item is relearning when its persisted progress says so. This is what
// survives a refresh: the card comes back due today with `relearning: true`.
export function isRelearningItem(item) {
  return item?.progress?.relearning === true;
}

// A review entry (a single card or a runtime group) is in relearning when it is
// an in-session retry (re-queued with `_reviewRetryOfIndex`, which can be 0, so
// compare against undefined) or when its persisted state — its own progress or
// any of its items' — marks it relearning after a refresh.
export function isRelearningQuestion(question) {
  if (!question) return false;

  return (
    question._reviewRetryOfIndex !== undefined ||
    isRelearningItem(question) ||
    (Array.isArray(question.items) && question.items.some(isRelearningItem))
  );
}

// Per-item check inside a grouped review: an in-session retry group's items are
// all relearning; a refreshed group is judged item by item so a group that mixes
// relearning and freshly-due items grades each correctly.
export function isRelearningGroupItem(group, item) {
  return group?._reviewRetryOfIndex !== undefined || isRelearningItem(item);
}

function questionIdIsRelearning(group, questionId) {
  if (group?._reviewRetryOfIndex !== undefined) return true;

  return (group?.items || []).some(
    item => item?.question_id === questionId && isRelearningItem(item)
  );
}

// A grouped submit answers many items at once. Relearning items must not be
// re-graded: this splits a { question_id: quality } map into the grades to send
// normally and the ids to graduate ("Acquis"). Relearning items graded 0
// ("Encore") are dropped from both — the caller still re-queues them through the
// usual failedQuestionIds (quality === 0) path.
export function partitionRelearningQualities(group, qualities) {
  const graded = {};
  const graduateIds = [];

  for (const [id, quality] of Object.entries(qualities || {})) {
    const questionId = Number(id);

    if (questionIdIsRelearning(group, questionId)) {
      if (quality >= GOT_IT_QUALITY) {
        graduateIds.push(questionId);
      }
      continue;
    }

    graded[id] = quality;
  }

  return { graded, graduateIds };
}
