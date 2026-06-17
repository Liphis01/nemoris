import { useEffect, useMemo, useState } from "react";
import { sendMapAnswer } from "../../../api/review";
import {
  MAP_MODE_CLICK_PROMPT,
  MAP_MODE_MULTIPLE_CHOICE,
  MAP_MODE_TYPE_ALL,
  MAP_MODE_TYPE_PROMPT,
  normalizeMapMode
} from "../mapModes";


function normalize(str = "") {
  // Match user input without case, accent, or hyphen/space sensitivity.
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/[-\s]+/g, " ");
}


function getHistoryStats(item) {
  // Prefer detailed history when present; fall back to reps/lapses for older
  // progress records.
  const history = item.progress?.history || [];

  if (history.length > 0) {
    const successes = history.filter(entry => entry.quality > 0).length;

    return {
      reviews: history.length,
      successRate: Math.round((successes / history.length) * 100)
    };
  }

  const reps = item.progress?.reps || 0;
  const lapses = item.progress?.lapses || 0;

  if (reps > 0) {
    const successes = Math.max(0, reps - lapses);

    return {
      reviews: reps,
      successRate: Math.round((successes / reps) * 100)
    };
  }

  return {
    reviews: 0,
    successRate: null
  };
}


function getDifficultyScore(item, historyStats) {
  // Recap sorting uses explicit scheduler difficulty when available, otherwise
  // estimates from success rate.
  const explicitDifficulty = Number(item.progress?.difficulty);

  if (Number.isFinite(explicitDifficulty)) {
    return explicitDifficulty;
  }

  if (historyStats.successRate !== null) {
    return 10 - (historyStats.successRate / 10);
  }

  return 5;
}


function buildInitialQualityByQuestionId(reviewZones, foundQuestionIdSet) {
  const initial = {};

  reviewZones.forEach(item => {
    // Found zones default to FSRS Good. Missed zones default to Again.
    initial[item.question_id] = foundQuestionIdSet.has(item.question_id) ? 2 : 0;
  });

  return initial;
}


function getNextRemainingZone(reviewZones, completedQuestionIdSet, currentCode) {
  if (reviewZones.length === 0) return null;

  const currentIndex = reviewZones.findIndex(item => item.code === currentCode);
  const startIndex = currentIndex >= 0 ? currentIndex : -1;

  for (let offset = 1; offset <= reviewZones.length; offset += 1) {
    const item = reviewZones[(startIndex + offset) % reviewZones.length];

    if (item && !completedQuestionIdSet.has(item.question_id)) {
      return item;
    }
  }

  return null;
}


const initialRecapSort = {
  key: null,
  direction: "asc"
};
const DISTRACTOR_DIFFICULTY_SCALE = 2.0;


function getSelectedQuality(item, isFound, qualityByQuestionId) {
  return qualityByQuestionId[item.question_id] ?? (isFound ? 2 : 0);
}


function getProjectedInterval(item, selectedQuality) {
  const value =
    item.projected_intervals?.[selectedQuality] ??
    item.progress?.interval ??
    0;
  const interval = Number(value);

  return Number.isFinite(interval) ? interval : 0;
}


function compareDefaultRecapRows(a, b) {
  if (b.difficultyScore !== a.difficultyScore) {
    return b.difficultyScore - a.difficultyScore;
  }

  return String(a.item.label || "").localeCompare(String(b.item.label || ""));
}


function compareActiveRecapSort(a, b, recapSort, qualityByQuestionId) {
  if (recapSort.key === "answer") {
    return String(a.item.label || "").localeCompare(String(b.item.label || ""));
  }

  if (recapSort.key === "success") {
    const aRate = a.historyStats.successRate === null
      ? -1
      : a.historyStats.successRate;
    const bRate = b.historyStats.successRate === null
      ? -1
      : b.historyStats.successRate;

    return aRate - bRate;
  }

  if (recapSort.key === "interval") {
    const aQuality = getSelectedQuality(a.item, a.isFound, qualityByQuestionId);
    const bQuality = getSelectedQuality(b.item, b.isFound, qualityByQuestionId);

    return (
      getProjectedInterval(a.item, aQuality) -
      getProjectedInterval(b.item, bQuality)
    );
  }

  if (recapSort.key === "quality") {
    return (
      getSelectedQuality(a.item, a.isFound, qualityByQuestionId) -
      getSelectedQuality(b.item, b.isFound, qualityByQuestionId)
    );
  }

  return 0;
}


function answerValues(item) {
  const aliases = item.aliases || item.data?.aliases || [];

  return [item.label, ...aliases].filter(Boolean);
}


function itemMatchesInput(item, input) {
  const normalizedInput = normalize(input);

  if (!normalizedInput) return false;

  return answerValues(item).some(value => normalize(value) === normalizedInput);
}


function shuffle(items) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}


function compareDistractorDifficulty(a, b) {
  const aScore = getDifficultyScore(a, getHistoryStats(a));
  const bScore = getDifficultyScore(b, getHistoryStats(b));

  if (bScore !== aScore) {
    return bScore - aScore;
  }

  const labelSort = String(a.label || "").localeCompare(String(b.label || ""));

  if (labelSort !== 0) {
    return labelSort;
  }

  return (a.question_id || 0) - (b.question_id || 0);
}


function distractorWeight(item, maxDifficultyScore) {
  const difficultyScore = getDifficultyScore(item, getHistoryStats(item));

  return Math.exp(
    (difficultyScore - maxDifficultyScore) / DISTRACTOR_DIFFICULTY_SCALE
  );
}


function weightedSampleDistractors(items, count) {
  const candidates = [...(items || [])].sort(compareDistractorDifficulty);
  const selected = [];

  while (selected.length < count && candidates.length > 0) {
    const maxDifficultyScore = Math.max(
      ...candidates.map(item => getDifficultyScore(item, getHistoryStats(item)))
    );
    const weights = candidates.map(item =>
      distractorWeight(item, maxDifficultyScore)
    );
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    let threshold = Math.random() * totalWeight;
    let selectedIndex = candidates.length - 1;

    for (let index = 0; index < candidates.length; index += 1) {
      threshold -= weights[index];

      if (threshold <= 0) {
        selectedIndex = index;
        break;
      }
    }

    selected.push(candidates[selectedIndex]);
    candidates.splice(selectedIndex, 1);
  }

  return selected;
}


function itemKey(items) {
  return (items || []).map(item => item.question_id).join("|");
}


function buildChoiceOptions(target, contextItems) {
  if (!target) return [];

  const distractors = weightedSampleDistractors(
    (contextItems || []).filter(item =>
      item.question_id !== target.question_id && item.label
    ),
    3
  );

  return shuffle([target, ...distractors]);
}


export function useMapReview(
  reviewZones,
  onComplete,
  submitAnswer = sendMapAnswer,
  options = {}
) {
  // This hook turns a runtime map group into an interactive recall session:
  // matching typed answers, prompt resolution, recap quality editing, and
  // per-zone grade submission.
  const mode = normalizeMapMode(options.mode);
  const contextItems = options.contextItems?.length
    ? options.contextItems
    : reviewZones;
  const isPromptMode = mode !== MAP_MODE_TYPE_ALL;
  const [input, setInput] = useState("");
  const [foundQuestionIds, setFoundQuestionIds] = useState([]);
  const [resolvedQuestionIds, setResolvedQuestionIds] = useState([]);
  const [showRecap, setShowRecap] = useState(false);
  const [qualityByQuestionId, setQualityByQuestionId] = useState({});
  const [focusedCode, setFocusedCode] = useState(null);
  const [remainingFocusCode, setRemainingFocusCode] = useState(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [incorrectFlashId, setIncorrectFlashId] = useState(0);
  const [correctFlashId, setCorrectFlashId] = useState(0);
  const [choiceFeedback, setChoiceFeedback] = useState(null);
  const [zoneFeedback, setZoneFeedback] = useState(null);
  const [recapSort, setRecapSort] = useState(initialRecapSort);
  const reviewKey = `${mode}:${itemKey(reviewZones)}`;

  useEffect(() => {
    setInput("");
    setFoundQuestionIds([]);
    setResolvedQuestionIds([]);
    setShowRecap(false);
    setQualityByQuestionId({});
    setFocusedCode(null);
    setRemainingFocusCode(null);
    setFocusVersion(0);
    setIncorrectFlashId(0);
    setCorrectFlashId(0);
    setChoiceFeedback(null);
    setZoneFeedback(null);
    setRecapSort(initialRecapSort);
  }, [reviewKey]);

  useEffect(() => {
    if (!incorrectFlashId && !correctFlashId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIncorrectFlashId(0);
      setCorrectFlashId(0);
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [incorrectFlashId, correctFlashId]);

  useEffect(() => {
    if (!choiceFeedback) return undefined;

    const timeout = window.setTimeout(() => {
      setChoiceFeedback(current =>
        current?.id === choiceFeedback.id ? null : current
      );
    }, 1300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [choiceFeedback]);

  useEffect(() => {
    if (!zoneFeedback) return undefined;

    const timeout = window.setTimeout(() => {
      setZoneFeedback(current =>
        current?.id === zoneFeedback.id ? null : current
      );
    }, 800);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [zoneFeedback]);

  const promptQueue = useMemo(
    () => {
      // Lock the random order to the current mode/session key.
      const currentReviewKey = reviewKey;

      return currentReviewKey && isPromptMode ? shuffle(reviewZones) : reviewZones;
    },
    [isPromptMode, reviewKey, reviewZones]
  );

  const zoneByAnswer = useMemo(() => {
    // Build a normalized lookup from every label and alias to its zone item.
    const lookup = new Map();

    reviewZones.forEach(item => {
      answerValues(item).forEach(value => {
        const normalized = normalize(value);

        if (normalized && !lookup.has(normalized)) {
          lookup.set(normalized, item);
        }
      });
    });

    return lookup;
  }, [reviewZones]);

  const foundQuestionIdSet = useMemo(
    () => new Set(foundQuestionIds),
    [foundQuestionIds]
  );

  const resolvedQuestionIdSet = useMemo(
    () => new Set(resolvedQuestionIds),
    [resolvedQuestionIds]
  );

  const completedQuestionIdSet = isPromptMode
    ? resolvedQuestionIdSet
    : foundQuestionIdSet;

  const currentPromptItem = useMemo(
    () =>
      isPromptMode
        ? promptQueue.find(item => !resolvedQuestionIdSet.has(item.question_id))
        : null,
    [isPromptMode, promptQueue, resolvedQuestionIdSet]
  );

  const choiceOptions = useMemo(
    () => buildChoiceOptions(currentPromptItem, contextItems),
    [contextItems, currentPromptItem]
  );

  const foundCodes = useMemo(
    () =>
      reviewZones
        .filter(item => foundQuestionIdSet.has(item.question_id))
        .map(item => item.code),
    [foundQuestionIdSet, reviewZones]
  );

  const missedCodes = useMemo(
    () =>
      reviewZones
        .filter(item => !foundQuestionIdSet.has(item.question_id))
        .map(item => item.code),
    [foundQuestionIdSet, reviewZones]
  );

  const activeMissedCodes = useMemo(
    () =>
      reviewZones
        .filter(item =>
          resolvedQuestionIdSet.has(item.question_id) &&
          !foundQuestionIdSet.has(item.question_id)
        )
        .map(item => item.code),
    [foundQuestionIdSet, resolvedQuestionIdSet, reviewZones]
  );

  const remainingZones = useMemo(
    () =>
      reviewZones.filter(item => !completedQuestionIdSet.has(item.question_id)),
    [completedQuestionIdSet, reviewZones]
  );

  const dueCodes = useMemo(() => {
    if (mode === MAP_MODE_TYPE_PROMPT || mode === MAP_MODE_MULTIPLE_CHOICE) {
      return currentPromptItem?.code ? [currentPromptItem.code] : [];
    }

    return remainingZones.map(item => item.code);
  }, [currentPromptItem, mode, remainingZones]);

  useEffect(() => {
    if (showRecap || reviewZones.length === 0) return;
    if (mode === MAP_MODE_MULTIPLE_CHOICE && choiceFeedback) return;

    const allZonesComplete = reviewZones.every(item =>
      completedQuestionIdSet.has(item.question_id)
    );

    if (!allZonesComplete) return;

    setQualityByQuestionId(
      buildInitialQualityByQuestionId(reviewZones, foundQuestionIdSet)
    );
    setShowRecap(true);
  }, [
    completedQuestionIdSet,
    choiceFeedback,
    foundQuestionIdSet,
    mode,
    reviewZones,
    showRecap
  ]);

  function rememberFound(item) {
    if (!item) return;

    setFoundQuestionIds(prev =>
      prev.includes(item.question_id) ? prev : [...prev, item.question_id]
    );
  }

  function rememberResolved(item) {
    if (!item || !isPromptMode) return;

    setResolvedQuestionIds(prev =>
      prev.includes(item.question_id) ? prev : [...prev, item.question_id]
    );
  }

  function markFound(item) {
    // Do not count a zone twice if the user types an alias after finding it.
    if (!item || foundQuestionIdSet.has(item.question_id)) return;

    rememberFound(item);
    rememberResolved(item);
    setCorrectFlashId(Date.now());
    setIncorrectFlashId(0);
    setInput("");
  }

  function markMissed(item) {
    if (!item) return;

    rememberResolved(item);
    setIncorrectFlashId(Date.now());
    setCorrectFlashId(0);
    setInput("");
  }

  function handleSubmit() {
    if (mode === MAP_MODE_TYPE_PROMPT) {
      if (currentPromptItem && itemMatchesInput(currentPromptItem, input)) {
        markFound(currentPromptItem);
      } else if (input.trim()) {
        setIncorrectFlashId(Date.now());
        setCorrectFlashId(0);
        setInput("");
      }

      return;
    }

    if (mode !== MAP_MODE_TYPE_ALL) return;

    const match = zoneByAnswer.get(normalize(input));

    if (match && !foundQuestionIdSet.has(match.question_id)) {
      markFound(match);
    } else if (input.trim()) {
      setIncorrectFlashId(Date.now());
      setCorrectFlashId(0);
    }

    setInput("");
  }

  function handleZoneSelect(code) {
    if (mode !== MAP_MODE_CLICK_PROMPT || !currentPromptItem) {
      return;
    }

    const clickedItem = reviewZones.find(item => item.code === code);

    if (!clickedItem || resolvedQuestionIdSet.has(clickedItem.question_id)) {
      return;
    }

    if (currentPromptItem.code === code) {
      markFound(currentPromptItem);
    } else {
      if (clickedItem?.code) {
        setZoneFeedback({
          id: Date.now(),
          flashCodes: [clickedItem.code]
        });
      }

      markMissed(currentPromptItem);
    }
  }

  function handleChoiceSelect(questionId) {
    if (
      mode !== MAP_MODE_MULTIPLE_CHOICE ||
      !currentPromptItem ||
      choiceFeedback
    ) {
      return;
    }

    const isCorrect = currentPromptItem.question_id === questionId;

    setChoiceFeedback({
      id: Date.now(),
      correctCode: currentPromptItem.code,
      correctQuestionId: currentPromptItem.question_id,
      isCorrect,
      options: choiceOptions,
      selectedQuestionId: questionId
    });

    if (isCorrect) {
      markFound(currentPromptItem);
    } else {
      markMissed(currentPromptItem);
    }
  }

  function skipCurrentPrompt() {
    if (!currentPromptItem) return;

    markMissed(currentPromptItem);
  }

  function focusNextRemainingZone() {
    if (currentPromptItem) {
      setRemainingFocusCode(currentPromptItem.code);
      setFocusVersion(version => version + 1);
      return;
    }

    const nextCode = getNextRemainingZone(
      reviewZones,
      completedQuestionIdSet,
      remainingFocusCode
    )?.code;

    if (!nextCode) return;

    setRemainingFocusCode(nextCode);
    setFocusVersion(version => version + 1);
  }

  function finishMap() {
    // Initial recap grades are optimistic but not maximal: found zones are Good,
    // missed zones are Again. The user can adjust before submitting.
    setQualityByQuestionId(
      buildInitialQualityByQuestionId(reviewZones, foundQuestionIdSet)
    );
    setShowRecap(true);
  }

  async function sendResult() {
    // Send one quality per atomic map question, then tell the parent review
    // session which zones should be re-queued.
    await submitAnswer(qualityByQuestionId, mode, contextItems.length);

    const failedQuestionIds = Object.entries(qualityByQuestionId)
      .filter(([, quality]) => quality === 0)
      .map(([questionId]) => Number(questionId));

    setShowRecap(false);
    setFoundQuestionIds([]);
    setResolvedQuestionIds([]);
    setQualityByQuestionId({});
    setFocusedCode(null);
    setRemainingFocusCode(null);
    setFocusVersion(0);

    onComplete(failedQuestionIds);
  }

  function setQuality(id, quality) {
    setQualityByQuestionId(prev => ({
      ...prev,
      [id]: quality
    }));
  }

  function setFoundZoneQualities(quality) {
    setQualityByQuestionId(prev => {
      if (foundQuestionIdSet.size === 0) return prev;

      const next = { ...prev };
      foundQuestionIdSet.forEach(id => {
        next[id] = quality;
      });

      return next;
    });
  }

  function toggleRecapSort(key) {
    setRecapSort(prev => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
    }));
  }

  const completedCount = isPromptMode
    ? resolvedQuestionIds.length
    : foundQuestionIds.length;
  const progressPercent = reviewZones.length
    ? (completedCount / reviewZones.length) * 100
    : 0;
  const isIncorrectFlash = incorrectFlashId > 0;
  const isCorrectFlash = correctFlashId > 0;
  const feedbackTone = isIncorrectFlash ? "incorrect" : isCorrectFlash ? "correct" : null;
  const recapSuccessCount = Object.values(qualityByQuestionId)
    .filter(quality => quality > 0)
    .length;
  const recapMissCount = reviewZones.length - recapSuccessCount;
  const recapSuccessRate = reviewZones.length
    ? Math.round((recapSuccessCount / reviewZones.length) * 100)
    : 0;
  const recapRows = useMemo(() => {
    // Recap always keeps found zones above missed zones. Header sorting only
    // changes the order inside each section.
    return reviewZones
      .map(item => {
        const historyStats = getHistoryStats(item);
        const isFound = foundQuestionIdSet.has(item.question_id);

        return {
          item,
          historyStats,
          isFound,
          difficultyScore: getDifficultyScore(item, historyStats)
        };
      })
      .sort((a, b) => {
        if (a.isFound !== b.isFound) {
          return a.isFound ? -1 : 1;
        }

        if (!recapSort.key) {
          return compareDefaultRecapRows(a, b);
        }

        const sortResult = compareActiveRecapSort(
          a,
          b,
          recapSort,
          qualityByQuestionId
        );

        if (sortResult !== 0) {
          return recapSort.direction === "asc" ? sortResult : -sortResult;
        }

        return compareDefaultRecapRows(a, b);
      });
  }, [reviewZones, foundQuestionIdSet, qualityByQuestionId, recapSort]);
  const hasCorrectRecapRows = recapRows.some(row => row.isFound);
  const hasWrongRecapRows = recapRows.some(row => !row.isFound);
  const activeChoiceFeedback = mode === MAP_MODE_MULTIPLE_CHOICE
    ? choiceFeedback
    : null;
  const visibleChoiceOptions = activeChoiceFeedback
    ? activeChoiceFeedback.options
    : choiceOptions;
  const visibleDueCodes = activeChoiceFeedback?.correctCode
    ? [activeChoiceFeedback.correctCode]
    : dueCodes;
  const targetHighlightCode = (
    mode === MAP_MODE_TYPE_PROMPT ||
    mode === MAP_MODE_MULTIPLE_CHOICE
  )
    ? activeChoiceFeedback?.correctCode || currentPromptItem?.code || null
    : null;
  const selectedCode = activeChoiceFeedback ? null : targetHighlightCode;

  return {
    activeMissedCodes,
    choiceFeedback: activeChoiceFeedback,
    choiceOptions: visibleChoiceOptions,
    currentPromptItem,
    dueCodes: visibleDueCodes,
    feedbackTone,
    focusedCode,
    focusNextRemainingZone,
    focusVersion,
    foundQuestionIds,
    foundCodes,
    foundQuestionIdSet,
    flashCodes: zoneFeedback?.flashCodes || [],
    finishMap,
    handleChoiceSelect,
    handleSubmit,
    handleZoneSelect,
    input,
    mode,
    qualityByQuestionId,
    missedCodes,
    progressPercent,
    promptCode: currentPromptItem?.code || null,
    promptLabel: currentPromptItem?.label || "",
    recapMissCount,
    recapRows,
    recapSort,
    recapSuccessCount,
    recapSuccessRate,
    manualFocusCode: remainingFocusCode,
    remainingFocusCode: targetHighlightCode || remainingFocusCode,
    remainingZones,
    selectedCode,
    sendResult,
    setFocusedCode,
    setFoundZoneQualities,
    setInput,
    setQuality,
    showRecap,
    showRecapSections: hasCorrectRecapRows && hasWrongRecapRows,
    skipCurrentPrompt,
    toggleRecapSort
  };
}
