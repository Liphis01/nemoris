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


export function defaultImageSuccessQuality() {
  return 2;
}


function shuffled(items) {
  const copy = [...(items || [])];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}


function idsFor(items) {
  return items.map(item => item.question_id);
}


function questionIdSet(ids) {
  return new Set(ids || []);
}


function firstUnfoundFrom(items, foundSet, activeQuestionId) {
  if (items.length === 0) return null;

  const startIndex = Math.max(
    0,
    items.findIndex(item => item.question_id === activeQuestionId)
  );

  for (let offset = 1; offset <= items.length; offset += 1) {
    const item = items[(startIndex + offset) % items.length];

    if (item && !foundSet.has(item.question_id)) {
      return item.question_id;
    }
  }

  return null;
}


function completeQualities(items, qualityByQuestionId, foundQuestionIds) {
  const foundSet = questionIdSet(foundQuestionIds);
  const complete = {};

  items.forEach(item => {
    complete[item.question_id] = foundSet.has(item.question_id)
      ? qualityByQuestionId[item.question_id] ?? defaultImageSuccessQuality()
      : 0;
  });

  return complete;
}


export function useImageReview(reviewItems, onComplete) {
  const reviewKey = useMemo(
    () => idsFor(reviewItems).join("|"),
    [reviewItems]
  );
  const shuffledItems = useMemo(
    () => shuffled(reviewItems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewKey]
  );
  const [activeQuestionId, setActiveQuestionId] = useState(null);
  const [input, setInput] = useState("");
  const [foundQuestionIds, setFoundQuestionIds] = useState([]);
  const [lockedMissedQuestionIds, setLockedMissedQuestionIds] = useState([]);
  const [qualityByQuestionId, setQualityByQuestionId] = useState({});
  const [feedbackTone, setFeedbackTone] = useState(null);
  const [resultMode, setResultMode] = useState(false);

  const foundQuestionIdSet = useMemo(
    () => questionIdSet(foundQuestionIds),
    [foundQuestionIds]
  );
  const lockedMissedQuestionIdSet = useMemo(
    () => questionIdSet(lockedMissedQuestionIds),
    [lockedMissedQuestionIds]
  );
  const activeItem = useMemo(() => {
    const effectiveActiveQuestionId =
      activeQuestionId ||
      shuffledItems.find(item => !foundQuestionIdSet.has(item.question_id))?.question_id;

    return shuffledItems.find(item => item.question_id === effectiveActiveQuestionId) || null;
  }, [activeQuestionId, foundQuestionIdSet, shuffledItems]);
  const answeredCount = foundQuestionIds.length;
  const progressPercent = shuffledItems.length
    ? (answeredCount / shuffledItems.length) * 100
    : 0;

  function selectItem(questionId) {
    if (resultMode || foundQuestionIdSet.has(questionId)) return;

    setActiveQuestionId(questionId);
    setInput("");
    setFeedbackTone(null);
  }

  function enterResultMode(nextFoundIds, nextQualities) {
    const foundSet = questionIdSet(nextFoundIds);
    const missedIds = shuffledItems
      .filter(item => !foundSet.has(item.question_id))
      .map(item => item.question_id);

    setLockedMissedQuestionIds(missedIds);
    setQualityByQuestionId(completeQualities(
      shuffledItems,
      nextQualities,
      nextFoundIds
    ));
    setInput("");
    setFeedbackTone(null);
    setActiveQuestionId(null);
    setResultMode(true);
  }

  function handleSubmit() {
    if (resultMode || !activeItem) return;

    if (!matchesImageAnswer(activeItem, input)) {
      if (input.trim()) {
        setFeedbackTone("incorrect");
      }
      return;
    }

    const nextFoundIds = foundQuestionIds.includes(activeItem.question_id)
      ? foundQuestionIds
      : [...foundQuestionIds, activeItem.question_id];
    const nextFoundSet = questionIdSet(nextFoundIds);
    const nextQualities = {
      ...qualityByQuestionId,
      [activeItem.question_id]: defaultImageSuccessQuality()
    };

    setFoundQuestionIds(nextFoundIds);
    setQualityByQuestionId(nextQualities);
    setInput("");
    setFeedbackTone(null);

    if (nextFoundIds.length >= shuffledItems.length) {
      enterResultMode(nextFoundIds, nextQualities);
      return;
    }

    setActiveQuestionId(firstUnfoundFrom(
      shuffledItems,
      nextFoundSet,
      activeItem.question_id
    ));
  }

  function finishReview() {
    enterResultMode(foundQuestionIds, qualityByQuestionId);
  }

  function setQuality(questionId, quality) {
    const nextQuality = Number(quality);

    if (
      lockedMissedQuestionIdSet.has(questionId) ||
      ![1, 2, 3].includes(nextQuality)
    ) {
      return;
    }

    setQualityByQuestionId(prev => ({
      ...prev,
      [questionId]: nextQuality
    }));
  }

  async function sendResult() {
    const qualities = completeQualities(
      shuffledItems,
      qualityByQuestionId,
      foundQuestionIds
    );

    await sendImageAnswer(qualities);

    const failedQuestionIds = Object.entries(qualities)
      .filter(([, quality]) => quality === 0)
      .map(([questionId]) => Number(questionId));

    setActiveQuestionId(null);
    setInput("");
    setFoundQuestionIds([]);
    setLockedMissedQuestionIds([]);
    setQualityByQuestionId({});
    setFeedbackTone(null);
    setResultMode(false);

    onComplete(failedQuestionIds);
  }

  const gridItems = useMemo(() => (
    shuffledItems.map(item => {
      const isFound = foundQuestionIdSet.has(item.question_id);
      const isLockedMissed = lockedMissedQuestionIdSet.has(item.question_id);

      return {
        item,
        isActive: !resultMode && activeItem?.question_id === item.question_id,
        isFound,
        isLockedMissed,
        quality: isFound
          ? qualityByQuestionId[item.question_id] ?? defaultImageSuccessQuality()
          : isLockedMissed
            ? 0
            : null
      };
    })
  ), [
    activeItem?.question_id,
    foundQuestionIdSet,
    lockedMissedQuestionIdSet,
    qualityByQuestionId,
    resultMode,
    shuffledItems
  ]);

  return {
    activeItem,
    activeQuestionId: activeItem?.question_id || null,
    answeredCount,
    feedbackTone,
    finishReview,
    foundQuestionIds,
    gridItems,
    handleSubmit,
    input,
    lockedMissedQuestionIds,
    progressPercent,
    qualityByQuestionId,
    remainingCount: Math.max(0, shuffledItems.length - answeredCount),
    resultMode,
    selectItem,
    sendResult,
    setInput,
    setQuality
  };
}
