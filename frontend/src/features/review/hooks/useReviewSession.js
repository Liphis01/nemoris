import { useCallback, useEffect, useRef, useState } from "react";
import {
  getReview,
  sendImageAnswer,
  sendMapAnswer,
  sendTimelineAnswer,
  reviseAnswer,
  sendAnswer
} from "../../../api/review";


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


function progressIsNew(progress) {
  const history = progress?.history || [];

  return !progress || ((progress.reps || 0) === 0 && history.length === 0);
}


function reviewItemIsNew(item) {
  if (Array.isArray(item?.items)) {
    return item.items.every(child => progressIsNew(child.progress));
  }

  return progressIsNew(item?.progress);
}


export function useReviewSession(active) {
  // Owns one review run: fetching due items, moving through the queue, and
  // re-queueing failures for another pass.
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [bonusReviewLoading, setBonusReviewLoading] = useState(false);
  const [bonusReviewStarted, setBonusReviewStarted] = useState(false);
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
    current?.type_q === "image" &&
    !current?.items
  );
  const lastQuestionIsTextLike = lastQuestion?.type_q === "text" || (
    lastQuestion?.type_q === "image" &&
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
  const canStartBonusReview = Boolean(
    !bonusReviewStarted &&
    currentIndex >= questions.length
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

  const submitMapAnswer = useCallback((items, mode = undefined) =>
    sendMapAnswer(items, mode, reviewDateRef.current),
  []);

  const submitImageAnswer = useCallback((items, mode = undefined) =>
    sendImageAnswer(items, mode, reviewDateRef.current),
  []);

  const submitTimelineAnswer = useCallback((items) =>
    sendTimelineAnswer(items, reviewDateRef.current),
  []);

  const handleTextAnswer = useCallback((quality) => {
    if (!current || textAnswerPendingRef.current) return;

    // Fire-and-advance keeps review fast. Failures are appended to the end so
    // they appear again after the current queue.
    const answerIndex = currentIndex;
    const existingAnswer = answeredTextByIndex[answerIndex]?.questionId === current.question_id
      ? answeredTextByIndex[answerIndex]
      : null;
    const previousQuality = existingAnswer?.quality;
    const previousRequest = textAnswerRequestsRef.current[answerIndex] || Promise.resolve();
    const request = existingAnswer
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

  function handleMapComplete(failedQuestionIds = []) {
    // A map screen can contain many atomic zone questions. Only failed zones are
    // re-queued, wrapped back into the same runtime map group shape.
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

  function handleImageComplete(failedQuestionIds = []) {
    // Image groups mirror map runtime groups: only failed atomic images are
    // appended for another pass in the same review session.
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

  function handleTimelineComplete(failedQuestionIds = []) {
    // Timeline review also updates many atomic questions from one screen.
    // Failed items are wrapped back into the runtime timeline shape.
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

  useEffect(() => {
    if (!active) {
      clearTextAnswerTimeout();
      setSelectedTextQuality(null);
      setReviewLoading(false);
      setReviewError("");
      setBonusReviewLoading(false);
      setBonusReviewStarted(false);
      setAnsweredTextByIndex({});
      setReturnToLastQuestionArmed(false);
      textAnswerRequestsRef.current = {};
      reviewDateRef.current = null;
      return;
    }

    let cancelled = false;

    async function loadReview() {
      setReviewLoading(true);
      setReviewError("");
      setBonusReviewLoading(false);
      setBonusReviewStarted(false);
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

        if (cancelled) return;

        setQuestions(data);
        setReviewLoading(false);
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setReviewError(error.message || "Impossible de préparer la session.");
          setReviewLoading(false);
        }
      }
    }

    loadReview();

    return () => {
      cancelled = true;
    };
  }, [active, clearTextAnswerTimeout]);

  useEffect(() => {
    return () => {
      clearTextAnswerTimeout();
    };
  }, [clearTextAnswerTimeout]);

  const startBonusReview = useCallback(async () => {
    if (bonusReviewLoading || !canStartBonusReview) return;

    setBonusReviewLoading(true);
    setReviewError("");

    try {
      await waitForTextAnswerRequests();
      const data = await getReview({ includeNew: true });

      setQuestions(data);
      setCurrentIndex(0);
      setShowAnswer(false);
      setSelectedTextQuality(null);
      setAnsweredTextByIndex({});
      setReturnToLastQuestionArmed(false);
      setBonusReviewStarted(data.length === 0 || data.every(reviewItemIsNew));
      textAnswerRequestsRef.current = {};
    } catch (error) {
      console.error(error);
      setReviewError(error.message || "Impossible de charger les questions bonus.");
    } finally {
      setBonusReviewLoading(false);
    }
  }, [
    bonusReviewLoading,
    canStartBonusReview,
    waitForTextAnswerRequests
  ]);

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event) {
      if (
        current?.type_q === "map" ||
        current?.type_q === "timeline" ||
        (current?.type_q === "image" && current?.items)
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
        if (event.key === "0") {
          event.preventDefault();
          handleTextAnswer(0);
        }
        if (event.key === "1") {
          event.preventDefault();
          handleTextAnswer(1);
        }
        if (event.key === "2") {
          event.preventDefault();
          handleTextAnswer(2);
        }
        if (event.key === "3") {
          event.preventDefault();
          handleTextAnswer(3);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, current?.items, current?.type_q, showAnswer, handleTextAnswer]);

  return {
    bonusReviewLoading,
    canStartBonusReview,
    currentIndex,
    handleImageComplete,
    handleMapComplete,
    handleTimelineComplete,
    handleTextAnswer,
    canReturnToLastQuestion,
    currentTextQuality: currentTextAnswer?.quality ?? null,
    returnToLastQuestion,
    startBonusReview,
    selectedTextQuality,
    submitImageAnswer,
    submitMapAnswer,
    submitTimelineAnswer,
    questions,
    reviewError,
    reviewLoading,
    setShowAnswer,
    showAnswer
  };
}
