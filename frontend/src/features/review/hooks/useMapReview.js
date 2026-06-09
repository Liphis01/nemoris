import { useEffect, useMemo, useState } from "react";
import { sendMapAnswer } from "../../../api/review";


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


function getNextRemainingZone(reviewZones, foundQuestionIdSet, currentCode) {
  if (reviewZones.length === 0) return null;

  const currentIndex = reviewZones.findIndex(item => item.code === currentCode);
  const startIndex = currentIndex >= 0 ? currentIndex : -1;

  for (let offset = 1; offset <= reviewZones.length; offset += 1) {
    const item = reviewZones[(startIndex + offset) % reviewZones.length];

    if (item && !foundQuestionIdSet.has(item.question_id)) {
      return item;
    }
  }

  return null;
}


const initialRecapSort = {
  key: null,
  direction: "asc"
};


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


export function useMapReview(
  reviewZones,
  onComplete,
  submitAnswer = sendMapAnswer
) {
  // This hook turns a runtime map group into an interactive recall session:
  // matching typed answers, tracking found zones, then sending per-zone grades.
  const [input, setInput] = useState("");
  const [foundQuestionIds, setFoundQuestionIds] = useState([]);
  const [showRecap, setShowRecap] = useState(false);
  const [qualityByQuestionId, setQualityByQuestionId] = useState({});
  const [focusedCode, setFocusedCode] = useState(null);
  const [remainingFocusCode, setRemainingFocusCode] = useState(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [incorrectFlashId, setIncorrectFlashId] = useState(0);
  const [correctFlashId, setCorrectFlashId] = useState(0);
  const [recapSort, setRecapSort] = useState(initialRecapSort);

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

  const zoneByAnswer = useMemo(() => {
    // Build a normalized lookup from every label and alias to its zone item.
    const lookup = new Map();

    reviewZones.forEach(item => {
      const aliases = item.aliases || item.data?.aliases || [];
      const values = [item.label, ...aliases];

      values.forEach(value => {
        const normalized = normalize(value);

        if (normalized && !lookup.has(normalized)) {
          lookup.set(normalized, item);
        }
      });
    });

    return lookup;
  }, [reviewZones]);

  const zoneByCode = useMemo(() => {
    const lookup = new Map();

    reviewZones.forEach(item => {
      if (item.code) {
        lookup.set(item.code, item);
      }
    });

    return lookup;
  }, [reviewZones]);

  const foundQuestionIdSet = useMemo(
    () => new Set(foundQuestionIds),
    [foundQuestionIds]
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

  const remainingZones = useMemo(
    () =>
      reviewZones.filter(item => !foundQuestionIdSet.has(item.question_id)),
    [foundQuestionIdSet, reviewZones]
  );

  const dueCodes = useMemo(
    () => reviewZones.map(item => item.code),
    [reviewZones]
  );

  useEffect(() => {
    if (showRecap || reviewZones.length === 0) return;

    const nextFoundQuestionIdSet = new Set(foundQuestionIds);
    const allZonesFound = reviewZones.every(item =>
      nextFoundQuestionIdSet.has(item.question_id)
    );

    if (!allZonesFound) return;

    setQualityByQuestionId(
      buildInitialQualityByQuestionId(reviewZones, nextFoundQuestionIdSet)
    );
    setShowRecap(true);
  }, [foundQuestionIds, reviewZones, showRecap]);

  function markFound(item) {
    // Do not count a zone twice if the user types an alias after clicking it.
    if (!item || foundQuestionIdSet.has(item.question_id)) return;

    setFoundQuestionIds(prev =>
      prev.includes(item.question_id) ? prev : [...prev, item.question_id]
    );
    setCorrectFlashId(Date.now());
    setIncorrectFlashId(0);
  }

  function handleSubmit() {
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
    markFound(zoneByCode.get(code));
  }

  function focusNextRemainingZone() {
    const nextCode = getNextRemainingZone(
      reviewZones,
      foundQuestionIdSet,
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
    await submitAnswer(qualityByQuestionId);

    const failedQuestionIds = Object.entries(qualityByQuestionId)
      .filter(([, quality]) => quality === 0)
      .map(([questionId]) => Number(questionId));

    setShowRecap(false);
    setFoundQuestionIds([]);
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

  const progressPercent = reviewZones.length
    ? (foundQuestionIds.length / reviewZones.length) * 100
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

  return {
    dueCodes,
    feedbackTone,
    focusedCode,
    focusNextRemainingZone,
    focusVersion,
    foundQuestionIds,
    foundCodes,
    foundQuestionIdSet,
    finishMap,
    handleSubmit,
    handleZoneSelect,
    input,
    qualityByQuestionId,
    missedCodes,
    progressPercent,
    recapMissCount,
    recapRows,
    recapSort,
    recapSuccessCount,
    recapSuccessRate,
    remainingFocusCode,
    remainingZones,
    sendResult,
    setFocusedCode,
    setFoundZoneQualities,
    setInput,
    setQuality,
    showRecap,
    showRecapSections: hasCorrectRecapRows && hasWrongRecapRows,
    toggleRecapSort
  };
}
