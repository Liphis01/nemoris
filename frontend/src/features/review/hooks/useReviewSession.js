import { useCallback, useEffect, useMemo, useState } from "react";
import { listCollections } from "../../../api/collections";
import { getReview, sendAnswer } from "../../../api/review";


function parseTags(tagInput) {
  return tagInput
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);
}


export function useReviewSession(active) {
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

    sendAnswer(current.question_id, quality).catch(console.error);

    if (quality === 0) {
      setQuestions(prev => [...prev, current]);
    }

    setShowAnswer(false);
    setCurrentIndex(prev => prev + 1);
  }, [current]);

  function handleMapComplete(failedQuestionIds = []) {
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
  }, [active, showAnswer, handleTextAnswer]);

  return {
    collections,
    currentIndex,
    handleMapComplete,
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
