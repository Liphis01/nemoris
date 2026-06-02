import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getTrainingItems,
  gradeTrainingTimeline,
  listTrainingScopes
} from "../../../api/training";


function isEditableTarget(target) {
  if (!target || typeof target.closest !== "function") {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}


function getReviewItemQuestionIds(item) {
  if (Array.isArray(item?.items)) {
    return item.items
      .map(child => child.question_id)
      .filter(id => id !== undefined && id !== null);
  }

  return item?.question_id === undefined || item?.question_id === null
    ? []
    : [item.question_id];
}


function filterReviewItemsByQuestionIds(items, questionIds) {
  const idSet = questionIds instanceof Set
    ? questionIds
    : new Set(questionIds || []);

  return (items || [])
    .map(item => {
      if (Array.isArray(item?.items)) {
        const failedItems = item.items.filter(child =>
          idSet.has(child.question_id)
        );

        return failedItems.length > 0
          ? {
            ...item,
            items: failedItems
          }
          : null;
      }

      return idSet.has(item?.question_id) ? item : null;
    })
    .filter(Boolean);
}


function addFailedIds(setFailedQuestionIds, failedQuestionIds = []) {
  const ids = failedQuestionIds
    .map(id => Number(id))
    .filter(id => Number.isFinite(id));

  if (ids.length === 0) return;

  setFailedQuestionIds(prev => {
    const next = new Set(prev);

    ids.forEach(id => next.add(id));

    return next;
  });
}


function labelForScope(scope) {
  if (!scope) return "";

  if (scope.type === "group") {
    return scope.name || `Groupe #${scope.id}`;
  }

  return `#${scope.name}`;
}


function scopeRequestOptions(scope) {
  if (scope?.type === "group") {
    return {
      scopeType: "group",
      groupId: scope.id
    };
  }

  return {
    scopeType: "tag",
    tag: scope?.name || ""
  };
}


export function useTrainingSession(active = true) {
  const [scopes, setScopes] = useState({ groups: [], tags: [] });
  const [scopesLoading, setScopesLoading] = useState(false);
  const [scopesError, setScopesError] = useState("");
  const [activeScope, setActiveScope] = useState(null);
  const [originalQuestions, setOriginalQuestions] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingError, setTrainingError] = useState("");
  const [failedQuestionIds, setFailedQuestionIds] = useState(() => new Set());

  const current = questions[currentIndex];
  const failedCount = failedQuestionIds.size;
  const isComplete = Boolean(
    activeScope &&
    !trainingLoading &&
    !trainingError &&
    questions.length > 0 &&
    currentIndex >= questions.length
  );

  const allQuestionIds = useMemo(
    () => originalQuestions.flatMap(getReviewItemQuestionIds),
    [originalQuestions]
  );

  const resetRun = useCallback((items) => {
    setQuestions(items || []);
    setCurrentIndex(0);
    setShowAnswer(false);
    setFailedQuestionIds(new Set());
  }, []);

  const loadScopes = useCallback(async () => {
    setScopesLoading(true);
    setScopesError("");

    try {
      const data = await listTrainingScopes();

      setScopes({
        groups: data.groups || [],
        tags: data.tags || []
      });
    } catch (error) {
      console.error(error);
      setScopesError(error.message || "Impossible de charger les entrainements.");
    } finally {
      setScopesLoading(false);
    }
  }, []);

  const startScope = useCallback(async (scope) => {
    setActiveScope(scope);
    setOriginalQuestions([]);
    setQuestions([]);
    setCurrentIndex(0);
    setShowAnswer(false);
    setFailedQuestionIds(new Set());
    setTrainingLoading(true);
    setTrainingError("");

    try {
      const data = await getTrainingItems(scopeRequestOptions(scope));

      setOriginalQuestions(data || []);
      setQuestions(data || []);
      setCurrentIndex(0);
      setShowAnswer(false);
    } catch (error) {
      console.error(error);
      setTrainingError(error.message || "Impossible de preparer l'entrainement.");
    } finally {
      setTrainingLoading(false);
    }
  }, []);

  const returnToScopeSelector = useCallback(() => {
    setActiveScope(null);
    setOriginalQuestions([]);
    setQuestions([]);
    setCurrentIndex(0);
    setShowAnswer(false);
    setFailedQuestionIds(new Set());
    setTrainingError("");
  }, []);

  const restartFullScope = useCallback(() => {
    resetRun(originalQuestions);
  }, [originalQuestions, resetRun]);

  const retryFailedItems = useCallback(() => {
    if (failedQuestionIds.size === 0) return;

    resetRun(filterReviewItemsByQuestionIds(originalQuestions, failedQuestionIds));
  }, [failedQuestionIds, originalQuestions, resetRun]);

  const handleTextAnswer = useCallback(() => {
    if (!current) return;

    setShowAnswer(false);
    setCurrentIndex(prev => prev + 1);
  }, [current]);

  const handleMapComplete = useCallback((failedIds = []) => {
    addFailedIds(setFailedQuestionIds, failedIds);
    setCurrentIndex(prev => prev + 1);
  }, []);

  const handleImageComplete = useCallback((failedIds = []) => {
    addFailedIds(setFailedQuestionIds, failedIds);
    setCurrentIndex(prev => prev + 1);
  }, []);

  const handleTimelineComplete = useCallback((failedIds = []) => {
    addFailedIds(setFailedQuestionIds, failedIds);
    setCurrentIndex(prev => prev + 1);
  }, []);

  const submitMapTrainingAnswer = useCallback(async () => ({ status: "ok" }), []);
  const submitImageTrainingAnswer = useCallback(async () => ({ status: "ok" }), []);
  const submitTimelineTrainingAnswer = useCallback(
    (items) => gradeTrainingTimeline(items),
    []
  );

  useEffect(() => {
    if (!active) {
      setActiveScope(null);
      setOriginalQuestions([]);
      setQuestions([]);
      setCurrentIndex(0);
      setShowAnswer(false);
      setFailedQuestionIds(new Set());
      setTrainingLoading(false);
      setTrainingError("");
      return;
    }

    loadScopes();
  }, [active, loadScopes]);

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event) {
      if (
        current?.type_q === "map" ||
        current?.type_q === "timeline" ||
        (current?.type_q === "image" && current?.items)
      ) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === "Enter") {
        if (!showAnswer) {
          event.preventDefault();
          setShowAnswer(true);
        } else {
          event.preventDefault();
          handleTextAnswer();
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, current?.items, current?.type_q, handleTextAnswer, showAnswer]);

  return {
    activeScope,
    allQuestionIds,
    currentIndex,
    failedCount,
    failedQuestionIds,
    handleImageComplete,
    handleMapComplete,
    handleTextAnswer,
    handleTimelineComplete,
    isComplete,
    labelForActiveScope: labelForScope(activeScope),
    loadScopes,
    originalQuestions,
    questions,
    restartFullScope,
    retryFailedItems,
    returnToScopeSelector,
    scopes,
    scopesError,
    scopesLoading,
    setShowAnswer,
    showAnswer,
    startScope,
    submitImageTrainingAnswer,
    submitMapTrainingAnswer,
    submitTimelineTrainingAnswer,
    trainingError,
    trainingLoading
  };
}


export {
  filterReviewItemsByQuestionIds,
  getReviewItemQuestionIds
};
