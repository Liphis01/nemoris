import { useEffect, useMemo, useState } from "react";
import { sendMapAnswer } from "../../../api/review";


function normalize(str = "") {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}


function getHistoryStats(item) {
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
  const explicitDifficulty = Number(item.progress?.difficulty);

  if (Number.isFinite(explicitDifficulty)) {
    return explicitDifficulty;
  }

  if (historyStats.successRate !== null) {
    return 10 - (historyStats.successRate / 10);
  }

  return 5;
}


export function useMapReview(reviewZones, onComplete) {
  const [input, setInput] = useState("");
  const [foundQuestionIds, setFoundQuestionIds] = useState([]);
  const [showRecap, setShowRecap] = useState(false);
  const [qualityByQuestionId, setQualityByQuestionId] = useState({});
  const [focusedCode, setFocusedCode] = useState(null);
  const [incorrectFlashId, setIncorrectFlashId] = useState(0);
  const [correctFlashId, setCorrectFlashId] = useState(0);

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

  const dueCodes = useMemo(
    () => reviewZones.map(item => item.code),
    [reviewZones]
  );

  function markFound(item) {
    if (!item || foundQuestionIdSet.has(item.question_id)) return;

    setFoundQuestionIds(prev => [...prev, item.question_id]);
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

  function finishMap() {
    const initial = {};

    reviewZones.forEach(item => {
      initial[item.question_id] = foundQuestionIdSet.has(item.question_id) ? 2 : 0;
    });

    setQualityByQuestionId(initial);
    setShowRecap(true);
  }

  async function sendResult() {
    await sendMapAnswer(qualityByQuestionId);

    const failedQuestionIds = Object.entries(qualityByQuestionId)
      .filter(([, quality]) => quality === 0)
      .map(([questionId]) => Number(questionId));

    setShowRecap(false);
    setFoundQuestionIds([]);
    setQualityByQuestionId({});
    setFocusedCode(null);

    onComplete(failedQuestionIds);
  }

  function setQuality(id, quality) {
    setQualityByQuestionId(prev => ({
      ...prev,
      [id]: quality
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

        if (b.difficultyScore !== a.difficultyScore) {
          return b.difficultyScore - a.difficultyScore;
        }

        return String(a.item.label || "").localeCompare(String(b.item.label || ""));
      });
  }, [reviewZones, foundQuestionIdSet]);
  const hasCorrectRecapRows = recapRows.some(row => row.isFound);
  const hasWrongRecapRows = recapRows.some(row => !row.isFound);

  return {
    dueCodes,
    feedbackTone,
    focusedCode,
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
    recapSuccessCount,
    recapSuccessRate,
    sendResult,
    setFocusedCode,
    setInput,
    setQuality,
    showRecap,
    showRecapSections: hasCorrectRecapRows && hasWrongRecapRows
  };
}
