import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getTrainingItems,
  gradeTrainingCloze,
  gradeTrainingGrid,
  gradeTrainingSet,
  gradeTrainingEnumeration,
  gradeTrainingNumeric,
  gradeTrainingSequence,
  gradeTrainingTimeline,
  listTrainingScopes,
  recordCollectionTrainingAttempt,
  recordGroupTrainingAttempt
} from "../../../api/training";
import { createCollection } from "../../../api/collections";


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


function responseField(response, key, fallback) {
  return Object.prototype.hasOwnProperty.call(response || {}, key)
    ? response[key]
    : fallback;
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
      items: shuffledTrainingList(item.items, random),
      ...(Array.isArray(item.context_items)
        ? { context_items: shuffledTrainingList(item.context_items, random) }
        : {})
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


const MAX_TRAINING_PAUSES = 3;


function labelForScope(scope) {
  if (!scope) return "";

  if (scope.type === "group") {
    return scope.name || `Groupe #${scope.id}`;
  }

  if (scope.type === "collection") {
    return scope.name || `Collection #${scope.id}`;
  }

  if (scope.type === "questions") {
    return scope.name || scope.label || "Pratique ciblée";
  }

  return `#${scope.label || scope.name || ""}`;
}


function scopeRequestOptions(scope) {
  if (scope?.type === "group") {
    return {
      scopeType: "group",
      groupId: scope.id,
      ...(scope.mapMode ? { mapMode: scope.mapMode } : {}),
      ...(scope.imageMode ? { imageMode: scope.imageMode } : {}),
      ...(scope.textMode ? { textMode: scope.textMode } : {}),
      ...(scope.sequenceMode ? { sequenceMode: scope.sequenceMode } : {})
    };
  }

  if (scope?.type === "collection") {
    return {
      scopeType: "collection",
      collectionId: scope.id
    };
  }

  if (scope?.type === "questions") {
    return {
      scopeType: "questions",
      questionIds: scope.questionIds || scope.question_ids || [],
      ...(scope.mapMode ? { mapMode: scope.mapMode } : {}),
      ...(scope.imageMode ? { imageMode: scope.imageMode } : {}),
      ...(scope.textMode ? { textMode: scope.textMode } : {}),
      ...(scope.sequenceMode ? { sequenceMode: scope.sequenceMode } : {})
    };
  }

  return {
    scopeType: "tag",
    tag: scope?.id || scope?.key || ""
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
  const [answeringComplete, setAnsweringComplete] = useState(false);
  const [recordSaveStatus, setRecordSaveStatus] = useState("idle");
  const [recordSaveError, setRecordSaveError] = useState("");
  const [recordResult, setRecordResult] = useState(null);
  const [collectionSaveStatus, setCollectionSaveStatus] = useState("idle");
  const [collectionSaveError, setCollectionSaveError] = useState("");
  const [createdCollectionName, setCreatedCollectionName] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const [pauseCount, setPauseCount] = useState(0);
  const recordSubmittedRef = useRef(false);
  const pausedElapsedRef = useRef(0);

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
    setAnsweringComplete(false);
    setRecordSaveStatus("idle");
    setRecordSaveError("");
    setRecordResult(null);
    setCollectionSaveStatus("idle");
    setCollectionSaveError("");
    setCreatedCollectionName("");
    recordSubmittedRef.current = false;
    setIsPaused(false);
    setPauseCount(0);
    pausedElapsedRef.current = 0;
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
        ...(groupTypeForMode === "media" ? { imageMode: groupMode } : {}),
        ...(groupTypeForMode === "text" ? { textMode: groupMode } : {}),
        ...(groupTypeForMode === "sequence" ? { sequenceMode: groupMode } : {})
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

  // Lets the user turn this run's misses into a standalone collection they
  // can come back and train on later, independently of this run. Plain
  // pinned-question collection, no rules -- same shape PlaylistBuilder saves
  // when a playlist has no rule clauses.
  const createCollectionFromFailed = useCallback(async (name) => {
    const cleanedName = String(name || "").trim();

    if (
      !cleanedName ||
      failedQuestionIds.size === 0 ||
      collectionSaveStatus === "saving"
    ) {
      return;
    }

    setCollectionSaveStatus("saving");
    setCollectionSaveError("");

    try {
      const collection = await createCollection({
        name: cleanedName,
        question_ids: Array.from(failedQuestionIds)
      });

      setCollectionSaveStatus("saved");
      setCreatedCollectionName(collection?.name || cleanedName);
      // Refreshes the scope selector so the new collection is immediately
      // trainable without leaving and re-entering the Training tab.
      loadScopes();
    } catch (error) {
      console.error(error);
      setCollectionSaveStatus("error");
      setCollectionSaveError(
        error.message || "Impossible de créer la collection."
      );
    }
  }, [collectionSaveStatus, failedQuestionIds, loadScopes]);

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

  const handleSequenceComplete = useCallback((failedIds = []) => {
    addFailedIds(setFailedQuestionIds, failedIds);
    setCurrentIndex(prev => prev + 1);
  }, []);

  // Every question type ends on a recap the user dismisses by hand. Reading it
  // is not solving, so on the last question the run clock stops and the attempt
  // is saved right away, rather than waiting for the recap to be dismissed.
  // The caller passes its failed ids because only it knows them at this point.
  const markAnsweringComplete = useCallback((failedIds = []) => {
    addFailedIds(setFailedQuestionIds, failedIds);

    if (runStartedAt === null) return;
    if (questions.length === 0 || currentIndex < questions.length - 1) return;

    const finalElapsed = Math.max(
      1,
      Math.round(performance.now() - runStartedAt)
    );

    setElapsedMs(finalElapsed);
    setCompletedElapsedMs(finalElapsed);
    setRunStartedAt(null);
    setAnsweringComplete(true);
  }, [currentIndex, questions.length, runStartedAt]);

  const pausesRemaining = Math.max(0, MAX_TRAINING_PAUSES - pauseCount);
  const canPause = Boolean(runStartedAt !== null && !isPaused && pausesRemaining > 0);

  const pauseRun = useCallback(() => {
    if (runStartedAt === null || isPaused || pausesRemaining <= 0) return;

    pausedElapsedRef.current = Math.max(
      1,
      Math.round(performance.now() - runStartedAt)
    );
    setElapsedMs(pausedElapsedRef.current);
    setRunStartedAt(null);
    setIsPaused(true);
    setPauseCount(prev => prev + 1);
  }, [isPaused, pausesRemaining, runStartedAt]);

  const resumeRun = useCallback(() => {
    if (!isPaused) return;

    setRunStartedAt(performance.now() - pausedElapsedRef.current);
    setIsPaused(false);
  }, [isPaused]);

  const submitMapTrainingAnswer = useCallback(async () => ({ status: "ok" }), []);
  const submitMediaTrainingAnswer = useCallback(async () => ({ status: "ok" }), []);
  const submitTextTrainingAnswer = useCallback(async () => ({ status: "ok" }), []);
  const submitClozeTrainingAnswer = useCallback(
    (payload) => gradeTrainingCloze(payload),
    []
  );
  const submitNumericTrainingAnswer = useCallback(
    (payload) => gradeTrainingNumeric(payload),
    []
  );
  const submitGridTrainingAnswer = useCallback((payload) => gradeTrainingGrid(payload), []);
  const submitSetTrainingAnswer = useCallback((payload) => gradeTrainingSet(payload), []);
  const submitEnumerationTrainingAnswer = useCallback((payload) => gradeTrainingEnumeration(payload), []);
  const submitTimelineTrainingAnswer = useCallback(
    (items) => gradeTrainingTimeline(items),
    []
  );
  // Map/media/text grade client-side, so their training submits are no-ops.
  // Sequences are graded on the server, so training needs the dedicated grader:
  // routing this to /answer_sequence would schedule real reviews from practice.
  const submitSequenceTrainingAnswer = useCallback(
    (payload, mode, contextCount) => gradeTrainingSequence(
      payload,
      mode,
      contextCount
    ),
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
      (!isComplete && !answeringComplete) ||
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
              training_records: responseField(
                response,
                "training_records",
                prev.training_records
              ),
              previous_training_record: responseField(
                response,
                "previous_training_record",
                prev.previous_training_record
              ),
              previous_training_records: responseField(
                response,
                "previous_training_records",
                prev.previous_training_records
              )
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
                training_records: responseField(
                  response,
                  "training_records",
                  group.training_records
                ),
                previous_training_record: responseField(
                  response,
                  "previous_training_record",
                  group.previous_training_record
                ),
                previous_training_records: responseField(
                  response,
                  "previous_training_records",
                  group.previous_training_records
                )
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
    answeringComplete,
    attemptFoundCount,
    completedElapsedMs,
    isComplete,
    recordEligible,
    trainingFingerprint
  ]);

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event) {
      if (isPaused) {
        return;
      }

      if (current?.type_q === "text") {
        return;
      }

      if (
        current?.type_q === "map" ||
        current?.type_q === "timeline" ||
        (current?.type_q === "media" && current?.items)
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
  }, [active, current?.items, current?.type_q, handleTextAnswer, isPaused, showAnswer]);

  return {
    activeScope,
    allQuestionIds,
    attemptFoundCount,
    canPause,
    collectionSaveError,
    collectionSaveStatus,
    completedElapsedMs,
    completedRunElapsedMs,
    createCollectionFromFailed,
    createdCollectionName,
    currentIndex,
    elapsedMs,
    failedCount,
    failedQuestionIds,
    handleImageComplete,
    handleMapComplete,
    handleTextAnswer,
    handleTimelineComplete,
    handleSequenceComplete,
    isComplete,
    isPaused,
    labelForActiveScope: labelForScope(activeScope),
    loadScopes,
    markAnsweringComplete,
    maxPauses: MAX_TRAINING_PAUSES,
    originalQuestions,
    pauseRun,
    pausesRemaining,
    questions,
    recordEligible,
    recordResult,
    recordSaveError,
    recordSaveStatus,
    restartFullScope,
    resumeRun,
    retryFailedItems,
    returnToScopeSelector,
    scopes,
    scopesError,
    scopesLoading,
    setShowAnswer,
    showAnswer,
    startScope,
    submitMediaTrainingAnswer,
    submitTextTrainingAnswer,
    submitClozeTrainingAnswer,
    submitNumericTrainingAnswer,
    submitGridTrainingAnswer,
    submitSetTrainingAnswer,
    submitEnumerationTrainingAnswer,
    submitMapTrainingAnswer,
    submitTimelineTrainingAnswer,
    submitSequenceTrainingAnswer,
    trainingError,
    trainingLoading
  };
}


export {
  filterReviewItemsByQuestionIds,
  getReviewItemQuestionIds,
  shuffleTrainingItems
};
