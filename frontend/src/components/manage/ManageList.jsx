import { useEffect, useState } from "react";
import QuestionCard from "./QuestionCard";
import MapCard from "./MapCard";
import GroupCardItem from "./GroupCardItem";

export default function ManageList({
  filteredQuestions,
  allGroups,
  selectedQuestion,
  setSelectedQuestion,
  viewMode,
  editing,
  setEditing,
  deleteQuestion,
  deleteGroup
}) {
  const [openDeleteId, setOpenDeleteId] = useState(null);
  const [removingId, setRemovingId] = useState(null);

  function handleDeleteQuestion(id) {
    setRemovingId(id);
    setOpenDeleteId(null);
    setTimeout(async () => {
      try {
        await deleteQuestion(id);
      } finally {
        setRemovingId(null);
      }
    }, 180);
  }

  function handleDeleteGroup(id) {
    setRemovingId(id);
    setOpenDeleteId(null);
    setTimeout(async () => {
      try {
        await deleteGroup(id);
      } finally {
        setRemovingId(null);
      }
    }, 180);
  }

  useEffect(() => {
    if (openDeleteId === null) return;

    function handlePointerDown(event) {
      const path = event.composedPath ? event.composedPath() : event.path || [];
      const clickedInside = path.some(
        (el) => el instanceof HTMLElement && el.dataset?.deleteCardId === String(openDeleteId)
      );

      if (!clickedInside) {
        setOpenDeleteId(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("contextmenu", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("contextmenu", handlePointerDown);
    };
  }, [openDeleteId]);

  return (
    <div
      style={{
        borderRight: "1px solid #2a2a2a",
        overflow: "auto",
        background: "#141414"
      }}
    >
      {viewMode === "questions" && filteredQuestions.map((q) => {

        if (q.type_q === "map") {
          return (
            <MapCard
              key={q.id}
              q={q}
              selected={selectedQuestion?.id === q.id}
              deleteOpen={openDeleteId === q.id}
              isRemoving={removingId === q.id}
              onClick={() => {
                setOpenDeleteId(null);
                setSelectedQuestion(q);
                setEditing(q.data?.code);
              }}
              onDeleteOpen={() => setOpenDeleteId(q.id)}
              closeDelete={() => setOpenDeleteId(null)}
              deleteQuestion={() => handleDeleteQuestion(q.id)}
            />
          );
        }

        return (
          <QuestionCard
            key={q.id}
            q={q}
            selected={selectedQuestion?.id === q.id}
            deleteOpen={openDeleteId === q.id}
            isRemoving={removingId === q.id}
            onClick={() => {
              setOpenDeleteId(null);
              setSelectedQuestion(q);
            }}
            onDeleteOpen={() => setOpenDeleteId(q.id)}
            closeDelete={() => setOpenDeleteId(null)}
            deleteQuestion={() => handleDeleteQuestion(q.id)}
          />
        );
      })}

      {viewMode === "groups" && allGroups.map((group) => (
        <GroupCardItem
          key={group.id}
          group={group}
          selected={selectedQuestion?.id === group.id}
          deleteOpen={openDeleteId === group.id}
          isRemoving={removingId === group.id}
          onClick={() => {
            setOpenDeleteId(null);
            setSelectedQuestion(group);
          }}
          onDeleteOpen={() => setOpenDeleteId(group.id)}
          closeDelete={() => setOpenDeleteId(null)}
          deleteGroup={() => handleDeleteGroup(group.id)}
        />
      ))}
    </div>
  );
}