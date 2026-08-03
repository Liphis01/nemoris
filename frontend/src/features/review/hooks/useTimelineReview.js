import { useCallback, useMemo, useRef, useState } from "react";
import {
  buildRangeFromItems,
  coerceTimelinePrecision,
  daysInMonth,
  gradeTimelineGuess,
  normalizeTimeline
} from "../../timeline/timelineUtils";
import {
  GOT_IT_QUALITY,
  isRelearningGroupItem,
  STILL_LEARNING_QUALITY
} from "../relearningGrades";

function sortReviewItems(items) {
  return [...items].sort((a, b) => {
    const difficultyA = Number(a.progress?.difficulty ?? 5);
    const difficultyB = Number(b.progress?.difficulty ?? 5);

    if (difficultyA !== difficultyB) return difficultyA - difficultyB;

    const repsA = Number(a.progress?.reps ?? 0);
    const repsB = Number(b.progress?.reps ?? 0);

    if (repsA !== repsB) return repsA - repsB;

    return Number(a.question_id) - Number(b.question_id);
  });
}

// A draft holds only the units the user has actually chosen. `null` means "not
// answered yet" and is what keeps Validate disabled — we never silently default
// a month to January and grade the user on a date they did not pick.
function emptyDraft() {
  return {
    year: null,
    month: null,
    day: null
  };
}

function emptyAnswer(kind) {
  return kind === "interval"
    ? { start: emptyDraft(), end: emptyDraft() }
    : { start: emptyDraft() };
}

export function requiredUnits(precision) {
  if (precision === "day") return ["year", "month", "day"];
  if (precision === "month") return ["year", "month"];

  return ["year"];
}

export function isDraftComplete(draft, precision) {
  return requiredUnits(precision).every(unit => draft?.[unit] !== null && draft?.[unit] !== undefined);
}

function draftToDate(draft, precision) {
  return coerceTimelinePrecision({
    year: draft.year,
    month: draft.month ?? 1,
    day: draft.day ?? 1,
    precision
  }, precision);
}

// Choosing a shorter month must not leave the day pointing past its end
// (31 January → February keeps a 31 that does not exist).
function clampDraftDay(draft) {
  if (draft.day === null || draft.year === null || draft.month === null) return draft;

  const lastDay = daysInMonth(draft.year, draft.month);

  return draft.day > lastDay
    ? { ...draft, day: lastDay }
    : draft;
}

export default function useTimelineReview({
  reviewItems,
  group,
  submitAnswer,
  graduateAnswer,
  onAnsweringComplete,
  onComplete,
  showQualityControls = true
}) {
  const sortedItems = useMemo(() => sortReviewItems(reviewItems || []), [reviewItems]);
  const [orderedIds, setOrderedIds] = useState(() => sortedItems.map(item => item.question_id));
  const [activeId, setActiveId] = useState(() => sortedItems[0]?.question_id ?? null);
  const [answers, setAnswers] = useState({});
  const [endpoint, setEndpoint] = useState("start");
  const [result, setResult] = useState(null);
  // The learner's chosen quality for the revealed card (defaults to the auto
  // grade). Held here until the card is advanced, when it is what gets recorded.
  const [selectedQuality, setSelectedQuality] = useState(null);
  const [pendingGuess, setPendingGuess] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [doneIds, setDoneIds] = useState(() => new Set());
  const failedIdsRef = useRef([]);
  const answeringDoneRef = useRef(false);

  const itemById = useMemo(
    () => new Map(sortedItems.map(item => [item.question_id, item])),
    [sortedItems]
  );
  const range = useMemo(
    () => group?.range || buildRangeFromItems(sortedItems),
    [group?.range, sortedItems]
  );

  const activeItem = itemById.get(activeId) || null;
  // A relearning retry (in-session or from persisted progress) never re-grades
  // FSRS, so its quality collapses to the binary Encore/Acquis choice.
  const activeItemRelearning = isRelearningGroupItem(group, activeItem);
  const activeTimeline = useMemo(
    () => (activeItem ? normalizeTimeline(activeItem.timeline) : null),
    [activeItem]
  );
  const precision = activeTimeline?.start.precision || "year";
  const isInterval = activeTimeline?.kind === "interval";
  const answer = answers[activeId] || emptyAnswer(activeTimeline?.kind);
  const draft = answer[endpoint] || emptyDraft();

  const isComplete = isInterval
    ? isDraftComplete(answer.start, precision) && isDraftComplete(answer.end, precision)
    : isDraftComplete(answer.start, precision);
  const revealed = Boolean(result);
  const answeredCount = doneIds.size;

  const setUnit = useCallback((unit, value) => {
    if (!activeId || revealed) return;

    setAnswers(prev => {
      const current = prev[activeId] || emptyAnswer(activeTimeline?.kind);
      const nextDraft = clampDraftDay({
        ...(current[endpoint] || emptyDraft()),
        [unit]: value
      });

      return {
        ...prev,
        [activeId]: {
          ...current,
          [endpoint]: nextDraft
        }
      };
    });
    setError("");
  }, [activeId, activeTimeline?.kind, endpoint, revealed]);

  // The quick-input path: a parsed date fills every unit the question needs at
  // once, so "14/07/1789" is a single gesture rather than three.
  const setParsedDate = useCallback((date) => {
    if (!activeId || revealed || !date) return;

    setAnswers(prev => {
      const current = prev[activeId] || emptyAnswer(activeTimeline?.kind);

      return {
        ...prev,
        [activeId]: {
          ...current,
          [endpoint]: clampDraftDay({
            year: date.year,
            month: precision === "year" ? null : (date.month ?? null),
            day: precision === "day" ? (date.day ?? null) : null
          })
        }
      };
    });
    setError("");
  }, [activeId, activeTimeline?.kind, endpoint, precision, revealed]);

  // Grades on the client for an instant reveal (the expected date is already in
  // the payload). Nothing is recorded here — the scheduling happens on advance
  // (goNext), once the learner has optionally adjusted the quality. The backend
  // re-grades authoritatively then, so this local grade only drives the UI.
  const validate = useCallback(() => {
    if (!activeItem || !activeTimeline || revealed) return;

    if (!isComplete) {
      setError(isInterval
        ? "Choisissez une date de début et une date de fin."
        : "Choisissez une date avant de valider.");
      return;
    }

    const guess = { start: draftToDate(answer.start, precision) };

    if (isInterval) {
      guess.end = draftToDate(answer.end, precision);
    }

    const graded = gradeTimelineGuess(activeTimeline, guess);

    // A miss is final; only a hit can be refined, so failed ids are known now.
    if (graded.quality === 0) {
      failedIdsRef.current = [...failedIdsRef.current, activeItem.question_id];
    }

    const nextDone = new Set(doneIds);
    nextDone.add(activeItem.question_id);
    setDoneIds(nextDone);
    // A relearning hit defaults to "Acquis" — the Dur/Bon/Facile nuance the auto
    // grade carries is never sent anywhere for these, so it collapses to binary.
    setSelectedQuality(
      activeItemRelearning
        ? (graded.quality > 0 ? GOT_IT_QUALITY : STILL_LEARNING_QUALITY)
        : graded.quality
    );
    setPendingGuess(guess);
    setResult({
      question_id: activeItem.question_id,
      quality: graded.quality,
      expected: activeTimeline,
      guess,
      start: graded.start,
      end: graded.end
    });
    setError("");

    // The answering phase is over the moment the last card is graded, even
    // though its correction is still on screen and its schedule not yet written.
    if (nextDone.size >= sortedItems.length && !answeringDoneRef.current) {
      answeringDoneRef.current = true;
      onAnsweringComplete?.(failedIdsRef.current);
    }
  }, [
    activeItem,
    activeItemRelearning,
    activeTimeline,
    answer,
    doneIds,
    isComplete,
    isInterval,
    onAnsweringComplete,
    precision,
    revealed,
    sortedItems.length
  ]);

  // Only a hit is adjustable (Hard/Good/Easy, or Encore/Acquis in relearning);
  // a miss stays Again. Training has no use for the rating (nothing is
  // scheduled from it), so it's suppressed there.
  const canAdjustQuality = showQualityControls && revealed && result?.quality > 0;
  const adjustQuality = useCallback((quality) => {
    if (!result || result.quality === 0) return;

    setSelectedQuality(activeItemRelearning
      ? Math.max(0, Math.min(1, quality))
      : Math.max(1, Math.min(3, quality)));
  }, [activeItemRelearning, result]);

  // Records the card with its final quality, then advances. This is where the
  // schedule is written — deferred to here so the learner's quality choice is
  // included. On a network failure we stay on the reveal so it can be retried.
  const goNext = useCallback(async () => {
    if (!activeItem || !revealed || isSubmitting) return;

    const questionId = activeItem.question_id;

    if (pendingGuess) {
      setIsSubmitting(true);

      try {
        // Relearning never re-grades FSRS: "Acquis" graduates it through the
        // dedicated endpoint, "Encore" sends nothing and just loops the card
        // back into the queue (same as a genuine miss).
        if (activeItemRelearning) {
          if (selectedQuality >= GOT_IT_QUALITY) {
            await graduateAnswer?.([questionId]);
          } else if (!failedIdsRef.current.includes(questionId)) {
            failedIdsRef.current = [...failedIdsRef.current, questionId];
          }
        } else {
          await submitAnswer({
            [questionId]: { ...pendingGuess, quality: selectedQuality }
          });
        }
      } catch (requestError) {
        setError(requestError.message || "Impossible d'enregistrer cette réponse.");
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
    }

    const nextId = orderedIds.find(id => id !== questionId && !doneIds.has(id));

    setResult(null);
    setSelectedQuality(null);
    setPendingGuess(null);
    setEndpoint("start");
    setError("");

    if (nextId === undefined) {
      onComplete?.(failedIdsRef.current);
      return;
    }

    setActiveId(nextId);
  }, [
    activeItem,
    activeItemRelearning,
    doneIds,
    graduateAnswer,
    isSubmitting,
    onComplete,
    orderedIds,
    pendingGuess,
    revealed,
    selectedQuality,
    submitAnswer
  ]);

  // Skip postpones: the card rotates to the back of the queue and comes round
  // again. It is not an answer, so nothing is submitted and nothing is graded.
  const skip = useCallback(() => {
    if (!activeId || revealed) return;

    const rotated = [...orderedIds.filter(id => id !== activeId), activeId];
    const nextId = rotated.find(id => id !== activeId && !doneIds.has(id)) ?? activeId;

    setOrderedIds(rotated);
    setActiveId(nextId);
    setEndpoint("start");
    setError("");
  }, [activeId, doneIds, orderedIds, revealed]);

  const toggleEndpoint = useCallback(() => {
    if (!isInterval || revealed) return;

    setEndpoint(prev => (prev === "start" ? "end" : "start"));
  }, [isInterval, revealed]);

  return {
    activeItem,
    activeItemRelearning,
    activeTimeline,
    adjustQuality,
    answer,
    answeredCount,
    canAdjustQuality,
    draft,
    endpoint,
    error,
    goNext,
    isComplete,
    isInterval,
    isSubmitting,
    precision,
    range,
    result,
    revealed,
    selectedQuality,
    setEndpoint,
    setParsedDate,
    setUnit,
    skip,
    toggleEndpoint,
    totalCount: sortedItems.length,
    validate
  };
}

export { sortReviewItems };
