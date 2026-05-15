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
      const path = event.composedPath
        ? event.composedPath()
        : event.path || [];

      const clickedInside = path.some(
        (el) =>
          el instanceof HTMLElement &&
          el.dataset?.deleteCardId === String(openDeleteId)
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

  const items =
    viewMode === "questions"
      ? filteredQuestions
      : allGroups;

  return (
    <div
      style={{
        height: "100%",
        overflow: "hidden",
        background: "#111",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid #262626"
      }}
    >

      {/* HEADER */}
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid #262626",
          background: "#151515",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0
        }}
      >

        <div>
          <div
            style={{
              fontSize: "11px",
              color: "#666",
              fontWeight: "700",
              letterSpacing: "0.08em",
              marginBottom: "5px"
            }}
          >
            {viewMode === "questions"
              ? "QUESTIONS"
              : "GROUPS"}
          </div>

          <div
            style={{
              fontSize: "18px",
              fontWeight: "700",
              color: "#eee"
            }}
          >
            {items.length} éléments
          </div>
        </div>
      </div>

      {/* LIST */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          minHeight: 0
        }}
      >

        {viewMode === "questions" && filteredQuestions.map((q) => {

          const sharedProps = {
            selected: selectedQuestion?.id === q.id,
            deleteOpen: openDeleteId === q.id,
            isRemoving: removingId === q.id
          };

          if (q.type_q === "map") {

            return (
              <div
                key={q.id}
                style={{
                  transition: "all 0.18s ease",
                  opacity: removingId === q.id ? 0 : 1,
                  transform:
                    removingId === q.id
                      ? "scale(0.96)"
                      : "scale(1)"
                }}
              >

                <MapCard
                  {...sharedProps}
                  q={q}

                  onClick={() => {
                    setOpenDeleteId(null);
                    setSelectedQuestion(q);
                    setEditing(q.data?.code);
                  }}

                  onDeleteOpen={() => setOpenDeleteId(q.id)}

                  closeDelete={() => setOpenDeleteId(null)}

                  deleteQuestion={() =>
                    handleDeleteQuestion(q.id)
                  }
                />

              </div>
            );
          }

          return (
            <div
              key={q.id}
              style={{
                transition: "all 0.18s ease",
                opacity: removingId === q.id ? 0 : 1,
                transform:
                  removingId === q.id
                    ? "scale(0.96)"
                    : "scale(1)"
              }}
            >

              <QuestionCard
                {...sharedProps}
                q={q}

                onClick={() => {
                  setOpenDeleteId(null);
                  setSelectedQuestion(q);
                }}

                onDeleteOpen={() => setOpenDeleteId(q.id)}

                closeDelete={() => setOpenDeleteId(null)}

                deleteQuestion={() =>
                  handleDeleteQuestion(q.id)
                }
              />

            </div>
          );
        })}

        {viewMode === "groups" && allGroups.map((group) => (

          <div
            key={group.id}
            style={{
              transition: "all 0.18s ease",
              opacity: removingId === group.id ? 0 : 1,
              transform:
                removingId === group.id
                  ? "scale(0.96)"
                  : "scale(1)"
            }}
          >

            <GroupCardItem
              group={group}
              selected={selectedQuestion?.id === group.id}
              deleteOpen={openDeleteId === group.id}
              isRemoving={removingId === group.id}

              onClick={() => {
                setOpenDeleteId(null);
                setSelectedQuestion(group);
              }}

              onDeleteOpen={() =>
                setOpenDeleteId(group.id)
              }

              closeDelete={() =>
                setOpenDeleteId(null)
              }

              deleteGroup={() =>
                handleDeleteGroup(group.id)
              }
            />

          </div>

        ))}

        {/* EMPTY */}
        {items.length === 0 && (
          <div
            style={{
              marginTop: "40px",
              textAlign: "center",
              color: "#666",
              fontSize: "14px",
              padding: "30px"
            }}
          >
            Aucun élément
          </div>
        )}

      </div>

    </div>
  );
}