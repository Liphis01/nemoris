import { useEffect, useState } from "react";
import Menu from "./features/menu/Menu";
import Quiz from "./features/review/components/Quiz";
import Manage from "./features/manage/components/Manage";
import ReviewCalendar from "./features/calendar/components/ReviewCalendar";
import { useManageLibrary } from "./features/manage/hooks/useManageLibrary";
import { useReviewSession } from "./features/review/hooks/useReviewSession";


function App() {
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
    document.body.style.overflow =
      mode === "manage" ? "hidden" : "auto";
  }, [mode]);

  function openQuestionInManage(question) {
    manageLibrary.resetManageFilters();
    manageLibrary.setViewMode("questions");
    manageLibrary.setIsCreating(false);
    manageLibrary.setIsCreatingGroup(false);
    manageLibrary.setSelectedQuestion(question);
    setManageOpenQuestionId(question.id);
    setMode("manage");
  }

  function openQuestionInCalendar(question) {
    setCalendarOpenQuestionId(question.id);
    setMode("calendar");
  }

  return (
    <div style={appStyle}>
      {mode === "menu" && (
        <Menu setMode={setMode} />
      )}

      {mode === "quiz" && (
        <Quiz
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
