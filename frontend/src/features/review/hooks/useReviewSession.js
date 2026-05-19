import { useCallback, useEffect, useMemo, useState } from "react";
import { listCollections } from "../../../api/collections";
import { getReview, sendAnswer } from "../../../api/review";


function parseTags(tagInput) {
  // Tags are entered as a comma-separated filter in the review toolbar.
  return tagInput
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);
}


export function useReviewSession(active) {
  // Owns one review run: fetching due items, moving through the queue, and
  // re-queueing failures for another pass.
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [limit, setLimit] = useState(200);
  const [tagInput, setTagInput] = useState("");
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState("");

  const current = questions[currentIndex];

  const selectedTags = useMemo(
    () => parseTags(tagInput),
    [tagInput]
  );

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
    if (!active) return;

    listCollections()
      .then(setCollections)
      .catch(console.error);
  }, [active]);

  useEffect(() => {
    if (!active) return;

    // Re-fetch whenever filters change so the backend remains responsible for
    // due selection and runtime grouping.
    getReview(
      selectedTags,
      limit,
      selectedCollection || null
    )
      .then((data) => {
        setQuestions(data);
        setCurrentIndex(0);
        setShowAnswer(false);
      })
      .catch(console.error);
  }, [active, selectedCollection, selectedTags, limit]);

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event) {
      if (current?.type_q === "map" || current?.type_q === "timeline") {
        return;
      }

      // Keyboard review flow: Enter reveals, then 1/2/3 grades the visible
      // answer. Map review handles its own input shortcuts.
      if (event.key === "Enter") {
        if (!showAnswer) {
          setShowAnswer(true);
        }
        return;
      }

      if (showAnswer) {
        if (event.key === "1") handleTextAnswer(0);
        if (event.key === "2") handleTextAnswer(1);
        if (event.key === "3") handleTextAnswer(2);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, current?.type_q, showAnswer, handleTextAnswer]);

  return {
    collections,
    currentIndex,
    handleMapComplete,
    handleTimelineComplete,
    handleTextAnswer,
    limit,
    questions,
    selectedCollection,
    setLimit,
    setSelectedCollection,
    setShowAnswer,
    setTagInput,
    showAnswer,
    tagInput
  };
}
