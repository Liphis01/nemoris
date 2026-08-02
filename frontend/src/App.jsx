import { useCallback, useEffect, useRef, useState } from "react";
import Menu from "./features/menu/Menu";
import ReviewSession from "./features/review/components/ReviewSession";
import Manage from "./features/manage/components/Manage";
import ReviewCalendar from "./features/calendar/components/ReviewCalendar";
import Profile from "./features/profile/components/Profile";
import Settings from "./features/settings/components/Settings";
import TrainingSession from "./features/training/components/TrainingSession";
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


function AppContent() {
  // Top-level mode switching is intentionally simple: each feature owns its
  // internal state through hooks, while App only coordinates cross-feature jumps.
  const [mode, setMode] = useState("menu");
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
  const manageLibrary = useManageLibrary(mode);
  const reviewSession = useReviewSession(mode === "quiz");
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

  const navigateMode = useCallback((nextModeOrUpdater) => {
    setMode((currentMode) => {
      const nextMode = typeof nextModeOrUpdater === "function"
        ? nextModeOrUpdater(currentMode)
        : nextModeOrUpdater;

      if (!nextMode || nextMode === currentMode) {
        return currentMode;
      }

      backStackRef.current.push(currentMode);
      forwardStackRef.current = [];
      return nextMode;
    });
  }, []);

  const goBack = useCallback(() => {
    setMode((currentMode) => {
      let previousMode = backStackRef.current.pop();
      while (previousMode === currentMode) {
        previousMode = backStackRef.current.pop();
      }

      if (!previousMode) {
        return currentMode;
      }

      forwardStackRef.current.push(currentMode);
      return previousMode;
    });
  }, []);

  const goForward = useCallback(() => {
    setMode((currentMode) => {
      let nextMode = forwardStackRef.current.pop();
      while (nextMode === currentMode) {
        nextMode = forwardStackRef.current.pop();
      }

      if (!nextMode) {
        return currentMode;
      }

      backStackRef.current.push(currentMode);
      return nextMode;
    });
  }, []);

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
      guid: pack?.pack_guid || null,
      search: pack?.name || ""
    });
    navigateMode("packs");
  }, [navigateMode]);

  const clearPackOpenTarget = useCallback(() => {
    setPackOpenTarget(null);
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
          />
        )}

        {mode === "quiz" && (
          <ReviewSession
            setMode={navigateMode}
            {...reviewSession}
          />
        )}

        {mode === "training" && (
          <TrainingSession setMode={navigateMode} />
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
          />
        )}

        {mode === "calendar" && (
          <ReviewCalendar
            setMode={navigateMode}
            questions={manageLibrary.allQuestions}
            onOpenQuestion={openQuestionInManage}
            openQuestionId={calendarOpenQuestionId}
            clearOpenQuestionId={() => setCalendarOpenQuestionId(null)}
          />
        )}

        {mode === "profile" && (
          <Profile
            setMode={navigateMode}
            onOpenSettingsSection={openSettingsSection}
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
            initialPackGuid={packOpenTarget?.guid || null}
            initialSearch={packOpenTarget?.search || ""}
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
