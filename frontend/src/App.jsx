import { useCallback, useEffect, useRef, useState } from "react";
import Menu from "./features/menu/Menu";
import ReviewSession from "./features/review/components/ReviewSession";
import Manage from "./features/manage/components/Manage";
import ReviewCalendar from "./features/calendar/components/ReviewCalendar";
import Profile from "./features/profile/components/Profile";
import Settings from "./features/settings/components/Settings";
import TrainingSession from "./features/training/components/TrainingSession";
import StudyScreen from "./features/study/components/StudyScreen";
import BrowsePacks from "./features/packs/components/BrowsePacks";
import DesktopStartupGate from "./shared/DesktopStartupGate";
import UpdateBanner from "./features/update/UpdateBanner";
import AutoSyncBanner from "./features/sync/AutoSyncBanner";
import { getReviewSummary, getStartupRebalanceNotice } from "./api/review";
import { useManageLibrary } from "./features/manage/hooks/useManageLibrary";
import { useReviewSession } from "./features/review/hooks/useReviewSession";
import { useAutoSync } from "./features/sync/useAutoSync";


function startupNoticeStorageKey(notice) {
  return `startup-rebalance-notice:${notice.id}`;
}

const BACK_MOUSE_BUTTON = 3;
const FORWARD_MOUSE_BUTTON = 4;


function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}


function isEditableNavigationTarget(target) {
  if (!target || typeof target.closest !== "function") {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}


function hasBlockingEscapeSurface() {
  if (typeof document === "undefined") {
    return false;
  }

  return Boolean(document.querySelector("[role='dialog'], [data-media-zoom-overlay]"));
}


function normalizeStudyScope(scope) {
  if (!scope) return null;

  const type = scope.scopeType || scope.type;

  if (type === "group") {
    const id = firstDefined(scope.groupId, scope.group_id, scope.id);
    if (id === undefined) return null;

    return {
      type: "group",
      id,
      groupId: id,
      name: scope.name || null,
      type_group: scope.type_group || null,
      audio_only: scope.audio_only,
      reverse_mode_enabled: scope.reverse_mode_enabled
    };
  }

  if (type === "collection") {
    const id = firstDefined(scope.collectionId, scope.collection_id, scope.id);
    if (id === undefined) return null;

    return {
      type: "collection",
      id,
      collectionId: id,
      name: scope.name || null
    };
  }

  if (type === "tag") {
    const id = firstDefined(scope.tag, scope.key, scope.id, scope.label);
    if (!id) return null;

    return {
      type: "tag",
      id,
      key: id,
      tag: id,
      label: scope.label || scope.name || id,
      name: scope.name || scope.label || id
    };
  }

  if (type === "pack") {
    const packGuid = firstDefined(scope.packGuid, scope.pack_guid, scope.id);
    if (!packGuid) return null;

    return {
      type: "pack",
      id: packGuid,
      packGuid,
      name: scope.name || null
    };
  }

  if (type === "questions") {
    const questionIds = (
      scope.questionIds ||
      scope.question_ids ||
      scope.ids ||
      []
    )
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));

    if (questionIds.length === 0) return null;

    return {
      type: "questions",
      id: scope.id || questionIds.join(","),
      questionIds,
      name: scope.name || scope.label || "Pratique ciblée",
      label: scope.label || scope.name || "Pratique ciblée",
      mapMode: scope.mapMode || scope.map_mode || null,
      imageMode: scope.imageMode || scope.image_mode || null,
      textMode: scope.textMode || scope.text_mode || null,
      sequenceMode: scope.sequenceMode || scope.sequence_mode || null
    };
  }

  return null;
}


function scopeToTrainingTarget(scope) {
  const normalized = normalizeStudyScope(scope);

  if (!normalized || normalized.type === "pack") return null;

  if (normalized.type === "questions") {
    return {
      type: "questions",
      id: normalized.id,
      questionIds: normalized.questionIds,
      name: normalized.name,
      label: normalized.label,
      mapMode: normalized.mapMode,
      imageMode: normalized.imageMode,
      textMode: normalized.textMode,
      sequenceMode: normalized.sequenceMode
    };
  }

  if (normalized.type === "group") {
    return {
      type: "group",
      id: normalized.id,
      name: normalized.name,
      type_group: normalized.type_group,
      audio_only: normalized.audio_only,
      reverse_mode_enabled: normalized.reverse_mode_enabled
    };
  }

  if (normalized.type === "collection") {
    return {
      type: "collection",
      id: normalized.id,
      name: normalized.name
    };
  }

  return {
    type: "tag",
    id: normalized.id,
    key: normalized.key,
    label: normalized.label,
    name: normalized.name
  };
}


function AppContent() {
  // Top-level mode switching is intentionally simple: each feature owns its
  // internal state through hooks, while App only coordinates cross-feature jumps.
  const [mode, setMode] = useState("menu");
  const modeRef = useRef("menu");
  const backStackRef = useRef([]);
  const forwardStackRef = useRef([]);
  const [manageOpenQuestionId, setManageOpenQuestionId] = useState(null);
  const [manageOpenGroupId, setManageOpenGroupId] = useState(null);
  const [calendarOpenQuestionId, setCalendarOpenQuestionId] = useState(null);
  const [startupNotice, setStartupNotice] = useState(null);
  const [reviewSummary, setReviewSummary] = useState(null);
  const [reviewSummaryLoading, setReviewSummaryLoading] = useState(false);
  const [reviewSummaryError, setReviewSummaryError] = useState("");
  const [settingsScrollTarget, setSettingsScrollTarget] = useState(null);
  const [packOpenTarget, setPackOpenTarget] = useState(null);
  const [studyScope, setStudyScope] = useState(null);
  const [reviewOpenTarget, setReviewOpenTarget] = useState(null);
  const [trainingOpenTarget, setTrainingOpenTarget] = useState(null);
  const manageLibrary = useManageLibrary(mode);
  const reviewSession = useReviewSession(
    mode === "quiz",
    reviewOpenTarget?.scope || null,
    reviewOpenTarget?.nonce || 0
  );
  const autoSync = useAutoSync();

  const appStyle = {
    background: "#121212",
    color: "#e5e5e5",
    minHeight: 0,
    height: "100%",
    padding: "24px",
    fontFamily: "Arial, sans-serif",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxSizing: "border-box",
    position: "relative"
  };

  const bannerOverlayStyle = {
    position: "absolute",
    top: "24px",
    left: "24px",
    right: "24px",
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    pointerEvents: "none"
  };

  const routeSlotStyle = {
    display: "flex",
    flex: "1 1 auto",
    minHeight: 0,
    overflow: "hidden",
    width: "100%"
  };

  useEffect(() => {
    document.body.style.overflow = "hidden";
  }, []);

  // The history stacks live in refs, so they must never be mutated from inside a
  // setMode updater: React re-runs updaters (StrictMode, queue replays) and each
  // replay would push or pop again, making one back press skip several screens.
  const applyMode = useCallback((nextMode) => {
    modeRef.current = nextMode;
    setMode(nextMode);
  }, []);

  const navigateMode = useCallback((nextModeOrUpdater) => {
    const currentMode = modeRef.current;
    const nextMode = typeof nextModeOrUpdater === "function"
      ? nextModeOrUpdater(currentMode)
      : nextModeOrUpdater;

    if (!nextMode || nextMode === currentMode) {
      return;
    }

    backStackRef.current.push(currentMode);
    forwardStackRef.current = [];
    applyMode(nextMode);
  }, [applyMode]);

  const goBack = useCallback(() => {
    const currentMode = modeRef.current;
    let previousMode = backStackRef.current.pop();
    while (previousMode === currentMode) {
      previousMode = backStackRef.current.pop();
    }

    if (!previousMode) {
      return;
    }

    forwardStackRef.current.push(currentMode);
    applyMode(previousMode);
  }, [applyMode]);

  const goForward = useCallback(() => {
    const currentMode = modeRef.current;
    let nextMode = forwardStackRef.current.pop();
    while (nextMode === currentMode) {
      nextMode = forwardStackRef.current.pop();
    }

    if (!nextMode) {
      return;
    }

    backStackRef.current.push(currentMode);
    applyMode(nextMode);
  }, [applyMode]);

  useEffect(() => {
    function interceptBrowserMouseNavigation(event) {
      if (event.button !== BACK_MOUSE_BUTTON && event.button !== FORWARD_MOUSE_BUTTON) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    }

    function handleBrowserMouseNavigation(event) {
      if (event.button !== BACK_MOUSE_BUTTON && event.button !== FORWARD_MOUSE_BUTTON) {
        return;
      }

      interceptBrowserMouseNavigation(event);

      if (event.button === BACK_MOUSE_BUTTON) {
        goBack();
      } else {
        goForward();
      }
    }

    window.addEventListener("mousedown", handleBrowserMouseNavigation, true);
    window.addEventListener("mouseup", interceptBrowserMouseNavigation, true);
    window.addEventListener("auxclick", interceptBrowserMouseNavigation, true);

    return () => {
      window.removeEventListener("mousedown", handleBrowserMouseNavigation, true);
      window.removeEventListener("mouseup", interceptBrowserMouseNavigation, true);
      window.removeEventListener("auxclick", interceptBrowserMouseNavigation, true);
    };
  }, [goBack, goForward]);

  useEffect(() => {
    function handleKeyboardNavigation(event) {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isEditableNavigationTarget(event.target) ||
        hasBlockingEscapeSurface()
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      goBack();
    }

    window.addEventListener("keydown", handleKeyboardNavigation);

    return () => {
      window.removeEventListener("keydown", handleKeyboardNavigation);
    };
  }, [goBack]);

  useEffect(() => {
    getStartupRebalanceNotice()
      .then((notice) => {
        if (!notice?.id || !notice.moved) return;

        try {
          if (localStorage.getItem(startupNoticeStorageKey(notice))) {
            return;
          }
        } catch (error) {
          console.error(error);
        }

        setStartupNotice(notice);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (mode !== "menu") return undefined;

    let cancelled = false;

    setReviewSummaryLoading(true);
    setReviewSummaryError("");

    getReviewSummary()
      .then((summary) => {
        if (cancelled) return;

        setReviewSummary(summary);
        setReviewSummaryLoading(false);
      })
      .catch((error) => {
        console.error(error);

        if (!cancelled) {
          setReviewSummaryError(error.message || "Impossible de charger la révision.");
          setReviewSummaryLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  function dismissStartupNotice() {
    if (startupNotice?.id) {
      try {
        localStorage.setItem(startupNoticeStorageKey(startupNotice), "dismissed");
      } catch (error) {
        console.error(error);
      }
    }

    setStartupNotice(null);
  }

  function openQuestionInManage(question) {
    // Calendar -> Manage navigation should land on the exact question, without
    // whatever filters were previously active in Manage.
    openQuestionIdInManage(question.id);
  }

  function openQuestionIdInManage(questionId) {
    // Cross-feature navigation can happen before Manage has loaded questions.
    // Store the id and let Manage resolve it after its normal data load.
    manageLibrary.resetManageFilters();
    manageLibrary.setViewMode("questions");
    manageLibrary.setIsCreatingQuestion(false);
    manageLibrary.setIsCreatingGroup(false);
    manageLibrary.setSelectedItem(null);
    setManageOpenGroupId(null);
    setManageOpenQuestionId(questionId);
    navigateMode("manage");
  }

  function openGroupIdInManage(groupId) {
    // Packs -> Manage navigation lands on the local group row and opens the
    // normal right-hand group preview/editor once Manage has loaded groups.
    manageLibrary.resetManageFilters();
    manageLibrary.setViewMode("groups");
    manageLibrary.setIsCreatingQuestion(false);
    manageLibrary.setIsCreatingGroup(false);
    manageLibrary.setSelectedItem(null);
    setManageOpenQuestionId(null);
    setManageOpenGroupId(groupId);
    navigateMode("manage");
  }

  function openQuestionInCalendar(question) {
    // Manage -> Calendar navigation keeps the selected question highlighted
    // after the calendar screen mounts.
    setCalendarOpenQuestionId(question.id);
    navigateMode("calendar");
  }

  const openSettingsSection = useCallback((sectionId) => {
    setSettingsScrollTarget(sectionId || null);
    navigateMode("settings");
  }, [navigateMode]);

  const clearSettingsScrollTarget = useCallback(() => {
    setSettingsScrollTarget(null);
  }, []);

  const openPackInCatalog = useCallback((pack) => {
    setPackOpenTarget({
      guid: pack?.pack_guid || null
    });
    navigateMode("packs");
  }, [navigateMode]);

  const clearPackOpenTarget = useCallback(() => {
    setPackOpenTarget(null);
  }, []);

  const openStudyScope = useCallback((scope) => {
    const nextScope = normalizeStudyScope(scope);

    if (!nextScope) return;

    setStudyScope(nextScope);
    navigateMode("study");
  }, [navigateMode]);

  const openGlobalReview = useCallback(() => {
    setReviewOpenTarget(null);
    navigateMode("quiz");
  }, [navigateMode]);

  const openScopedReview = useCallback((scope) => {
    const nextScope = normalizeStudyScope(scope);

    if (!nextScope || nextScope.type === "questions") return;

    setReviewOpenTarget({
      nonce: Date.now(),
      scope: nextScope
    });
    navigateMode("quiz");
  }, [navigateMode]);

  const openTrainingScope = useCallback((scope, modeName = null) => {
    const nextScope = scopeToTrainingTarget(scope);

    if (!nextScope) return;

    setTrainingOpenTarget({
      mode: modeName || null,
      nonce: Date.now(),
      scope: nextScope
    });
    navigateMode("training");
  }, [navigateMode]);

  const clearTrainingOpenTarget = useCallback(() => {
    setTrainingOpenTarget(null);
  }, []);

  return (
    <div style={appStyle}>
      <div style={bannerOverlayStyle}>
        <UpdateBanner />
        <AutoSyncBanner {...autoSync} />
      </div>
      <div style={routeSlotStyle}>
        {mode === "menu" && (
          <Menu
            setMode={navigateMode}
            startupNotice={startupNotice}
            onDismissStartupNotice={dismissStartupNotice}
            reviewSummary={reviewSummary}
            reviewSummaryLoading={reviewSummaryLoading}
            reviewSummaryError={reviewSummaryError}
            onOpenSettingsSection={openSettingsSection}
            onOpenPack={openPackInCatalog}
            onOpenStudy={openStudyScope}
            onStartTraining={openTrainingScope}
            onStartReview={openGlobalReview}
          />
        )}

        {mode === "quiz" && (
          <ReviewSession
            setMode={navigateMode}
            {...reviewSession}
          />
        )}

        {mode === "training" && (
          <TrainingSession
            setMode={navigateMode}
            initialMode={trainingOpenTarget?.mode || null}
            initialScope={trainingOpenTarget?.scope || null}
            initialScopeNonce={trainingOpenTarget?.nonce || 0}
            onInitialScopeHandled={clearTrainingOpenTarget}
            onOpenStudy={openStudyScope}
          />
        )}

        {mode === "study" && (
          <StudyScreen
            setMode={navigateMode}
            scope={studyScope}
            onStartReview={openScopedReview}
            onStartTraining={openTrainingScope}
          />
        )}

        {mode === "manage" && (
          <Manage
            setMode={navigateMode}
            {...manageLibrary}
            openQuestionId={manageOpenQuestionId}
            clearOpenQuestionId={() => setManageOpenQuestionId(null)}
            openGroupId={manageOpenGroupId}
            clearOpenGroupId={() => setManageOpenGroupId(null)}
            onOpenInCalendar={openQuestionInCalendar}
            onOpenStudy={openStudyScope}
          />
        )}

        {mode === "calendar" && (
          <ReviewCalendar
            setMode={navigateMode}
            questions={manageLibrary.allQuestions}
            onOpenQuestion={openQuestionInManage}
            onOpenGroupInManage={openGroupIdInManage}
            onOpenStudy={openStudyScope}
            openQuestionId={calendarOpenQuestionId}
            clearOpenQuestionId={() => setCalendarOpenQuestionId(null)}
          />
        )}

        {mode === "profile" && (
          <Profile
            setMode={navigateMode}
            onOpenSettingsSection={openSettingsSection}
            onOpenStudy={openStudyScope}
          />
        )}

        {mode === "settings" && (
          <Settings
            setMode={navigateMode}
            initialSection={settingsScrollTarget}
            onInitialSectionHandled={clearSettingsScrollTarget}
          />
        )}

        {mode === "packs" && (
          <BrowsePacks
            setMode={navigateMode}
            onOpenGroup={openGroupIdInManage}
            onOpenStudy={openStudyScope}
            initialPackGuid={packOpenTarget?.guid || null}
            onInitialPackHandled={clearPackOpenTarget}
          />
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <DesktopStartupGate>
      <AppContent />
    </DesktopStartupGate>
  );
}

export default App;
