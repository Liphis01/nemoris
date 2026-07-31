import { useCallback, useEffect, useRef, useState } from "react";
import {
  getReview,
  graduateRelearning,
  sendMediaAnswer,
  sendMapAnswer,
  sendTextAnswer,
  sendTimelineAnswer,
  sendSequenceAnswer,
  reviseAnswer,
  sendAnswer
} from "../../../api/review";
import {
  GOT_IT_QUALITY,
  STILL_LEARNING_QUALITY,
  isRelearningQuestion
} from "../relearningGrades";


function isEditableTarget(target) {
  if (!target || typeof target.closest !== "function") {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}

const TEXT_ANSWER_FEEDBACK_MS = 240;


function localReviewDateString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


export function useReviewSession(active) {
  // Owns one review run: fetching due items, moving through the queue, and
  // re-queueing failures for another pass.
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [sessionComplete, setSessionComplete] = useState(false);
  const [selectedTextQuality, setSelectedTextQuality] = useState(null);
  const [answeredTextByIndex, setAnsweredTextByIndex] = useState({});
  const [returnToLastQuestionArmed, setReturnToLastQuestionArmed] = useState(false);
  const textAnswerTimeoutRef = useRef(null);
  const textAnswerPendingRef = useRef(false);
  const textAnswerRequestsRef = useRef({});
  const reviewDateRef = useRef(null);

  const current = questions[currentIndex];
  const lastQuestionIndex = currentIndex - 1;
  const lastQuestion = questions[lastQuestionIndex];
  const currentIsTextLike = current?.type_q === "text" || (
    current?.type_q === "media" &&
    !current?.items
  );
  const lastQuestionIsTextLike = lastQuestion?.type_q === "text" || (
    lastQuestion?.type_q === "media" &&
    !lastQuestion?.items
  );
  const currentTextAnswer = currentIsTextLike
    ? answeredTextByIndex[currentIndex]
    : null;
  const canReturnToLastQuestion = Boolean(
    returnToLastQuestionArmed &&
    lastQuestionIsTextLike &&
    answeredTextByIndex[lastQuestionIndex] &&
    selectedTextQuality === null
  );

  const clearTextAnswerTimeout = useCallback(() => {
    if (textAnswerTimeoutRef.current) {
      clearTimeout(textAnswerTimeoutRef.current);
      textAnswerTimeoutRef.current = null;
    }

    textAnswerPendingRef.current = false;
  }, []);

  const returnToLastQuestion = useCallback(() => {
    if (!canReturnToLastQuestion) return;

    clearTextAnswerTimeout();
    setSelectedTextQuality(null);
    setShowAnswer(true);
    setReturnToLastQuestionArmed(false);
    setCurrentIndex(prev => Math.max(0, prev - 1));
  }, [canReturnToLastQuestion, clearTextAnswerTimeout]);

  const waitForTextAnswerRequests = useCallback(() => {
    const requests = Object.values(textAnswerRequestsRef.current);

    if (requests.length === 0) {
      return Promise.resolve();
    }

    return Promise.allSettled(requests);
  }, []);

  const submitMapAnswer = useCallback((
    items,
    mode = undefined,
    contextCount = undefined
  ) => sendMapAnswer(items, mode, contextCount, reviewDateRef.current),
  []);

  const submitMediaAnswer = useCallback((
    items,
    mode = undefined,
    contextCount = undefined
  ) => sendMediaAnswer(items, mode, contextCount, reviewDateRef.current),
  []);

  const submitTextAnswer = useCallback((
    items,
    mode = undefined,
    contextCount = undefined
  ) => sendTextAnswer(items, mode, contextCount, reviewDateRef.current),
  []);

  const submitTimelineAnswer = useCallback((items) =>
    sendTimelineAnswer(items, reviewDateRef.current),
  []);

  const submitSequenceAnswer = useCallback((
    items,
    mode = undefined,
    contextCount = undefined
  ) => sendSequenceAnswer(items, mode, contextCount, reviewDateRef.current),
  []);

  // "Acquis" for grouped items: graduate them from the frozen first-fail state
  // on the pinned session date, carrying no grade.
  const graduateGroupedAnswer = useCallback((questionIds) =>
    graduateRelearning(questionIds, reviewDateRef.current),
  []);

  const handleTextAnswer = useCallback((quality) => {
    if (!current || textAnswerPendingRef.current) return;

    // Fire-and-advance keeps review fast. Failures are appended to the end so
    // they appear again after the current queue.
    const answerIndex = currentIndex;
    const relearning = isRelearningQuestion(current);
    const existingAnswer = answeredTextByIndex[answerIndex]?.questionId === current.question_id
      ? answeredTextByIndex[answerIndex]
      : null;
    const previousQuality = existingAnswer?.quality;
    const previousRequest = textAnswerRequestsRef.current[answerIndex] || Promise.resolve();
    // A relearning retry never re-grades: the first fail already set the
    // schedule and froze FSRS. "Encore" just loops (re-queued below); "Acquis"
    // graduates the card from its frozen state via the dedicated endpoint.
    const request = relearning
      ? (quality === STILL_LEARNING_QUALITY
        ? Promise.resolve()
        : graduateRelearning([current.question_id], reviewDateRef.current))
      : existingAnswer
        ? previousRequest
          .catch(() => null)
          .then(() => reviseAnswer(
            current.question_id,
            quality,
            reviewDateRef.current
          ))
        : sendAnswer(current.question_id, quality, reviewDateRef.current);

    textAnswerRequestsRef.current[answerIndex] = request;
    request.catch(console.error);
    setAnsweredTextByIndex(prev => ({
      ...prev,
      [answerIndex]: {
        questionId: current.question_id,
        quality
      }
    }));

    clearTextAnswerTimeout();
    textAnswerPendingRef.current = true;
    setSelectedTextQuality(quality);

    textAnswerTimeoutRef.current = setTimeout(() => {
      setQuestions(prev => {
        const nextQuestions = previousQuality === 0 && quality !== 0
          ? prev.filter(item => item._reviewRetryOfIndex !== answerIndex)
          : prev;
        const hasRetry = nextQuestions.some(
          item => item._reviewRetryOfIndex === answerIndex
        );

        if (quality === 0 && !hasRetry) {
          return [
            ...nextQuestions,
            {
              ...current,
              _reviewRetryOfIndex: answerIndex
            }
          ];
        }

        return nextQuestions;
      });

      setShowAnswer(false);
      setCurrentIndex(prev => prev + 1);
      setReturnToLastQuestionArmed(true);
      setSelectedTextQuality(null);
      textAnswerTimeoutRef.current = null;
      textAnswerPendingRef.current = false;
    }, TEXT_ANSWER_FEEDBACK_MS);
  }, [
    answeredTextByIndex,
    clearTextAnswerTimeout,
    current,
    currentIndex
  ]);

  // Every grouped type finishes the same way: one screen answers many atomic
  // questions, and only the failed ones are re-queued, wrapped back into the
  // same runtime group shape so they get another pass this session.
  function handleGroupComplete(failedQuestionIds = []) {
    const answerIndex = currentIndex;

    if (current && failedQuestionIds.length > 0) {
      const failedItems = (current.items || []).filter(item =>
        failedQuestionIds.includes(item.question_id)
      );

      if (failedItems.length > 0) {
        setQuestions(prev => [
          ...prev,
          {
            ...current,
            items: failedItems,
            _reviewRetryOfIndex: answerIndex
          }
        ]);
      }
    }

    setCurrentIndex(prev => prev + 1);
    setReturnToLastQuestionArmed(true);
  }

  const handleMapComplete = handleGroupComplete;
  const handleImageComplete = handleGroupComplete;
  const handleTimelineComplete = handleGroupComplete;
  const handleSequenceComplete = handleGroupComplete;

  // Closes the run out. Shared by the "nothing was due today" bootstrap path
  // and the "just answered the last question" path below, so both land on the
  // exact same end-of-session screen. Pending text answers are awaited first so
  // the panel never renders while a grade is still in flight.
  const completeSession = useCallback(async (cancelledRef) => {
    setSessionComplete(true);

    try {
      await waitForTextAnswerRequests();
    } catch (error) {
      console.error(error);
    }

    if (cancelledRef?.current) return;

    setSessionComplete(true);
  }, [waitForTextAnswerRequests]);

  // Lets the user end the run while relearning retries are still queued up,
  // instead of grinding through them first. `questions`/`currentIndex` are
  // deliberately left alone so "modifier la dernière réponse" keeps working.
  const skipToSessionEnd = useCallback(() => {
    completeSession({ current: false });
  }, [completeSession]);

  useEffect(() => {
    if (!active) {
      clearTextAnswerTimeout();
      setSelectedTextQuality(null);
      setReviewLoading(false);
      setReviewError("");
      setSessionComplete(false);
      setAnsweredTextByIndex({});
      setReturnToLastQuestionArmed(false);
      textAnswerRequestsRef.current = {};
      reviewDateRef.current = null;
      return;
    }

    const cancelledRef = { current: false };

    async function loadReview() {
      setReviewLoading(true);
      setReviewError("");
      setSessionComplete(false);
      setQuestions([]);
      setCurrentIndex(0);
      setShowAnswer(false);
      setSelectedTextQuality(null);
      setAnsweredTextByIndex({});
      setReturnToLastQuestionArmed(false);
      textAnswerRequestsRef.current = {};
      reviewDateRef.current = localReviewDateString();

      try {
        const data = await getReview();

        if (cancelledRef.current) return;

        setQuestions(data);
        setReviewLoading(false);

        // Nothing to do today: this is the only place that can know that
        // *before* any question has been rendered, so it ends the session
        // itself rather than waiting on the "queue just ended" effect below
        // (which deliberately ignores an empty queue — see there).
        if (data.length === 0) {
          await completeSession(cancelledRef);
        }
      } catch (error) {
        console.error(error);

        if (!cancelledRef.current) {
          setReviewError(error.message || "Impossible de préparer la session.");
          setReviewLoading(false);
        }
      }
    }

    loadReview();

    return () => {
      cancelledRef.current = true;
    };
  }, [active, clearTextAnswerTimeout, completeSession]);

  useEffect(() => {
    return () => {
      clearTextAnswerTimeout();
    };
  }, [clearTextAnswerTimeout]);

  // Mirrors the bootstrap check above for the "just answered the last
  // question" moment. `questions.length === 0` is excluded on purpose: that
  // state is indistinguishable from the pristine pre-load state on the very
  // first render, and the bootstrap path above already owns the empty case.
  useEffect(() => {
    if (
      !active ||
      reviewLoading ||
      reviewError ||
      sessionComplete ||
      questions.length === 0 ||
      currentIndex < questions.length
    ) {
      return undefined;
    }

    const cancelledRef = { current: false };

    completeSession(cancelledRef);

    return () => {
      cancelledRef.current = true;
    };
  }, [
    active,
    completeSession,
    currentIndex,
    questions.length,
    reviewError,
    reviewLoading,
    sessionComplete
  ]);

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event) {
      // Self-managed types own their keyboard: sequence needs the digits for
      // its QCM options and the letters for its typed modes.
      if (
        current?.type_q === "map" ||
        current?.type_q === "timeline" ||
        (current?.type_q === "media" && current?.items) ||
        (current?.type_q === "text" && current?.items) ||
        (current?.type_q === "sequence" && current?.items)
      ) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      // Keyboard review flow: Enter reveals, then 0/1/2/3 grades the visible
      // answer. Map review handles its own input shortcuts.
      if (event.key === "Enter") {
        if (!showAnswer) {
          event.preventDefault();
          setShowAnswer(true);
        }
        return;
      }

      if (showAnswer) {
        // A relearning retry is binary: only Encore (0) and Acquis (1) act, so
        // the 2/3 grades can't slip a same-day retry back into FSRS.
        const relearning = isRelearningQuestion(current);

        if (event.key === "0") {
          event.preventDefault();
          handleTextAnswer(STILL_LEARNING_QUALITY);
        }
        if (event.key === "1") {
          event.preventDefault();
          handleTextAnswer(relearning ? GOT_IT_QUALITY : 1);
        }
        if (!relearning && event.key === "2") {
          event.preventDefault();
          handleTextAnswer(2);
        }
        if (!relearning && event.key === "3") {
          event.preventDefault();
          handleTextAnswer(3);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, current, showAnswer, handleTextAnswer]);

  return {
    sessionComplete,
    skipToSessionEnd,
    currentIndex,
    handleImageComplete,
    handleMapComplete,
    handleTimelineComplete,
    handleSequenceComplete,
    handleTextAnswer,
    canReturnToLastQuestion,
    currentTextQuality: currentTextAnswer?.quality ?? null,
    returnToLastQuestion,
    selectedTextQuality,
    submitMediaAnswer,
    submitMapAnswer,
    submitTextAnswer,
    submitTimelineAnswer,
    submitSequenceAnswer,
    graduateGroupedAnswer,
    questions,
    reviewError,
    reviewLoading,
    setShowAnswer,
    showAnswer
  };
}
