import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import QuestionCard from "./QuestionCard";
import MapCard from "./MapCard";
import GroupCardItem from "./GroupCardItem";
import GroupHeaderCard from "./GroupHeaderCard";
import { centerListItem } from "../../../shared/scroll";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";
import { buildVisibleRows, getQuestionGroupId } from "../utils/manageRows";

const EMPTY_PLAYLISTS = [];

export default function ManageList({
  filteredQuestions,
  filteredGroups,
  allGroups,
  filteredPlaylists,
  selectedItem,
  setSelectedItem,
  viewMode,
  sortField,
  setEditingZone,
  deleteQuestion,
  deleteGroup,
  highlightedQuestionIds = [],
  highlightedGroupIds = [],
  isCreatingQuestion,
  resetQuestionDraft,
  setIsCreatingQuestion,
  isCreatingGroup,
  resetGroupDraft,
  setIsCreatingGroup,
  allPlaylists = EMPTY_PLAYLISTS,
  setIsCreatingPlaylist,
  questionScrollRequest = null,
  requestManageTransition,
  updateQuestion,
  search = "",
  tagFilter = "",
  questionTypeFilter = "",
  dueOnly = false,
  favoritesOnly = false,
  suspendedOnly = false
}) {
  // This list renders either flat groups or grouped question rows, while also
  // owning local UI state for delete popovers, expansion, and scroll targets.
  const [openDeleteId, setOpenDeleteId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState(() => new Set());
  const hasActiveFilter = Boolean(
    search ||
    tagFilter ||
    questionTypeFilter ||
    dueOnly ||
    favoritesOnly ||
    suspendedOnly
  );
  const prevHasActiveFilterRef = useRef(false);
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
  const handledScrollRequestRef = useRef(null);

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

  const playlistItems = Array.isArray(filteredPlaylists)
    ? filteredPlaylists
    : allPlaylists;
  const items =
    viewMode === "questions"
      ? filteredQuestions
      : viewMode === "playlists"
        ? playlistItems
        : filteredGroups;

  // Derived client-side: every playlist already ships its resolved
  // question_ids, so no extra request and no change to the question payload.
  const playlistNamesByQuestionId = useMemo(() => {
    const index = new Map();

    allPlaylists.forEach((playlist) => {
      (playlist.question_ids || []).forEach((questionId) => {
        const names = index.get(questionId);

        if (names) {
          names.push(playlist.name);
          return;
        }

        index.set(questionId, [playlist.name]);
      });
    });

    return index;
  }, [allPlaylists]);

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

  function expandQuestionGroup(question) {
    // A row nested in a collapsed group has to be revealed before it can be
    // scrolled to.
    const groupId = getQuestionGroupId(question);
    if (!groupId) return;

    setExpandedGroupIds((current) => {
      if (current.has(groupId)) return current;

      const next = new Set(current);
      next.add(groupId);
      return next;
    });
  }

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

    expandQuestionGroup(scrollTarget);
  }, [filteredQuestions, highlightedQuestionIds, selectedItem?.id, selectedItem?.type_q, viewMode]);

  useEffect(() => {
    if (viewMode !== "questions") return;

    const wasActive = prevHasActiveFilterRef.current;
    prevHasActiveFilterRef.current = hasActiveFilter;

    if (wasActive && !hasActiveFilter) {
      const selectedGroupId = selectedItem ? getQuestionGroupId(selectedItem) : null;
      setExpandedGroupIds(selectedGroupId ? new Set([selectedGroupId]) : new Set());
      return;
    }

    if (!hasActiveFilter) return;

    const groupIds = new Set();
    for (const question of filteredQuestions) {
      const groupId = getQuestionGroupId(question);
      if (groupId) groupIds.add(groupId);
    }

    if (groupIds.size === 0) return;

    setExpandedGroupIds((current) => {
      const toAdd = [...groupIds].filter((id) => !current.has(id));
      if (toAdd.length === 0) return current;
      const next = new Set(current);
      toAdd.forEach((id) => next.add(id));
      return next;
    });
  }, [filteredQuestions, hasActiveFilter, viewMode, selectedItem]);

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
    // Panels outside the list (currently the map editor) can ask for a question
    // row to be revealed without changing the selection.
    if (
      !questionScrollRequest ||
      questionScrollRequest === handledScrollRequestRef.current ||
      viewMode !== "questions"
    ) {
      return;
    }

    const scrollTarget = filteredQuestions.find(
      (question) => question.id === questionScrollRequest.questionId
    );
    if (!scrollTarget) return;

    handledScrollRequestRef.current = questionScrollRequest;
    pendingScrollRef.current = {
      viewMode: "questions",
      rowKey: `question:${scrollTarget.id}`
    };

    expandQuestionGroup(scrollTarget);
  }, [filteredQuestions, questionScrollRequest, viewMode]);

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
  }, [highlightedQuestionKey, questionScrollRequest, renderedRowKey, selectedItem?.id, viewMode]);

  function setRowRef(rowKey) {
    return (element) => {
      if (element) {
        rowRefs.current.set(rowKey, element);
      } else {
        rowRefs.current.delete(rowKey);
      }
    };
  }

  function runManageTransition(action) {
    if (requestManageTransition) {
      requestManageTransition(action);
      return;
    }

    action?.();
  }

  async function toggleFavorite(q, savedQuestion) {
    const sourceQuestion = savedQuestion?.id === q.id ? savedQuestion : q;
    const nextData = { ...(sourceQuestion.data || {}) };

    if (nextData.favorite) {
      delete nextData.favorite;
    } else {
      nextData.favorite = true;
    }

    await updateQuestion?.(q.id, { data: nextData });

    if (selectedItem?.id === q.id) {
      setSelectedItem({
        ...sourceQuestion,
        data: nextData
      });
    }
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

  function selectGroupHeader(row) {
    const group = row.groupInfo?.group || allGroups.find(item => String(item.id) === String(row.groupId));

    closeQuestionCreation();
    closeGroupCreation();
    setOpenDeleteId(null);

    if (group) {
      setSelectedItem(group);
      setEditingZone?.(null);
    }

    toggleGroup(row.groupId);
  }

  function closeQuestionCreation() {
    if (!isCreatingQuestion) return;

    setIsCreatingQuestion?.(false);
    resetQuestionDraft?.();
  }

  // A group being created is not persisted until its first real save, and the
  // caller has already flushed that save through runManageTransition. So picking
  // something else abandons it: a named or non-empty group was just written, and
  // an untouched one has nothing worth keeping.
  function closeGroupCreation() {
    if (!isCreatingGroup) return;

    setIsCreatingGroup?.(false);
    resetGroupDraft?.();
  }

  function selectQuestion(q) {
    closeQuestionCreation();
    closeGroupCreation();
    setOpenDeleteId(null);
    setSelectedItem(q);
    setEditingZone(q.type_q === "map" ? q : null);
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
            runManageTransition(() => selectQuestion(q));
          }}
          onDeleteOpen={() => setOpenDeleteId(q.id)}
          closeDelete={() => setOpenDeleteId(null)}
          deleteQuestion={() =>
            handleDeleteQuestion(q.id)
          }
          onToggleFavorite={() =>
            runManageTransition((saveResult) =>
              toggleFavorite(q, saveResult?.question)
            )
          }
        />
      )
      : (
        <QuestionCard
          {...sharedProps}
          q={q}
          playlistNames={playlistNamesByQuestionId.get(q.id) || []}
          onClick={() => {
            runManageTransition(() => selectQuestion(q));
          }}
          onDeleteOpen={() => setOpenDeleteId(q.id)}
          closeDelete={() => setOpenDeleteId(null)}
          deleteQuestion={() =>
            handleDeleteQuestion(q.id)
          }
          onToggleFavorite={() =>
            runManageTransition((saveResult) =>
              toggleFavorite(q, saveResult?.question)
            )
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
              background: getQuestionTypeChipStyle(q.type_q).background,
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

    return (
      <GroupHeaderCard
        key={row.key}
        row={row}
        sticky={sticky}
        isOpen={isOpen}
        selectedInside={selectedInside}
        highlightedInside={highlightedInside}
        setRowRef={setRowRef(row.key)}
        onToggle={() => runManageTransition(() => selectGroupHeader(row))}
      />
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
        minHeight: 0,
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
              : viewMode === "playlists"
                ? "PLAYLISTS"
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
        className="app-scrollbar"
        ref={listRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "10px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          scrollbarGutter: "stable",
          minHeight: 0
        }}
      >

        {viewMode === "questions" && renderQuestionRows()}

        {viewMode === "playlists" && playlistItems.map((playlist) => (
          <div
            key={playlist.id}
            onClick={() => {
              runManageTransition(() => {
                closeQuestionCreation();
                closeGroupCreation();
                setIsCreatingPlaylist?.(false);
                // isPlaylist marks which editor the inspector should open;
                // playlists and groups both have id + name otherwise.
                setSelectedItem({ ...playlist, isPlaylist: true });
              });
            }}
            style={{
              padding: "12px 14px",
              marginBottom: "8px",
              borderRadius: "12px",
              cursor: "pointer",
              border: `1px solid ${
                selectedItem?.isPlaylist && selectedItem.id === playlist.id
                  ? "#1f5348"
                  : "#242424"
              }`,
              background:
                selectedItem?.isPlaylist && selectedItem.id === playlist.id
                  ? "#123a33"
                  : "#161616"
            }}
          >
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontWeight: 700,
              color: "#e6e6e6"
            }}>
              <span aria-hidden="true">🎧</span>
              <span>{playlist.name}</span>
            </div>

            <div style={{ marginTop: 4, fontSize: 12, color: "#8a8a8a" }}>
              {playlist.question_count} question
              {playlist.question_count > 1 ? "s" : ""}
              {(playlist.rules?.clauses || []).length > 0
                ? ` · ${playlist.rules.clauses.length} règle${
                  playlist.rules.clauses.length > 1 ? "s" : ""
                }`
                : " · manuelle"}
              {playlist.generated ? " · auto" : ""}
            </div>
          </div>
        ))}

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
                runManageTransition(() => {
                  closeQuestionCreation();
                  closeGroupCreation();
                  setOpenDeleteId(null);
                  setSelectedItem(group);
                  setEditingZone?.(null);
                });
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
            {viewMode === "playlists"
              ? "Aucune playlist. Une playlist pioche des questions dans plusieurs groupes selon une règle."
              : "Aucun élément"}
          </div>
        )}

      </div>

    </div>
  );
}
