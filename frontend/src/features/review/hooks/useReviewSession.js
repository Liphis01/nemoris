import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getBonusReviewStatus,
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


function nextReviewSkipId(counterRef) {
  counterRef.current += 1;

  return `skip-${counterRef.current}`;
}


function removeSkippedReviewItemId(ids, id) {
  if (!id) return ids;

  return ids.filter(itemId => itemId !== id);
}


function stripReviewSkipId(item) {
  if (!item?._reviewSkipId) return item;

  const { _reviewSkipId, ...rest } = item;

  return rest;
}


function findLastSkippedReviewItem(skippedIds, questions, currentIndex) {
  for (let index = skippedIds.length - 1; index >= 0; index -= 1) {
    const id = skippedIds[index];
    const questionIndex = questions.findIndex(
      question => question?._reviewSkipId === id
    );

    if (questionIndex === -1) {
      continue;
    }

    if (questionIndex <= currentIndex) {
      return null;
    }

    return {
      id,
      index: questionIndex
    };
  }

  return null;
}


function countFutureSkippedReviewItems(skippedIds, questions, currentIndex) {
  const futureSkippedIds = new Set();

  for (const id of skippedIds) {
    const questionIndex = questions.findIndex(
      question => question?._reviewSkipId === id
    );

    if (questionIndex > currentIndex) {
      futureSkippedIds.add(id);
    }
  }

  return futureSkippedIds.size;
}


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


function reviewGroupIdKey(items) {
  const seen = new Set();
  const groupIds = [];

  (items || []).forEach(item => {
    const groupId = Number(item?.group_id);

    if (!Number.isInteger(groupId) || seen.has(groupId)) {
      return;
    }

    seen.add(groupId);
    groupIds.push(groupId);
  });

  return groupIds.join(",");
}


function bonusGroupScopeOptions(groupIdKey) {
  if (!groupIdKey) {
    return {};
  }

  return {
    groupIds: groupIdKey.split(",").map(Number)
  };
}


export function useReviewSession(active) {
  // Owns one review run: fetching due items, moving through the queue, and
  // re-queueing failures for another pass.
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [bonusReviewStatus, setBonusReviewStatus] = useState(null);
  const [bonusStatusLoading, setBonusStatusLoading] = useState(false);
  const [bonusReviewLoading, setBonusReviewLoading] = useState(false);
  const [bonusReviewActive, setBonusReviewActive] = useState(false);
  const [bonusReviewStarted, setBonusReviewStarted] = useState(false);
  const [selectedTextQuality, setSelectedTextQuality] = useState(null);
  const [answeredTextByIndex, setAnsweredTextByIndex] = useState({});
  const [returnToLastQuestionArmed, setReturnToLastQuestionArmed] = useState(false);
  const [skippedReviewItemIds, setSkippedReviewItemIds] = useState([]);
  const reviewSkipIdCounterRef = useRef(0);
  const textAnswerTimeoutRef = useRef(null);
  const textAnswerPendingRef = useRef(false);
  const textAnswerRequestsRef = useRef({});
  const reviewDateRef = useRef(null);

  const current = questions[currentIndex];
  const sameGroupBonusGroupIdKey = useMemo(
    () => reviewGroupIdKey(questions),
    [questions]
  );
  const sameGroupBonusOptions = useMemo(
    () => bonusGroupScopeOptions(sameGroupBonusGroupIdKey),
    [sameGroupBonusGroupIdKey]
  );
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
  const lastSkippedReviewItem = findLastSkippedReviewItem(
    skippedReviewItemIds,
    questions,
    currentIndex
  );
  const skippedQuestionCount = countFutureSkippedReviewItems(
    skippedReviewItemIds,
    questions,
    currentIndex
  );
  const canSkipCurrentQuestion = Boolean(
    bonusReviewActive &&
    current &&
    currentIndex < questions.length - 1 &&
    selectedTextQuality === null
  );
  const canReturnToLastSkippedQuestion = Boolean(
    bonusReviewActive &&
    current &&
    lastSkippedReviewItem &&
    selectedTextQuality === null
  );
  const canStartBonusReview = Boolean(
    !bonusReviewStarted &&
    currentIndex >= questions.length &&
    bonusReviewStatus?.allowed
  );
  const bonusReviewMessage = currentIndex >= questions.length
    ? bonusReviewStatus?.message || ""
    : "";

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

  const skipCurrentQuestion = useCallback(() => {
    if (!canSkipCurrentQuestion) return;

    const skipId = current._reviewSkipId || nextReviewSkipId(reviewSkipIdCounterRef);

    clearTextAnswerTimeout();
    setShowAnswer(false);
    setSelectedTextQuality(null);
    setReturnToLastQuestionArmed(false);
    setQuestions(prev => {
      if (currentIndex >= prev.length - 1) {
        return prev;
      }

      const skipped = {
        ...prev[currentIndex],
        _reviewSkipId: skipId
      };

      return [
        ...prev.slice(0, currentIndex),
        ...prev.slice(currentIndex + 1),
        skipped
      ];
    });
    setSkippedReviewItemIds(prev => [...prev, skipId]);
  }, [
    canSkipCurrentQuestion,
    clearTextAnswerTimeout,
    current,
    currentIndex
  ]);

  const returnToLastSkippedQuestion = useCallback(() => {
    if (!canReturnToLastSkippedQuestion) return;

    const skippedId = lastSkippedReviewItem.id;

    clearTextAnswerTimeout();
    setShowAnswer(false);
    setSelectedTextQuality(null);
    setReturnToLastQuestionArmed(false);
    setQuestions(prev => {
      const skippedIndex = prev.findIndex(
        question => question?._reviewSkipId === skippedId
      );

      if (skippedIndex <= currentIndex) {
        return prev;
      }

      const skipped = prev[skippedIndex];

      return [
        ...prev.slice(0, currentIndex),
        skipped,
        ...prev.slice(currentIndex, skippedIndex),
        ...prev.slice(skippedIndex + 1)
      ];
    });
  }, [
    canReturnToLastSkippedQuestion,
    clearTextAnswerTimeout,
    currentIndex,
    lastSkippedReviewItem
  ]);

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

  const submitImageAnswer = useCallback((
    items,
    mode = undefined,
    contextCount = undefined
  ) => sendImageAnswer(items, mode, contextCount, reviewDateRef.current),
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
              ...stripReviewSkipId(current),
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
      setSkippedReviewItemIds(prev => removeSkippedReviewItemId(
        prev,
        current._reviewSkipId
      ));
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
            ...stripReviewSkipId(current),
            items: failedItems,
            _reviewRetryOfIndex: answerIndex
          }
        ]);
      }
    }

    setCurrentIndex(prev => prev + 1);
    setReturnToLastQuestionArmed(true);
    setSkippedReviewItemIds(prev => removeSkippedReviewItemId(
      prev,
      current?._reviewSkipId
    ));
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
            ...stripReviewSkipId(current),
            items: failedItems,
            _reviewRetryOfIndex: answerIndex
          }
        ]);
      }
    }

    setCurrentIndex(prev => prev + 1);
    setReturnToLastQuestionArmed(true);
    setSkippedReviewItemIds(prev => removeSkippedReviewItemId(
      prev,
      current?._reviewSkipId
    ));
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
            ...stripReviewSkipId(current),
            items: failedItems,
            _reviewRetryOfIndex: answerIndex
          }
        ]);
      }
    }

    setCurrentIndex(prev => prev + 1);
    setReturnToLastQuestionArmed(true);
    setSkippedReviewItemIds(prev => removeSkippedReviewItemId(
      prev,
      current?._reviewSkipId
    ));
  }

  useEffect(() => {
    if (!active) {
      clearTextAnswerTimeout();
      setSelectedTextQuality(null);
      setReviewLoading(false);
      setReviewError("");
      setBonusReviewStatus(null);
      setBonusStatusLoading(false);
      setBonusReviewLoading(false);
      setBonusReviewActive(false);
      setBonusReviewStarted(false);
      setAnsweredTextByIndex({});
      setReturnToLastQuestionArmed(false);
      setSkippedReviewItemIds([]);
      reviewSkipIdCounterRef.current = 0;
      textAnswerRequestsRef.current = {};
      reviewDateRef.current = null;
      return;
    }

    let cancelled = false;

    async function loadReview() {
      setReviewLoading(true);
      setReviewError("");
      setBonusReviewStatus(null);
      setBonusStatusLoading(false);
      setBonusReviewLoading(false);
      setBonusReviewActive(false);
      setBonusReviewStarted(false);
      setQuestions([]);
      setCurrentIndex(0);
      setShowAnswer(false);
      setSelectedTextQuality(null);
      setAnsweredTextByIndex({});
      setReturnToLastQuestionArmed(false);
      setSkippedReviewItemIds([]);
      reviewSkipIdCounterRef.current = 0;
      textAnswerRequestsRef.current = {};
      reviewDateRef.current = localReviewDateString();

      try {
        const data = await getReview();
        const bonusStatus = data.length === 0
          ? await getBonusReviewStatus()
          : null;

        if (cancelled) return;

        setQuestions(data);
        setBonusReviewStatus(bonusStatus);
        setBonusStatusLoading(false);
        setReviewLoading(false);
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setReviewError(error.message || "Impossible de préparer la session.");
          setBonusStatusLoading(false);
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

  useEffect(() => {
    if (
      !active ||
      reviewLoading ||
      reviewError ||
      bonusReviewStatus ||
      bonusReviewStarted ||
      currentIndex < questions.length
    ) {
      return undefined;
    }

    let cancelled = false;

    async function loadBonusStatus() {
      setBonusStatusLoading(true);

      if (questions.length > 0) {
        setBonusReviewStatus(null);
      }

      try {
        await waitForTextAnswerRequests();
        const status = await getBonusReviewStatus(sameGroupBonusOptions);

        if (!cancelled) {
          setBonusReviewStatus(status);
        }
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setReviewError(error.message || "Impossible de vérifier le planning bonus.");
        }
      } finally {
        if (!cancelled) {
          setBonusStatusLoading(false);
        }
      }
    }

    loadBonusStatus();

    return () => {
      cancelled = true;
    };
  }, [
    active,
    bonusReviewStatus,
    bonusReviewStarted,
    currentIndex,
    questions.length,
    reviewError,
    reviewLoading,
    sameGroupBonusOptions,
    waitForTextAnswerRequests
  ]);

  const startBonusReview = useCallback(async () => {
    if (bonusReviewLoading || currentIndex < questions.length) return;

    setBonusReviewLoading(true);
    setReviewError("");

    try {
      await waitForTextAnswerRequests();
      const bonusStatus = await getBonusReviewStatus(sameGroupBonusOptions);
      setBonusReviewStatus(bonusStatus);

      if (!bonusStatus.allowed) {
        return;
      }

      const data = await getReview({
        includeNew: true,
        ...sameGroupBonusOptions
      });

      setQuestions(data);
      setCurrentIndex(0);
      setShowAnswer(false);
      setSelectedTextQuality(null);
      setAnsweredTextByIndex({});
      setReturnToLastQuestionArmed(false);
      setSkippedReviewItemIds([]);
      setBonusReviewActive(true);
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
    currentIndex,
    questions.length,
    sameGroupBonusOptions,
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
    bonusReviewMessage,
    bonusReviewStatus,
    bonusStatusLoading,
    canStartBonusReview,
    currentIndex,
    handleImageComplete,
    handleMapComplete,
    handleTimelineComplete,
    handleTextAnswer,
    canReturnToLastQuestion,
    canReturnToLastSkippedQuestion,
    canSkipCurrentQuestion,
    currentTextQuality: currentTextAnswer?.quality ?? null,
    returnToLastSkippedQuestion,
    returnToLastQuestion,
    skipCurrentQuestion,
    skippedQuestionCount,
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
