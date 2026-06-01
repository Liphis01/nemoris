import { useMemo, useState } from "react";
import { sendImageAnswer } from "../../../api/review";


export function normalizeImageAnswer(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/[-\s]+/g, " ");
}


export function matchesImageAnswer(item, value) {
  const normalized = normalizeImageAnswer(value);

  if (!normalized) return false;

  const answers = [
    item?.label,
    item?.answer,
    ...(item?.aliases || item?.data?.aliases || [])
  ];

  return answers.some(answer => normalizeImageAnswer(answer) === normalized);
}


export function defaultImageSuccessQuality(wrongAttempts = 0) {
  return wrongAttempts > 0 ? 1 : 2;
}


function ensureCompleteQualities(reviewItems, qualityByQuestionId) {
  const complete = { ...qualityByQuestionId };

  reviewItems.forEach(item => {
    if (complete[item.question_id] === undefined) {
      complete[item.question_id] = 0;
    }
  });

  return complete;
}


export function useImageReview(reviewItems, onComplete) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [input, setInput] = useState("");
  const [wrongAttemptsByQuestionId, setWrongAttemptsByQuestionId] = useState({});
  const [qualityByQuestionId, setQualityByQuestionId] = useState({});
  const [feedbackTone, setFeedbackTone] = useState(null);
  const [showRecap, setShowRecap] = useState(false);

  const activeItem = reviewItems[activeIndex] || null;
  const answeredCount = Object.keys(qualityByQuestionId).length;
  const progressPercent = reviewItems.length
    ? (answeredCount / reviewItems.length) * 100
    : 0;

  function advance(nextQualities) {
    const answered = Object.keys(nextQualities).length;

    if (answered >= reviewItems.length) {
      setQualityByQuestionId(ensureCompleteQualities(reviewItems, nextQualities));
      setShowRecap(true);
      return;
    }

    setActiveIndex(prev => Math.min(prev + 1, reviewItems.length - 1));
  }

  function handleSubmit() {
    if (!activeItem) return;

    if (!matchesImageAnswer(activeItem, input)) {
      if (input.trim()) {
        setWrongAttemptsByQuestionId(prev => ({
          ...prev,
          [activeItem.question_id]: (prev[activeItem.question_id] || 0) + 1
        }));
        setFeedbackTone("incorrect");
      }
      return;
    }

    const quality = defaultImageSuccessQuality(
      wrongAttemptsByQuestionId[activeItem.question_id] || 0
    );
    const nextQualities = {
      ...qualityByQuestionId,
      [activeItem.question_id]: quality
    };

    setFeedbackTone(null);
    setInput("");
    setQualityByQuestionId(nextQualities);
    advance(nextQualities);
  }

  function skipItem() {
    if (!activeItem) return;

    const nextQualities = {
      ...qualityByQuestionId,
      [activeItem.question_id]: 0
    };

    setFeedbackTone(null);
    setInput("");
    setQualityByQuestionId(nextQualities);
    advance(nextQualities);
  }

  function finishReview() {
    setQualityByQuestionId(prev => ensureCompleteQualities(reviewItems, prev));
    setShowRecap(true);
  }

  function setQuality(questionId, quality) {
    setQualityByQuestionId(prev => ({
      ...prev,
      [questionId]: quality
    }));
  }

  async function sendResult() {
    const completeQualities = ensureCompleteQualities(
      reviewItems,
      qualityByQuestionId
    );

    await sendImageAnswer(completeQualities);

    const failedQuestionIds = Object.entries(completeQualities)
      .filter(([, quality]) => quality === 0)
      .map(([questionId]) => Number(questionId));

    setActiveIndex(0);
    setInput("");
    setWrongAttemptsByQuestionId({});
    setQualityByQuestionId({});
    setFeedbackTone(null);
    setShowRecap(false);

    onComplete(failedQuestionIds);
  }

  const recapRows = useMemo(() => (
    reviewItems.map(item => ({
      item,
      quality: qualityByQuestionId[item.question_id] ?? 0,
      isFailed: (qualityByQuestionId[item.question_id] ?? 0) === 0
    }))
  ), [qualityByQuestionId, reviewItems]);

  return {
    activeIndex,
    activeItem,
    answeredCount,
    feedbackTone,
    finishReview,
    handleSubmit,
    input,
    progressPercent,
    qualityByQuestionId,
    recapRows,
    remainingCount: Math.max(0, reviewItems.length - answeredCount),
    sendResult,
    setInput,
    setQuality,
    showRecap,
    skipItem
  };
}
