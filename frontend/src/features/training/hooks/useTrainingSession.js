import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getTrainingItems,
  gradeTrainingTimeline,
  listTrainingScopes,
  recordCollectionTrainingAttempt,
  recordGroupTrainingAttempt
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


function getTrainingFingerprint(items) {
  return (items || []).find(item => item?.training_fingerprint)
    ?.training_fingerprint || null;
}


function shuffledTrainingList(items, random = Math.random) {
  const shuffled = [...(items || [])];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index]
    ];
  }

  return shuffled;
}


function shuffleTrainingItems(items, random = Math.random) {
  return shuffledTrainingList(items, random).map(item => {
    if (!Array.isArray(item?.items)) {
      return item;
    }

    return {
      ...item,
      items: shuffledTrainingList(item.items, random)
    };
  });
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

  if (scope.type === "collection") {
    return scope.name || `Collection #${scope.id}`;
  }

  return `#${scope.name}`;
}


function scopeRequestOptions(scope) {
  if (scope?.type === "group") {
    return {
      scopeType: "group",
      groupId: scope.id,
      ...(scope.mapMode ? { mapMode: scope.mapMode } : {}),
      ...(scope.imageMode ? { imageMode: scope.imageMode } : {})
    };
  }

  if (scope?.type === "collection") {
    return {
      scopeType: "collection",
      collectionId: scope.id
    };
  }

  return {
    scopeType: "tag",
    tag: scope?.name || ""
  };
}


export function useTrainingSession(active = true) {
  const [scopes, setScopes] = useState({
    groups: [],
    collections: [],
    tags: []
  });
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
  const [runMode, setRunMode] = useState("full");
  const [runStartedAt, setRunStartedAt] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [completedElapsedMs, setCompletedElapsedMs] = useState(null);
  const [recordSaveStatus, setRecordSaveStatus] = useState("idle");
  const [recordSaveError, setRecordSaveError] = useState("");
  const [recordResult, setRecordResult] = useState(null);
  const recordSubmittedRef = useRef(false);

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
  const trainingFingerprint = useMemo(
    () => ["group", "collection"].includes(activeScope?.type)
      ? getTrainingFingerprint(originalQuestions)
      : null,
    [activeScope?.type, originalQuestions]
  );
  const recordEligible = Boolean(
    ["group", "collection"].includes(activeScope?.type) &&
    runMode === "full" &&
    allQuestionIds.length > 0 &&
    trainingFingerprint
  );
  const completedRunElapsedMs = completedElapsedMs ?? elapsedMs;
  const attemptFoundCount = recordEligible
    ? Math.max(0, allQuestionIds.length - failedQuestionIds.size)
    : 0;

  const resetRecordAttempt = useCallback((items, nextRunMode, scope) => {
    const shouldStartTimer = Boolean(
      ["group", "collection"].includes(scope?.type) &&
      nextRunMode === "full" &&
      (items || []).length > 0
    );

    setRunMode(nextRunMode);
    setRunStartedAt(shouldStartTimer ? performance.now() : null);
    setElapsedMs(0);
    setCompletedElapsedMs(null);
    setRecordSaveStatus("idle");
    setRecordSaveError("");
    setRecordResult(null);
    recordSubmittedRef.current = false;
  }, []);

  const resetRun = useCallback((items, nextRunMode = "full") => {
    const runItems = items || [];

    setQuestions(shuffleTrainingItems(runItems));
    setCurrentIndex(0);
    setShowAnswer(false);
    setFailedQuestionIds(new Set());
    resetRecordAttempt(runItems, nextRunMode, activeScope);
  }, [activeScope, resetRecordAttempt]);

  const loadScopes = useCallback(async () => {
    setScopesLoading(true);
    setScopesError("");

    try {
      const data = await listTrainingScopes();

      setScopes({
        groups: data.groups || [],
        collections: data.collections || [],
        tags: data.tags || []
      });
    } catch (error) {
      console.error(error);
      setScopesError(error.message || "Impossible de charger les entrainements.");
    } finally {
      setScopesLoading(false);
    }
  }, []);

  const startScope = useCallback(async (scope, groupMode = null) => {
    const groupTypeForMode = scope.type_group || "map";
    const nextScope = groupMode
      ? {
        ...scope,
        groupMode,
        ...(groupTypeForMode === "map" ? { mapMode: groupMode } : {}),
        ...(groupTypeForMode === "image" ? { imageMode: groupMode } : {})
      }
      : scope;

    setActiveScope(nextScope);
    setOriginalQuestions([]);
    setQuestions([]);
    setCurrentIndex(0);
    setShowAnswer(false);
    setFailedQuestionIds(new Set());
    resetRecordAttempt([], "full", nextScope);
    setTrainingLoading(true);
    setTrainingError("");

    try {
      const data = await getTrainingItems(scopeRequestOptions(nextScope));
      const trainingItems = data || [];

      setOriginalQuestions(trainingItems);
      setQuestions(shuffleTrainingItems(trainingItems));
      setCurrentIndex(0);
      setShowAnswer(false);
      resetRecordAttempt(trainingItems, "full", nextScope);
    } catch (error) {
      console.error(error);
      setTrainingError(error.message || "Impossible de preparer l'entrainement.");
    } finally {
      setTrainingLoading(false);
    }
  }, [resetRecordAttempt]);

  const returnToScopeSelector = useCallback(() => {
    setActiveScope(null);
    setOriginalQuestions([]);
    setQuestions([]);
    setCurrentIndex(0);
    setShowAnswer(false);
    setFailedQuestionIds(new Set());
    setTrainingError("");
    resetRecordAttempt([], "full", null);
  }, [resetRecordAttempt]);

  const restartFullScope = useCallback(() => {
    resetRun(originalQuestions);
  }, [originalQuestions, resetRun]);

  const retryFailedItems = useCallback(() => {
    if (failedQuestionIds.size === 0) return;

    resetRun(
      filterReviewItemsByQuestionIds(originalQuestions, failedQuestionIds),
      "retry"
    );
  }, [failedQuestionIds, originalQuestions, resetRun]);

  const handleTextAnswer = useCallback((options = {}) => {
    if (!current) return;

    addFailedIds(
      setFailedQuestionIds,
      options?.failedQuestionIds || []
    );
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
      resetRecordAttempt([], "full", null);
      return;
    }

    loadScopes();
  }, [active, loadScopes, resetRecordAttempt]);

  useEffect(() => {
    if (runStartedAt === null) return undefined;

    const updateElapsed = () => {
      setElapsedMs(Math.max(1, Math.round(performance.now() - runStartedAt)));
    };

    updateElapsed();

    const intervalId = window.setInterval(updateElapsed, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [runStartedAt]);

  useEffect(() => {
    if (!isComplete || runStartedAt === null) return;

    const finalElapsed = Math.max(
      1,
      Math.round(performance.now() - runStartedAt)
    );

    setElapsedMs(finalElapsed);
    setCompletedElapsedMs(finalElapsed);
    setRunStartedAt(null);
  }, [isComplete, runStartedAt]);

  useEffect(() => {
    if (
      !isComplete ||
      !recordEligible ||
      completedElapsedMs === null ||
      recordSubmittedRef.current
    ) {
      return undefined;
    }

    let cancelled = false;
    const scopeId = activeScope.id;
    const payload = {
      elapsed_ms: Math.max(1, Math.round(completedElapsedMs)),
      question_count: allQuestionIds.length,
      found_count: attemptFoundCount,
      content_fingerprint: trainingFingerprint,
      ...(activeScope.type === "group" && (
        activeScope.groupMode ||
        activeScope.mapMode ||
        activeScope.imageMode
      )
        ? {
          mode: (
            activeScope.groupMode ||
            activeScope.mapMode ||
            activeScope.imageMode
          )
        }
        : {})
    };

    recordSubmittedRef.current = true;
    setRecordSaveStatus("saving");
    setRecordSaveError("");

    const saveAttempt = activeScope.type === "collection"
      ? recordCollectionTrainingAttempt(scopeId, payload)
      : recordGroupTrainingAttempt(scopeId, payload);

    saveAttempt
      .then((response) => {
        if (cancelled) return;

        setRecordResult(response);
        setRecordSaveStatus("saved");
        setActiveScope(prev => (
          prev?.type === activeScope.type && prev.id === scopeId
            ? {
              ...prev,
              training_record: response.training_record,
              training_records: response.training_records || prev.training_records
            }
            : prev
        ));
        setScopes(prev => ({
          ...prev,
          groups: (prev.groups || []).map(group =>
            group.id === scopeId && activeScope.type === "group"
              ? {
                ...group,
                training_record: response.training_record,
                training_records: response.training_records || group.training_records
              }
              : group
          ),
          collections: (prev.collections || []).map(collection =>
            collection.id === scopeId && activeScope.type === "collection"
              ? {
                ...collection,
                training_record: response.training_record
              }
              : collection
          )
        }));
      })
      .catch((error) => {
        console.error(error);

        if (!cancelled) {
          setRecordSaveStatus("error");
          setRecordSaveError(
            error.message || "Impossible d'enregistrer le record."
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeScope,
    allQuestionIds.length,
    attemptFoundCount,
    completedElapsedMs,
    isComplete,
    recordEligible,
    trainingFingerprint
  ]);

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event) {
      if (current?.type_q === "text") {
        return;
      }

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
    attemptFoundCount,
    completedElapsedMs,
    completedRunElapsedMs,
    currentIndex,
    elapsedMs,
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
    recordEligible,
    recordResult,
    recordSaveError,
    recordSaveStatus,
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
  getReviewItemQuestionIds,
  shuffleTrainingItems
};
