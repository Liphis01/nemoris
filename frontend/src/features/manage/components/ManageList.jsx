import { useEffect, useLayoutEffect, useRef, useState } from "react";
import QuestionCard from "./QuestionCard";
import MapCard from "./MapCard";
import GroupCardItem from "./GroupCardItem";
import { centerListItem } from "../../../shared/scroll";
import { buildVisibleRows, getQuestionGroupId } from "../utils/manageRows";

export default function ManageList({
  filteredQuestions,
  filteredGroups,
  allGroups,
  selectedItem,
  setSelectedItem,
  viewMode,
  sortField,
  setEditingZone,
  deleteQuestion,
  deleteGroup,
  highlightedQuestionIds = [],
  highlightedGroupIds = []
}) {
  // This list renders either flat groups or grouped question rows, while also
  // owning local UI state for delete popovers, expansion, and scroll targets.
  const [openDeleteId, setOpenDeleteId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState(() => new Set());
  const listRef = useRef(null);
  const rowRefs = useRef(new Map());
  const pendingScrollRef = useRef(null);
  const lastQuestionScrollSignalRef = useRef({
    selectedId: null,
    highlightKey: "",
    viewMode: null
  });
  const lastGroupScrollSignalRef = useRef({
    selectedId: null,
    viewMode: null
  });

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

        if (selectedItem?.id === id) {
          setSelectedItem(null);
          setEditingZone?.(null);
        }
      } finally {
        setRemovingId(null);
      }
    }, 180);
  }

  useEffect(() => {
    if (openDeleteId === null) return;

    // Clicking outside a delete confirmation card closes it without touching
    // the selected Manage item.
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
      : filteredGroups;

  const visibleRows =
    viewMode === "questions"
      ? buildVisibleRows(filteredQuestions, allGroups, expandedGroupIds, sortField)
      : [];
  const visibleQuestionRowKey = visibleRows.map((row) => row.key).join("|");
  const visibleGroupRowKey =
    viewMode === "groups"
      ? filteredGroups.map((group) => `group:${group.id}`).join("|")
      : "";
  const renderedRowKey =
    viewMode === "questions"
      ? visibleQuestionRowKey
      : visibleGroupRowKey;
  const highlightedQuestionKey = highlightedQuestionIds.join("|");

  useLayoutEffect(() => {
    const previous = lastQuestionScrollSignalRef.current;

    // Selection/highlight changes are translated into a pending row scroll.
    // If the target is inside a collapsed group, expand it first.
    if (viewMode !== "questions") {
      lastQuestionScrollSignalRef.current = {
        ...previous,
        viewMode
      };
      return;
    }

    const selectedListQuestion = selectedItem?.type_q
      ? filteredQuestions.find((question) => selectedItem.id === question.id)
      : null;
    const highlightedQuestionSet = new Set(highlightedQuestionIds);
    const firstHighlightedQuestion = filteredQuestions.find((question) =>
      highlightedQuestionSet.has(question.id)
    );
    const selectedId = selectedListQuestion?.id ?? null;
    const highlightKey = highlightedQuestionIds.join("|");
    const enteredQuestions = previous.viewMode !== "questions";
    const selectedChanged = selectedId !== previous.selectedId;
    const highlightChanged = highlightKey !== "" && highlightKey !== previous.highlightKey;
    const scrollTarget = selectedListQuestion || firstHighlightedQuestion;

    lastQuestionScrollSignalRef.current = {
      selectedId,
      highlightKey,
      viewMode
    };

    if (!scrollTarget) {
      if (pendingScrollRef.current?.viewMode === "questions") {
        pendingScrollRef.current = null;
      }
      return;
    }

    if (!enteredQuestions && !selectedChanged && !highlightChanged) {
      return;
    }

    pendingScrollRef.current = {
      viewMode: "questions",
      rowKey: `question:${scrollTarget.id}`
    };

    const groupId = getQuestionGroupId(scrollTarget);
    if (!groupId) return;

    setExpandedGroupIds((current) => {
      if (current.has(groupId)) return current;

      const next = new Set(current);
      next.add(groupId);
      return next;
    });
  }, [filteredQuestions, highlightedQuestionIds, selectedItem?.id, selectedItem?.type_q, viewMode]);

  useLayoutEffect(() => {
    const previous = lastGroupScrollSignalRef.current;

    // Groups mode has no nested rows, so selected groups can be scrolled
    // directly after render.
    if (viewMode !== "groups") {
      lastGroupScrollSignalRef.current = {
        ...previous,
        viewMode
      };
      return;
    }

    const selectedGroup = selectedItem?.type_group
      ? filteredGroups.find((group) => selectedItem.id === group.id)
      : null;
    const selectedId = selectedGroup?.id ?? null;
    const enteredGroups = previous.viewMode !== "groups";
    const selectedChanged = selectedId !== previous.selectedId;

    lastGroupScrollSignalRef.current = {
      selectedId,
      viewMode
    };

    if (!selectedGroup) {
      if (pendingScrollRef.current?.viewMode === "groups") {
        pendingScrollRef.current = null;
      }
      return;
    }

    if (!enteredGroups && !selectedChanged) {
      return;
    }

    pendingScrollRef.current = {
      viewMode: "groups",
      rowKey: `group:${selectedGroup.id}`
    };
  }, [filteredGroups, selectedItem?.id, selectedItem?.type_group, viewMode]);

  useLayoutEffect(() => {
    // Execute pending scrolls only after React has committed the matching rows
    // and refs are available.
    const pendingScroll = pendingScrollRef.current;
    if (!pendingScroll || pendingScroll.viewMode !== viewMode) return;

    const list = listRef.current;
    const row = rowRefs.current.get(pendingScroll.rowKey);
    if (!list || !row) return;

    centerListItem(list, row);
    pendingScrollRef.current = null;
  }, [highlightedQuestionKey, renderedRowKey, selectedItem?.id, viewMode]);

  function setRowRef(rowKey) {
    return (element) => {
      if (element) {
        rowRefs.current.set(rowKey, element);
      } else {
        rowRefs.current.delete(rowKey);
      }
    };
  }

  function toggleGroup(groupId) {
    setOpenDeleteId(null);

    if (expandedGroupIds.has(groupId)) {
      pendingScrollRef.current = {
        viewMode: "questions",
        rowKey: `group:${groupId}`
      };
    }

    setExpandedGroupIds((current) => {
      const next = new Set(current);

      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }

      return next;
    });
  }

  function renderQuestionCard(row) {
    const q = row.question;
    const sharedProps = {
      selected: selectedItem?.id === q.id,
      deleteOpen: openDeleteId === q.id,
      isRemoving: removingId === q.id,
      isHighlighted: highlightedQuestionIds.includes(q.id)
    };

    const card = q.type_q === "map"
      ? (
        <MapCard
          {...sharedProps}
          q={q}
          onClick={() => {
            setOpenDeleteId(null);
            setSelectedItem(q);
            setEditingZone(q);
          }}
          onDeleteOpen={() => setOpenDeleteId(q.id)}
          closeDelete={() => setOpenDeleteId(null)}
          deleteQuestion={() =>
            handleDeleteQuestion(q.id)
          }
        />
      )
      : (
        <QuestionCard
          {...sharedProps}
          q={q}
          onClick={() => {
            setOpenDeleteId(null);
            setSelectedItem(q);
            setEditingZone(null);
          }}
          onDeleteOpen={() => setOpenDeleteId(q.id)}
          closeDelete={() => setOpenDeleteId(null)}
          deleteQuestion={() =>
            handleDeleteQuestion(q.id)
          }
        />
      );

    return (
      <div
        key={row.key}
        ref={setRowRef(row.key)}
        data-manage-question-id={q.id}
        style={{
          transition: "all 0.18s ease",
          opacity: removingId === q.id ? 0 : 1,
          transform:
            removingId === q.id
              ? "scale(0.96)"
              : "scale(1)",
          ...(row.nested
            ? {
              display: "grid",
              gridTemplateColumns: "8px minmax(0, 1fr)",
              gap: "8px",
              alignItems: "stretch"
            }
            : {})
        }}
      >
        {row.nested && (
          <span
            aria-hidden="true"
            style={{
              width: "3px",
              borderRadius: "999px",
              background: q.type_q === "map" ? "#5a3b12" : "#163b63",
              opacity: sharedProps.selected || sharedProps.isHighlighted ? 1 : 0.55,
              margin: "6px 0",
              justifySelf: "center"
            }}
          />
        )}

        <div style={{ minWidth: 0 }}>
          {card}
        </div>
      </div>
    );
  }

  function renderGroupHeader(row, { sticky = false } = {}) {
    const { groupId, groupInfo } = row;
    const isOpen = expandedGroupIds.has(groupId);
    const selectedInside = groupInfo.questions.some(
      (question) => selectedItem?.type_q && selectedItem.id === question.id
    );
    const highlightedInside = groupInfo.questions.some(
      (question) => highlightedQuestionIds.includes(question.id)
    );
    const background = isOpen
      ? "#1a1a1a"
      : selectedInside
        ? "#181818"
        : "transparent";
    const border = selectedInside
      ? "1px solid #3a3a3a"
      : highlightedInside
        ? "1px solid rgba(134, 239, 172, 0.75)"
        : "1px solid #262626";

    return (
      <button
        key={row.key}
        ref={setRowRef(row.key)}
        type="button"
        onClick={() => toggleGroup(groupId)}
        aria-expanded={isOpen}
        style={{
          width: "100%",
          ...(sticky
            ? {
              position: "sticky",
              top: 0,
              zIndex: 3
            }
            : {}),
          border,
          borderRadius: "12px",
          background,
          color: "#eee",
          padding: "9px 10px",
          cursor: "pointer",
          display: "grid",
          gridTemplateColumns: "18px minmax(0, 1fr) auto",
          alignItems: "center",
          gap: "8px",
          textAlign: "left",
          boxShadow: highlightedInside
            ? "0 0 0 4px rgba(134, 239, 172, 0.08), 0 0 22px rgba(34, 197, 94, 0.2)"
            : "none",
          transition: "border 0.16s ease, background 0.16s ease, box-shadow 0.16s ease"
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = isOpen ? "#1d1d1d" : "#181818";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = background;
        }}
      >
        <span
          aria-hidden="true"
          style={{
            color: "#777",
            fontSize: "14px",
            lineHeight: 1,
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.14s ease"
          }}
        >
          ▸
        </span>

        <span
          style={{
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "3px"
          }}
        >
          <span
            style={{
              color: "#e5e5e5",
              fontSize: "14px",
              fontWeight: "700",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {groupInfo.name}
          </span>
          <span
            style={{
              color: "#777",
              fontSize: "11px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {groupInfo.type}
          </span>
        </span>

        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            flexWrap: "wrap",
            gap: "6px",
            minWidth: 0
          }}
        >
          {groupInfo.mapCount > 0 && (
            <span
              style={{
                fontSize: "10px",
                fontWeight: "700",
                padding: "2px 6px",
                borderRadius: "999px",
                background: "#5a3b12",
                color: "#ffc76b",
                whiteSpace: "nowrap"
              }}
            >
              {groupInfo.mapCount} MAP
            </span>
          )}
          {groupInfo.textCount > 0 && (
            <span
              style={{
                fontSize: "10px",
                fontWeight: "700",
                padding: "2px 6px",
                borderRadius: "999px",
                background: "#163b63",
                color: "#5eb6ff",
                whiteSpace: "nowrap"
              }}
            >
              {groupInfo.textCount} TEXT
            </span>
          )}
          <span
            style={{
              color: "#777",
              fontSize: "11px",
              minWidth: "16px",
              textAlign: "right",
              whiteSpace: "nowrap"
            }}
          >
            {groupInfo.questions.length}
          </span>
        </span>
      </button>
    );
  }

  function renderQuestionRows() {
    const renderedRows = [];

    for (let index = 0; index < visibleRows.length; index += 1) {
      const row = visibleRows[index];

      if (row.type !== "groupHeader" || !expandedGroupIds.has(row.groupId)) {
        renderedRows.push(
          row.type === "groupHeader"
            ? renderGroupHeader(row)
            : renderQuestionCard(row)
        );
        continue;
      }

      const nestedRows = [];
      let nextIndex = index + 1;

      while (
        nextIndex < visibleRows.length &&
        visibleRows[nextIndex].type === "question" &&
        visibleRows[nextIndex].nested &&
        visibleRows[nextIndex].groupId === row.groupId
      ) {
        nestedRows.push(visibleRows[nextIndex]);
        nextIndex += 1;
      }

      renderedRows.push(
        <div
          key={`section:${row.groupId}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            position: "relative"
          }}
        >
          {renderGroupHeader(row, { sticky: true })}
          {nestedRows.map(renderQuestionCard)}
        </div>
      );

      index = nextIndex - 1;
    }

    return renderedRows;
  }

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
        ref={listRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "10px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          minHeight: 0
        }}
      >

        {viewMode === "questions" && renderQuestionRows()}

        {viewMode === "groups" && filteredGroups.map((group) => (

          <div
            key={group.id}
            ref={setRowRef(`group:${group.id}`)}
            data-manage-group-id={group.id}
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
              selected={selectedItem?.id === group.id}
              deleteOpen={openDeleteId === group.id}
              isRemoving={removingId === group.id}
              isHighlighted={highlightedGroupIds.includes(group.id)}

              onClick={() => {
                setOpenDeleteId(null);
                setSelectedItem(group);
                setEditingZone?.(null);
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
