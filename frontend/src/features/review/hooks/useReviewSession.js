import { useCallback, useEffect, useState } from "react";
import {
  getReview,
  getReviewSettings,
  rebalanceReviewCalendar,
  sendAnswer,
  updateReviewSettings
} from "../../../api/review";


function isEditableTarget(target) {
  if (!target || typeof target.closest !== "function") {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}

export function useReviewSession(active) {
  // Owns one review run: fetching due items, moving through the queue, and
  // re-queueing failures for another pass.
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [catchupTarget, setCatchupTarget] = useState(50);
  const [catchupTargetDraft, setCatchupTargetDraft] = useState("50");
  const [catchupTargetSaving, setCatchupTargetSaving] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const current = questions[currentIndex];

  const handleTextAnswer = useCallback((quality) => {
    if (!current) return;

    // Fire-and-advance keeps review fast. Failures are appended to the end so
    // they appear again after the current queue.
    sendAnswer(current.question_id, quality).catch(console.error);

    if (quality === 0) {
      setQuestions(prev => [...prev, current]);
    }

    setShowAnswer(false);
    setCurrentIndex(prev => prev + 1);
  }, [current]);

  function handleMapComplete(failedQuestionIds = []) {
    // A map screen can contain many atomic zone questions. Only failed zones are
    // re-queued, wrapped back into the same runtime map group shape.
    if (current && failedQuestionIds.length > 0) {
      const failedItems = (current.items || []).filter(item =>
        failedQuestionIds.includes(item.question_id)
      );

      if (failedItems.length > 0) {
        setQuestions(prev => [
          ...prev,
          {
            ...current,
            items: failedItems
          }
        ]);
      }
    }

    setCurrentIndex(prev => prev + 1);
  }

  function handleTimelineComplete(failedQuestionIds = []) {
    // Timeline review also updates many atomic questions from one screen.
    // Failed items are wrapped back into the runtime timeline shape.
    if (current && failedQuestionIds.length > 0) {
      const failedItems = (current.items || []).filter(item =>
        failedQuestionIds.includes(item.question_id)
      );

      if (failedItems.length > 0) {
        setQuestions(prev => [
          ...prev,
          {
            ...current,
            items: failedItems
          }
        ]);
      }
    }

    setCurrentIndex(prev => prev + 1);
  }

  useEffect(() => {
    if (!active) {
      setReviewReady(false);
      setReviewLoading(false);
      setReviewError("");
      return;
    }

    let cancelled = false;

    async function prepareReview() {
      setReviewReady(false);
      setReviewLoading(true);
      setReviewError("");
      setQuestions([]);
      setCurrentIndex(0);
      setShowAnswer(false);

      try {
        const settings = await getReviewSettings();
        const target = settings.catchup_daily_target || 50;

        if (cancelled) return;

        setCatchupTarget(target);
        setCatchupTargetDraft(String(target));

        if (!cancelled) {
          setReviewReady(true);
          setReviewLoading(false);
        }
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setReviewError(error.message || "Impossible de préparer la session.");
          setReviewLoading(false);
        }
      }
    }

    prepareReview();

    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active || !reviewReady) return;

    // The backend owns due selection and runtime grouping.
    getReview()
      .then((data) => {
        setQuestions(data);
        setCurrentIndex(0);
        setShowAnswer(false);
        setReviewError("");
      })
      .catch((error) => {
        console.error(error);
        setReviewError(error.message || "Impossible de charger la session.");
      });
  }, [
    active,
    reviewReady,
    reviewRefreshKey
  ]);

  async function saveCatchupTarget() {
    const parsed = Number(catchupTargetDraft);
    const nextTarget = Number.isFinite(parsed)
      ? Math.max(1, Math.floor(parsed))
      : catchupTarget;

    if (nextTarget === catchupTarget) {
      setCatchupTargetDraft(String(catchupTarget));
      return;
    }

    setCatchupTargetSaving(true);

    try {
      const settings = await updateReviewSettings({
        catchup_daily_target: nextTarget
      });
      const savedTarget = settings.catchup_daily_target || nextTarget;

      setCatchupTarget(savedTarget);
      setCatchupTargetDraft(String(savedTarget));
      await rebalanceReviewCalendar();
      setReviewError("");
      setReviewRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error(error);
      setCatchupTargetDraft(String(catchupTarget));
      setReviewError(error.message || "Impossible de préparer la session.");
    } finally {
      setCatchupTargetSaving(false);
    }
  }

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event) {
      if (current?.type_q === "map" || current?.type_q === "timeline") {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      // Keyboard review flow: Enter reveals, then 1/2/3/4 grades the visible
      // answer. Map review handles its own input shortcuts.
      if (event.key === "Enter") {
        if (!showAnswer) {
          event.preventDefault();
          setShowAnswer(true);
        }
        return;
      }

      if (showAnswer) {
        if (event.key === "1") {
          event.preventDefault();
          handleTextAnswer(0);
        }
        if (event.key === "2") {
          event.preventDefault();
          handleTextAnswer(1);
        }
        if (event.key === "3") {
          event.preventDefault();
          handleTextAnswer(2);
        }
        if (event.key === "4") {
          event.preventDefault();
          handleTextAnswer(3);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, current?.type_q, showAnswer, handleTextAnswer]);

  return {
    currentIndex,
    handleMapComplete,
    handleTimelineComplete,
    handleTextAnswer,
    catchupTargetDraft,
    catchupTargetSaving,
    questions,
    reviewError,
    reviewLoading,
    saveCatchupTarget,
    setCatchupTargetDraft,
    setShowAnswer,
    showAnswer
  };
}
