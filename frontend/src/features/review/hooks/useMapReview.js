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


export function useMapReview(items, onComplete) {
  const [input, setInput] = useState("");
  const [found, setFound] = useState([]);
  const [showRecap, setShowRecap] = useState(false);
  const [itemQuality, setItemQuality] = useState({});
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

  const answerLookup = useMemo(() => {
    const lookup = new Map();

    items.forEach(item => {
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
  }, [items]);

  const itemByCode = useMemo(() => {
    const lookup = new Map();

    items.forEach(item => {
      if (item.code) {
        lookup.set(item.code, item);
      }
    });

    return lookup;
  }, [items]);

  const foundSet = useMemo(
    () => new Set(found),
    [found]
  );

  const foundCodes = useMemo(
    () =>
      items
        .filter(item => foundSet.has(item.question_id))
        .map(item => item.code),
    [foundSet, items]
  );

  const missedCodes = useMemo(
    () =>
      items
        .filter(item => !foundSet.has(item.question_id))
        .map(item => item.code),
    [foundSet, items]
  );

  const dueCodes = useMemo(
    () => items.map(item => item.code),
    [items]
  );

  function markFound(item) {
    if (!item || foundSet.has(item.question_id)) return;

    setFound(prev => [...prev, item.question_id]);
    setCorrectFlashId(Date.now());
    setIncorrectFlashId(0);
  }

  function handleSubmit() {
    const match = answerLookup.get(normalize(input));

    if (match && !foundSet.has(match.question_id)) {
      markFound(match);
    } else if (input.trim()) {
      setIncorrectFlashId(Date.now());
      setCorrectFlashId(0);
    }

    setInput("");
  }

  function handleZoneSelect(code) {
    markFound(itemByCode.get(code));
  }

  function finishMap() {
    const initial = {};

    items.forEach(item => {
      initial[item.question_id] = foundSet.has(item.question_id) ? 2 : 0;
    });

    setItemQuality(initial);
    setShowRecap(true);
  }

  async function sendResult() {
    await sendMapAnswer(itemQuality);

    const failedQuestionIds = Object.entries(itemQuality)
      .filter(([, quality]) => quality === 0)
      .map(([questionId]) => Number(questionId));

    setShowRecap(false);
    setFound([]);
    setItemQuality({});
    setFocusedCode(null);

    onComplete(failedQuestionIds);
  }

  function setQuality(id, quality) {
    setItemQuality(prev => ({
      ...prev,
      [id]: quality
    }));
  }

  const progressPercent = items.length
    ? (found.length / items.length) * 100
    : 0;
  const isIncorrectFlash = incorrectFlashId > 0;
  const isCorrectFlash = correctFlashId > 0;
  const feedbackTone = isIncorrectFlash ? "incorrect" : isCorrectFlash ? "correct" : null;
  const recapSuccessCount = Object.values(itemQuality)
    .filter(quality => quality > 0)
    .length;
  const recapMissCount = items.length - recapSuccessCount;
  const recapSuccessRate = items.length
    ? Math.round((recapSuccessCount / items.length) * 100)
    : 0;
  const recapRows = useMemo(() => {
    return items
      .map(item => {
        const historyStats = getHistoryStats(item);
        const isFound = foundSet.has(item.question_id);

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
  }, [items, foundSet]);
  const hasCorrectRecapRows = recapRows.some(row => row.isFound);
  const hasWrongRecapRows = recapRows.some(row => !row.isFound);

  return {
    dueCodes,
    feedbackTone,
    focusedCode,
    found,
    foundCodes,
    foundSet,
    finishMap,
    handleSubmit,
    handleZoneSelect,
    input,
    itemQuality,
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
