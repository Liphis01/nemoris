import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getReviewIntakeQueue,
  updateReviewIntakeOrder,
  updateReviewIntakeSuspension
} from "../../../api/review";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";
import { matchesQuestionFilters } from "../utils/questionFilters";
import SuspendToggleButton from "./SuspendToggleButton";
import "./IntakeQueuePanel.css";


function questionId(value) {
  return Number(value);
}


function getGroupId(question) {
  return question?.group_id ?? question?.group?.id ?? null;
}


function questionPrimary(question) {
  if (question?.type_q === "map") {
    return question.answer || question.question || `Question ${question.id}`;
  }

  return question?.question || question?.answer || `Question ${question?.id}`;
}


function questionSecondary(question) {
  const answer = question?.answer || "";
  const groupName = question?.group?.name || "";

  if (groupName && answer) return `${groupName} · ${answer}`;
  if (groupName) return groupName;
  return answer;
}


function blockKey(block) {
  return block.kind === "group"
    ? `group:${block.groupId}`
    : `question:${block.ids[0]}`;
}


function buildQueueBlocks(questions, allQuestions) {
  const groupTotals = new Map();

  allQuestions.forEach(question => {
    const groupId = getGroupId(question);
    if (!groupId) return;
    const key = String(groupId);
    groupTotals.set(key, (groupTotals.get(key) || 0) + 1);
  });

  const grouped = new Map();

  questions.forEach((question, index) => {
    const groupId = getGroupId(question);
    if (!groupId) return;

    const key = String(groupId);
    const current = grouped.get(key) || {
      groupId,
      firstIndex: index,
      group: question.group || { id: groupId, name: `Groupe ${groupId}` },
      questions: []
    };

    current.questions.push(question);
    grouped.set(key, current);
  });

  const emittedGroups = new Set();
  const blocks = [];

  questions.forEach((question) => {
    const groupId = getGroupId(question);
    const groupKey = groupId ? String(groupId) : null;
    const shouldRenderGroup = groupKey && groupTotals.get(groupKey) > 1;

    if (shouldRenderGroup) {
      if (emittedGroups.has(groupKey)) return;

      const groupedEntry = grouped.get(groupKey);
      emittedGroups.add(groupKey);
      blocks.push({
        kind: "group",
        groupId,
        group: groupedEntry.group,
        questions: groupedEntry.questions,
        ids: groupedEntry.questions.map(item => questionId(item.id)),
      });
      return;
    }

    blocks.push({
      kind: "question",
      questions: [question],
      ids: [questionId(question.id)],
    });
  });

  return blocks.map(block => ({
    ...block,
    key: blockKey(block),
  }));
}


function orderByIds(ids, questionsById, filterArgs) {
  return (ids || [])
    .map(id => questionsById.get(questionId(id)))
    .filter(Boolean)
    .filter(question => matchesQuestionFilters(question, filterArgs));
}


function moveBlockOrder(activeIds, blocks, fromKey, toKey, placement) {
  const fromBlock = blocks.find(block => block.key === fromKey);
  const toBlock = blocks.find(block => block.key === toKey);

  if (!fromBlock || !toBlock || fromBlock.key === toBlock.key) {
    return activeIds;
  }

  const movingIds = fromBlock.ids.map(questionId);
  const movingSet = new Set(movingIds);
  const targetIds = toBlock.ids.map(questionId);
  const withoutMoving = activeIds
    .map(questionId)
    .filter(id => !movingSet.has(id));
  const targetStart = withoutMoving.findIndex(id => targetIds.includes(id));

  if (targetStart < 0) return activeIds;

  const targetEnd = targetStart + targetIds.filter(
    id => withoutMoving.includes(id)
  ).length;
  const insertAt = placement === "after" ? targetEnd : targetStart;

  return [
    ...withoutMoving.slice(0, insertAt),
    ...movingIds,
    ...withoutMoving.slice(insertAt),
  ];
}


function moveInsideGroup(activeIds, groupIds, fromId, direction) {
  const normalizedActiveIds = activeIds.map(questionId);
  const currentGroupOrder = normalizedActiveIds
    .filter(id => groupIds.includes(id));
  const index = currentGroupOrder.indexOf(questionId(fromId));
  const targetIndex = direction === "up" ? index - 1 : index + 1;

  if (index < 0 || targetIndex < 0 || targetIndex >= currentGroupOrder.length) {
    return activeIds;
  }

  const reorderedGroup = currentGroupOrder.slice();
  const [moved] = reorderedGroup.splice(index, 1);
  reorderedGroup.splice(targetIndex, 0, moved);

  const firstGroupIndex = normalizedActiveIds.findIndex(
    id => groupIds.includes(id)
  );
  const withoutGroup = normalizedActiveIds.filter(
    id => !groupIds.includes(id)
  );

  return [
    ...withoutGroup.slice(0, firstGroupIndex),
    ...reorderedGroup,
    ...withoutGroup.slice(firstGroupIndex),
  ];
}


export default function IntakeQueuePanel({
  allQuestions = [],
  search = "",
  tagFilter = "",
  tagParents = {},
  tagLabels = {},
  questionTypeFilter = "",
  dueOnly = false,
  favoritesOnly = false,
  suspendedOnly = false,
  patchQuestionsInCache,
  setSelectedItem
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("today");
  const [reserveStatus, setReserveStatus] = useState("active");
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [draggedKey, setDraggedKey] = useState(null);

  const hasFilters = Boolean(
    String(search || "").trim() ||
    tagFilter ||
    questionTypeFilter ||
    dueOnly ||
    favoritesOnly ||
    suspendedOnly
  );

  const questionsById = useMemo(() => {
    return new Map(allQuestions.map(question => [
      questionId(question.id),
      question
    ]));
  }, [allQuestions]);

  const filterArgs = useMemo(() => ({
    search,
    tagFilter,
    tagParents,
    tagLabels,
    questionTypeFilter,
    dueOnly,
    favoritesOnly,
    suspendedOnly
  }), [
    dueOnly,
    favoritesOnly,
    suspendedOnly,
    questionTypeFilter,
    search,
    tagFilter,
    tagLabels,
    tagParents
  ]);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      setQueue(await getReviewIntakeQueue());
    } catch (caught) {
      setError(caught?.message || "File indisponible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const activeIds = (queue?.active_ids || []).map(questionId);
  const displayedIds = mode === "today"
    ? queue?.today_ids || []
    : reserveStatus === "suspended"
      ? queue?.suspended_ids || []
      : queue?.active_ids || [];
  const displayedQuestions = orderByIds(
    displayedIds,
    questionsById,
    filterArgs
  );
  const blocks = buildQueueBlocks(displayedQuestions, allQuestions);
  const canReorder = (
    mode === "reserve" &&
    reserveStatus === "active" &&
    !hasFilters &&
    !loading &&
    !saving &&
    displayedQuestions.length === activeIds.length
  );

  function patchOrderFromQueue(nextQueue) {
    patchQuestionsInCache?.(
      (nextQueue?.active_ids || []).map((id, index) => ({
        id,
        suspended: false,
        intake_order: index + 1
      }))
    );
  }

  async function commitOrder(questionIds) {
    if (!canReorder) return;

    setSaving(true);
    setError("");

    try {
      const nextQueue = await updateReviewIntakeOrder(questionIds);
      setQueue(nextQueue);
      patchOrderFromQueue(nextQueue);
    } catch (caught) {
      setError(caught?.message || "Réorganisation impossible");
      await loadQueue();
    } finally {
      setSaving(false);
    }
  }

  async function setSuspended(ids, suspended) {
    setSaving(true);
    setError("");

    try {
      const nextQueue = await updateReviewIntakeSuspension(ids, suspended);
      setQueue(nextQueue);
      patchQuestionsInCache?.(ids.map(id => ({ id, suspended })));
    } catch (caught) {
      setError(caught?.message || "Mise à jour impossible");
      await loadQueue();
    } finally {
      setSaving(false);
    }
  }

  function moveBlock(fromKey, toKey, placement) {
    commitOrder(moveBlockOrder(
      activeIds,
      blocks,
      fromKey,
      toKey,
      placement
    ));
  }

  function moveBlockByButton(index, direction) {
    const targetIndex = direction === "up" ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= blocks.length) return;

    moveBlock(
      blocks[index].key,
      blocks[targetIndex].key,
      direction === "up" ? "before" : "after"
    );
  }

  function moveQuestionInGroup(block, questionIdToMove, direction) {
    commitOrder(moveInsideGroup(
      activeIds,
      block.ids.map(questionId),
      questionIdToMove,
      direction
    ));
  }

  function toggleGroup(key) {
    setExpandedGroups(previous => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const suspendedView = mode === "reserve" && reserveStatus === "suspended";
  const totalCount = queue?.counts?.total ?? 0;
  const todayCount = queue?.counts?.today ?? 0;
  const activeCount = queue?.counts?.active ?? 0;
  const suspendedCount = queue?.counts?.suspended ?? 0;
  const buttonSummary = loading && !queue
    ? "Chargement..."
    : error && !queue
      ? "File indisponible"
      : `${todayCount} aujourd'hui · ${activeCount} actives · ${suspendedCount} suspendues`;

  return (
    <div className="intake-queue">
      <button
        type="button"
        className="intake-queue-toggle"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          loadQueue();
        }}
      >
        <span className="intake-queue-title">
          <span>File des nouvelles</span>
          <span className="intake-queue-summary">{buttonSummary}</span>
        </span>
        <span className="intake-queue-count" aria-label={`${totalCount} questions`}>
          {totalCount}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Gérer la file des nouvelles questions"
          className="intake-queue-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="intake-queue-modal">
            <header className="intake-queue-modal-header">
              <div className="intake-queue-modal-heading">
                <div className="intake-queue-modal-title">
                  Gérer la file des nouvelles
                </div>
                <div className="intake-queue-modal-summary">
                  {buttonSummary}
                </div>
              </div>
              <button
                type="button"
                className="intake-queue-close"
                aria-label="Fermer"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>

            <div id="manage-intake-queue-panel" className="intake-queue-body">
              <div className="intake-queue-tabs" role="tablist" aria-label="File des nouvelles questions">
                <button
                  type="button"
                  className={`intake-queue-tab${mode === "today" ? " intake-queue-tab-active" : ""}`}
                  onClick={() => setMode("today")}
                >
                  Aujourd'hui · {todayCount}
                </button>
                <button
                  type="button"
                  className={`intake-queue-tab${mode === "reserve" ? " intake-queue-tab-active" : ""}`}
                  onClick={() => setMode("reserve")}
                >
                  Réserve · {activeCount + suspendedCount}
                </button>
              </div>

              {mode === "reserve" && (
                <div className="intake-queue-subtabs" role="tablist" aria-label="Réserve de nouvelles questions">
                  <button
                    type="button"
                    className={`intake-queue-tab${reserveStatus === "active" ? " intake-queue-tab-active" : ""}`}
                    onClick={() => setReserveStatus("active")}
                  >
                    Actives · {activeCount}
                  </button>
                  <button
                    type="button"
                    className={`intake-queue-tab${reserveStatus === "suspended" ? " intake-queue-tab-active" : ""}`}
                    onClick={() => setReserveStatus("suspended")}
                  >
                    Suspendues · {suspendedCount}
                  </button>
                </div>
              )}

              {hasFilters && mode === "reserve" && reserveStatus === "active" && (
                <div className="intake-queue-filtered-note">
                  Vue filtrée
                </div>
              )}

              {loading && (
                <div className="intake-queue-status">Chargement...</div>
              )}

              {!loading && error && (
                <div className="intake-queue-status intake-queue-status-error">
                  {error}
                  <button
                    type="button"
                    className="intake-queue-retry"
                    onClick={loadQueue}
                  >
                    Recharger
                  </button>
                </div>
              )}

              {!loading && !error && queue && blocks.length === 0 && (
                <div className="intake-queue-status">
                  Aucune question
                </div>
              )}

              {!loading && !error && queue && blocks.length > 0 && (
                <div className="intake-queue-list app-scrollbar">
                  {blocks.map((block, index) => (
                    <QueueBlock
                      key={block.key}
                      block={block}
                      index={index}
                      blockCount={blocks.length}
                      canReorder={canReorder}
                      expanded={expandedGroups.has(block.key)}
                      saving={saving}
                      suspendedView={suspendedView}
                      dragged={draggedKey === block.key}
                      onToggleGroup={() => toggleGroup(block.key)}
                      onMoveBlock={moveBlockByButton}
                      onMoveQuestion={moveQuestionInGroup}
                      onSuspend={setSuspended}
                      onSelectQuestion={setSelectedItem}
                      onDragStart={(event) => {
                        if (!canReorder) return;
                        setDraggedKey(block.key);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", block.key);
                      }}
                      onDragOver={(event) => {
                        if (!canReorder || !draggedKey || draggedKey === block.key) {
                          return;
                        }
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        if (!canReorder) return;
                        event.preventDefault();
                        const sourceKey = event.dataTransfer.getData("text/plain") || draggedKey;
                        moveBlock(sourceKey, block.key, "before");
                        setDraggedKey(null);
                      }}
                      onDragEnd={() => setDraggedKey(null)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function QueueBlock({
  block,
  index,
  blockCount,
  canReorder,
  expanded,
  saving,
  suspendedView,
  dragged,
  onToggleGroup,
  onMoveBlock,
  onMoveQuestion,
  onSuspend,
  onSelectQuestion,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}) {
  const actionSuspended = !suspendedView;
  const rowDraggable = canReorder && block.ids.length > 0;

  if (block.kind === "question") {
    const question = block.questions[0];

    return (
      <div
        className={`intake-queue-block${rowDraggable ? " intake-queue-block-draggable" : ""}${dragged ? " intake-queue-block-dragging" : ""}`}
        draggable={rowDraggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
      >
        <QuestionRow
          question={question}
          canReorder={canReorder}
          disableMoveUp={index === 0}
          disableMoveDown={index === blockCount - 1}
          saving={saving}
          suspendedView={suspendedView}
          onMoveUp={() => onMoveBlock(index, "up")}
          onMoveDown={() => onMoveBlock(index, "down")}
          onSuspend={() => onSuspend(block.ids, actionSuspended)}
          onSelect={() => onSelectQuestion?.(question)}
        />
      </div>
    );
  }

  const groupName = block.group?.name || `Groupe ${block.groupId}`;

  return (
    <div
      className={`intake-queue-block${rowDraggable ? " intake-queue-block-draggable" : ""}${dragged ? " intake-queue-block-dragging" : ""}`}
      draggable={rowDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="intake-queue-block-head">
        <div className="intake-queue-question">
          <div className="intake-queue-primary">{groupName}</div>
          <div className="intake-queue-secondary">
            {block.questions.length} question{block.questions.length > 1 ? "s" : ""}
          </div>
        </div>
        <span className="intake-queue-countline">
          Groupe
        </span>
        <MoveButtons
          canReorder={canReorder}
          disableUp={index === 0}
          disableDown={index === blockCount - 1}
          onMoveUp={() => onMoveBlock(index, "up")}
          onMoveDown={() => onMoveBlock(index, "down")}
        />
        <SuspendToggleButton
          suspended={suspendedView}
          scope="group"
          disabled={saving}
          ariaLabel={
            suspendedView
              ? "Reprendre les questions visibles du groupe"
              : "Suspendre les questions visibles du groupe"
          }
          onToggle={() => onSuspend(block.ids, actionSuspended)}
        />
      </div>

      <button
        type="button"
        className="intake-queue-expand"
        onClick={onToggleGroup}
      >
        {expanded ? "Masquer" : "Afficher"}
      </button>

      {expanded && (
        <div className="intake-queue-children">
          {block.questions.map((question, childIndex) => (
            <QuestionRow
              key={question.id}
              question={question}
              canReorder={canReorder}
              compact
              disableMoveUp={childIndex === 0}
              disableMoveDown={childIndex === block.questions.length - 1}
              saving={saving}
              suspendedView={suspendedView}
              onMoveUp={() => onMoveQuestion(block, question.id, "up")}
              onMoveDown={() => onMoveQuestion(block, question.id, "down")}
              onSuspend={() => onSuspend([question.id], actionSuspended)}
              onSelect={() => onSelectQuestion?.(question)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


function QuestionRow({
  question,
  canReorder,
  compact = false,
  disableMoveUp,
  disableMoveDown,
  saving,
  suspendedView,
  onMoveUp,
  onMoveDown,
  onSuspend,
  onSelect
}) {
  const chip = getQuestionTypeChipStyle(question?.type_q);

  return (
    <div className="intake-queue-row">
      <button
        type="button"
        className="intake-queue-question"
        onClick={onSelect}
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          minWidth: 0,
          padding: 0,
          textAlign: "left"
        }}
      >
        <div className="intake-queue-primary">
          {questionPrimary(question)}
        </div>
        {!compact && (
          <div className="intake-queue-secondary">
            {questionSecondary(question)}
          </div>
        )}
      </button>
      <span
        className="intake-queue-chip"
        style={{
          background: chip.background,
          color: chip.color
        }}
      >
        {chip.label}
      </span>
      <div className="intake-queue-actions">
        <MoveButtons
          canReorder={canReorder}
          disableUp={disableMoveUp}
          disableDown={disableMoveDown}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
        />
        <SuspendToggleButton
          suspended={suspendedView}
          disabled={saving}
          onToggle={onSuspend}
        />
      </div>
    </div>
  );
}


function MoveButtons({
  canReorder,
  disableUp,
  disableDown,
  onMoveUp,
  onMoveDown
}) {
  return (
    <div className="intake-queue-actions">
      <button
        type="button"
        className="intake-queue-move"
        aria-label="Monter dans la file"
        disabled={!canReorder || disableUp}
        onClick={onMoveUp}
      >
        ↑
      </button>
      <button
        type="button"
        className="intake-queue-move"
        aria-label="Descendre dans la file"
        disabled={!canReorder || disableDown}
        onClick={onMoveDown}
      >
        ↓
      </button>
    </div>
  );
}
