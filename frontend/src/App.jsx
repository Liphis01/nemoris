import { useEffect, useState } from "react";
import Menu from "./features/menu/Menu";
import ReviewSession from "./features/review/components/ReviewSession";
import Manage from "./features/manage/components/Manage";
import ReviewCalendar from "./features/calendar/components/ReviewCalendar";
import { useManageLibrary } from "./features/manage/hooks/useManageLibrary";
import { useReviewSession } from "./features/review/hooks/useReviewSession";


function App() {
  // Top-level mode switching is intentionally simple: each feature owns its
  // internal state through hooks, while App only coordinates cross-feature jumps.
  const [mode, setMode] = useState("menu");
  const [manageOpenQuestionId, setManageOpenQuestionId] = useState(null);
  const [calendarOpenQuestionId, setCalendarOpenQuestionId] = useState(null);
  const manageLibrary = useManageLibrary(mode);
  const reviewSession = useReviewSession(mode === "quiz");

  const appStyle = {
    background: "#121212",
    color: "#e5e5e5",
    minHeight: "100%",
    height: "100%",
    padding: "24px",
    fontFamily: "Arial, sans-serif",
    display: "flex",
    flexDirection: "column",
    overflow: "auto",
    boxSizing: "border-box"
  };

  useEffect(() => {
    // Manage is a fixed three-panel workspace, so the body scroll is disabled
    // there and restored for review/menu/calendar screens.
    document.body.style.overflow =
      mode === "manage" ? "hidden" : "auto";
  }, [mode]);

  function openQuestionInManage(question) {
    // Calendar -> Manage navigation should land on the exact question, without
    // whatever filters were previously active in Manage.
    manageLibrary.resetManageFilters();
    manageLibrary.setViewMode("questions");
    manageLibrary.setIsCreatingQuestion(false);
    manageLibrary.setIsCreatingGroup(false);
    manageLibrary.setSelectedItem(question);
    setManageOpenQuestionId(question.id);
    setMode("manage");
  }

  function openQuestionInCalendar(question) {
    // Manage -> Calendar navigation keeps the selected question highlighted
    // after the calendar screen mounts.
    setCalendarOpenQuestionId(question.id);
    setMode("calendar");
  }

  return (
    <div style={appStyle}>
      {mode === "menu" && (
        <Menu setMode={setMode} />
      )}

      {mode === "quiz" && (
        <ReviewSession
          setMode={setMode}
          {...reviewSession}
        />
      )}

      {mode === "manage" && (
        <Manage
          setMode={setMode}
          {...manageLibrary}
          openQuestionId={manageOpenQuestionId}
          clearOpenQuestionId={() => setManageOpenQuestionId(null)}
          onOpenInCalendar={openQuestionInCalendar}
        />
      )}

      {mode === "calendar" && (
        <ReviewCalendar
          setMode={setMode}
          questions={manageLibrary.allQuestions}
          onOpenQuestion={openQuestionInManage}
          openQuestionId={calendarOpenQuestionId}
          clearOpenQuestionId={() => setCalendarOpenQuestionId(null)}
        />
      )}
    </div>
  );
}

export default App;
