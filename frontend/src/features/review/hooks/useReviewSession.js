import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getBonusReviewStatus,
  getBonusGroups,
  getBonusGroupItems,
  getReview,
  sendMediaAnswer,
  sendMapAnswer,
  sendTextAnswer,
  sendTimelineAnswer,
  sendSequenceAnswer,
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


function bonusEntryTypeLabel(typeQ, isContainer) {
  if (!isContainer) {
    return "Question";
  }

  if (typeQ === "map") return "Carte";
  if (typeQ === "media") return "Médias";
  if (typeQ === "text") return "Texte";
  if (typeQ === "timeline") return "Frise";
  if (typeQ === "sequence") return "Séquence";

  return "Groupe";
}


function buildBonusMenuEntries(entries) {
  // The backend already collapses new questions into one menu entry per group /
  // loose question (name, type, count, tags). The full per-item payload is
  // fetched lazily when the entry is picked, so entries here carry no chunks.
  return (entries || []).map(entry => ({
    key: entry.key,
    label: entry.name || (entry.is_container ? "Groupe" : "Question"),
    typeLabel: bonusEntryTypeLabel(entry.type_q, Boolean(entry.is_container)),
    isContainer: Boolean(entry.is_container),
    itemCount: entry.item_count || 0,
    tags: entry.tags || []
  }));
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
  const [bonusItemLoading, setBonusItemLoading] = useState(false);
  const [bonusReviewActive, setBonusReviewActive] = useState(false);
  const [bonusReviewStarted, setBonusReviewStarted] = useState(false);
  const [bonusMenuItems, setBonusMenuItems] = useState([]);
  const [bonusMenuOpen, setBonusMenuOpen] = useState(false);
  const [completedBonusKeys, setCompletedBonusKeys] = useState([]);
  const [activeBonusKey, setActiveBonusKey] = useState(null);
  const [selectedTextQuality, setSelectedTextQuality] = useState(null);
  const [answeredTextByIndex, setAnsweredTextByIndex] = useState({});
  const [returnToLastQuestionArmed, setReturnToLastQuestionArmed] = useState(false);
  const textAnswerTimeoutRef = useRef(null);
  const textAnswerPendingRef = useRef(false);
  const textAnswerRequestsRef = useRef({});
  const reviewDateRef = useRef(null);

  const current = questions[currentIndex];
  const bonusMenuEntries = useMemo(
    () => buildBonusMenuEntries(bonusMenuItems).filter(
      entry => !completedBonusKeys.includes(entry.key)
    ),
    [bonusMenuItems, completedBonusKeys]
  );
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
  const canStartBonusReview = Boolean(
    !bonusReviewStarted &&
    currentIndex >= questions.length &&
    bonusReviewStatus?.allowed
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

  const selectBonusItem = useCallback(async (entry) => {
    if (!entry || bonusItemLoading) return;

    clearTextAnswerTimeout();
    setBonusItemLoading(true);
    setReviewError("");

    try {
      // The menu only carries names/counts; fetch the picked entry's full
      // payload (questions, media, projected intervals) on demand.
      const chunks = await getBonusGroupItems(entry.key);

      if (!Array.isArray(chunks) || chunks.length === 0) {
        // Nothing left to review for this entry: drop it and stay in the menu.
        setCompletedBonusKeys(prev =>
          prev.includes(entry.key) ? prev : [...prev, entry.key]
        );
        return;
      }

      setActiveBonusKey(entry.key);
      setQuestions(chunks);
      setCurrentIndex(0);
      setShowAnswer(false);
      setSelectedTextQuality(null);
      setAnsweredTextByIndex({});
      setReturnToLastQuestionArmed(false);
      setBonusMenuOpen(false);
      textAnswerRequestsRef.current = {};
    } catch (error) {
      console.error(error);
      setReviewError(error.message || "Impossible de charger la question bonus.");
    } finally {
      setBonusItemLoading(false);
    }
  }, [bonusItemLoading, clearTextAnswerTimeout]);

  const returnToBonusMenu = useCallback(() => {
    clearTextAnswerTimeout();
    setActiveBonusKey(null);
    setQuestions([]);
    setCurrentIndex(0);
    setShowAnswer(false);
    setSelectedTextQuality(null);
    setAnsweredTextByIndex({});
    setReturnToLastQuestionArmed(false);
    setBonusMenuOpen(true);
    textAnswerRequestsRef.current = {};
  }, [clearTextAnswerTimeout]);

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

  useEffect(() => {
    if (!active) {
      clearTextAnswerTimeout();
      setSelectedTextQuality(null);
      setReviewLoading(false);
      setReviewError("");
      setBonusReviewStatus(null);
      setBonusStatusLoading(false);
      setBonusReviewLoading(false);
      setBonusItemLoading(false);
      setBonusReviewActive(false);
      setBonusReviewStarted(false);
      setBonusMenuItems([]);
      setBonusMenuOpen(false);
      setCompletedBonusKeys([]);
      setActiveBonusKey(null);
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
      setBonusReviewStatus(null);
      setBonusStatusLoading(false);
      setBonusReviewLoading(false);
      setBonusItemLoading(false);
      setBonusReviewActive(false);
      setBonusReviewStarted(false);
      setBonusMenuItems([]);
      setBonusMenuOpen(false);
      setCompletedBonusKeys([]);
      setActiveBonusKey(null);
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
        const status = await getBonusReviewStatus();

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
    waitForTextAnswerRequests
  ]);

  // When a picked bonus item (and its retries) is fully answered, mark it done
  // and return to the bonus menu instead of ending the whole session.
  useEffect(() => {
    if (!bonusReviewActive || bonusMenuOpen) {
      return;
    }

    if (questions.length === 0 || currentIndex < questions.length) {
      return;
    }

    setCompletedBonusKeys(prev =>
      activeBonusKey && !prev.includes(activeBonusKey)
        ? [...prev, activeBonusKey]
        : prev
    );
    setActiveBonusKey(null);
    setBonusMenuOpen(true);
    setQuestions([]);
    setCurrentIndex(0);
    setShowAnswer(false);
    setSelectedTextQuality(null);
    setAnsweredTextByIndex({});
    setReturnToLastQuestionArmed(false);
  }, [
    activeBonusKey,
    bonusMenuOpen,
    bonusReviewActive,
    currentIndex,
    questions.length
  ]);

  const startBonusReview = useCallback(async () => {
    if (bonusReviewLoading || currentIndex < questions.length) return;

    setBonusReviewLoading(true);
    setReviewError("");

    try {
      await waitForTextAnswerRequests();
      const bonusStatus = await getBonusReviewStatus();
      setBonusReviewStatus(bonusStatus);

      if (!bonusStatus.allowed) {
        return;
      }

      // Load only the selection list (names/counts) — every available group,
      // no cap. Each entry's full payload is fetched lazily on pick.
      const entries = await getBonusGroups();

      setBonusMenuItems(entries);
      setCompletedBonusKeys([]);
      setActiveBonusKey(null);
      setQuestions([]);
      setCurrentIndex(0);
      setShowAnswer(false);
      setSelectedTextQuality(null);
      setAnsweredTextByIndex({});
      setReturnToLastQuestionArmed(false);
      setBonusReviewActive(true);
      setBonusMenuOpen(true);
      setBonusReviewStarted(true);
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
    waitForTextAnswerRequests
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
    bonusReviewActive,
    bonusReviewLoading,
    bonusItemLoading,
    bonusReviewStatus,
    bonusStatusLoading,
    bonusMenuOpen,
    bonusMenuEntries,
    selectBonusItem,
    returnToBonusMenu,
    canStartBonusReview,
    currentIndex,
    handleImageComplete,
    handleMapComplete,
    handleTimelineComplete,
    handleSequenceComplete,
    handleTextAnswer,
    canReturnToLastQuestion,
    currentTextQuality: currentTextAnswer?.quality ?? null,
    returnToLastQuestion,
    startBonusReview,
    selectedTextQuality,
    submitMediaAnswer,
    submitMapAnswer,
    submitTextAnswer,
    submitTimelineAnswer,
    submitSequenceAnswer,
    questions,
    reviewError,
    reviewLoading,
    setShowAnswer,
    showAnswer
  };
}
