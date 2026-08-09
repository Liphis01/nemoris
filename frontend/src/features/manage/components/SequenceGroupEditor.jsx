import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getSequenceGroupItems,
  patchSequenceGroupItems
} from "../../../api/sequenceGroups";
import { invalidateTags } from "../../../shared/tagLabels";
import {
  normalizeOrder,
  normalizeReviewGoal,
  orderValueText,
  parseOrderValue,
  resolvedReviewGoal,
  sortableOrderValue
} from "../sequenceOrder";
import FavoriteToggleButton from "./FavoriteToggleButton";
import SuspendToggleButton from "./SuspendToggleButton";
import {
  cancelButtonStyle,
  dangerButtonStyle,
  disabledCancelButtonStyle,
  disabledSaveButtonStyle,
  inputStyle,
  pendingSaveButtonStyle,
  pendingSaveDotStyle,
  buttonStyle
} from "./QuestionEditorStyles";
import {
  QuestionEditorField,
  TagEditor
} from "./QuestionEditorPrimitives";

let tempItemCounter = 0;

function nextTempId() {
  tempItemCounter += 1;
  return `new-sequence-${Date.now()}-${tempItemCounter}`;
}

function normalizeItem(item) {
  const data = item?.data || {};

  return {
    tempId: item?.id ? `sequence-${item.id}` : item?.tempId || nextTempId(),
    id: item?.id || null,
    type_q: "sequence",
    answer: item?.answer || item?.label || "",
    tags: item?.tags || [],
    group_id: item?.group_id || null,
    data,
    aliases: item?.aliases || data.aliases || [],
    suspended: Boolean(item?.suspended)
  };
}

function serializeItem(item) {
  const data = { ...(item.data || {}) };
  data.aliases = item.aliases || [];

  // position is deliberately not sent: the backend derives it from this array's
  // order, which is the single source of truth for the rank.
  delete data.position;

  return {
    ...(item.id ? { id: item.id } : {}),
    answer: item.answer || "",
    aliases: item.aliases || [],
    data
  };
}

function buildSignature(group, tags, items, deletedItemIds) {
  return JSON.stringify({
    group: {
      name: group?.name || "",
      tags: tags || [],
      // Without this the Save button never enables for a pure order-setting
      // change and the edit is silently lost.
      order: normalizeOrder(group?.data?.order),
      reviewGoal: normalizeReviewGoal(group?.data?.review_goal)
    },
    // The array order IS the content here, so the signature must be
    // order-sensitive: a pure reorder is an unsaved change like any other.
    items: items.map(item => ({
      id: item.id || item.tempId,
      answer: item.answer || "",
      aliases: item.aliases || [],
      favorite: Boolean(item.data?.favorite),
      orderValue: item.data?.order_value ?? null
    })),
    deletedItemIds: [...deletedItemIds].sort((a, b) => a - b)
  });
}

const compactHeaderInputStyle = {
  ...inputStyle,
  borderRadius: "8px",
  fontSize: "13px",
  padding: "8px 10px"
};

const compactHeaderButtonStyle = {
  padding: "8px 12px"
};

const sequenceGroupHeaderTagChipStyle = {
  background: "#123a3a",
  border: "1px solid #2f6f6f",
  color: "#5eead4",
  fontSize: "12px",
  fontWeight: 700
};

const moveButtonStyle = {
  background: "#232323",
  border: "1px solid #333",
  borderRadius: "6px",
  color: "#aaa",
  cursor: "pointer",
  fontSize: "12px",
  lineHeight: 1,
  padding: "4px 7px"
};

const SequenceItemRow = memo(function SequenceItemRow({
  index,
  isFirst,
  isLast,
  item,
  onDragOver,
  onDragStart,
  onDrop,
  onMove,
  onRemoveItem,
  onToggleFavorite,
  onToggleSuspended,
  onUpdateItem,
  order,
  selected
}) {
  // A derived list is ranked by its attribute, so manual reordering is not just
  // pointless here -- leaving it live would imply an edit the next save discards.
  const isDerived = order?.mode === "derived";

  return (
    <div
      data-sequence-item-row={index + 1}
      draggable={!isDerived}
      onDragOver={isDerived ? undefined : onDragOver}
      onDragStart={isDerived ? undefined : event => onDragStart(event, item)}
      onDrop={isDerived ? undefined : event => onDrop(event, index)}
      style={{
        alignItems: "center",
        background: selected ? "#232b23" : "#181818",
        border: `1px solid ${selected ? "#3f6f4f" : "#2a2a2a"}`,
        borderRadius: "10px",
        display: "grid",
        gap: "10px",
        gridTemplateColumns: isDerived
          ? "auto auto 1fr auto auto"
          : "auto auto 1fr auto",
        padding: "8px 10px"
      }}
    >
      <span
        aria-hidden="true"
        style={{
          color: "#555",
          cursor: isDerived ? "default" : "grab",
          fontSize: "13px",
          opacity: isDerived ? 0.3 : 1
        }}
        title={isDerived ? "Ordre calculé" : "Glisser pour réordonner"}
      >
        {isDerived ? "∑" : "⠿"}
      </span>

      <span
        style={{
          color: "#5eead4",
          fontSize: "12px",
          fontWeight: 700,
          minWidth: "24px",
          textAlign: "right"
        }}
      >
        {index + 1}
      </span>

      <input
        aria-label={`Élément ${index + 1}`}
        onChange={event =>
          onUpdateItem(item.tempId, { answer: event.target.value })
        }
        placeholder="Élément"
        style={inputStyle}
        value={item.answer}
      />

      {isDerived && (
        <input
          aria-label={`Valeur d'ordre de l'élément ${index + 1}`}
          data-sequence-order-value={index + 1}
          onChange={event =>
            onUpdateItem(item.tempId, {
              data: {
                ...(item.data || {}),
                order_value: parseOrderValue(event.target.value, order.kind)
              }
            })
          }
          placeholder={order.kind === "number" ? "n°" : "année"}
          style={{
            ...inputStyle,
            borderColor: sortableOrderValue(item, order.kind) === null
              ? "#6b4a2a"
              : inputStyle.border,
            textAlign: "right",
            width: "88px"
          }}
          value={orderValueText(item.data?.order_value, order.kind)}
        />
      )}

      <div style={{ alignItems: "center", display: "flex", gap: "5px" }}>
        {!isDerived && (
          <>
            <button
              aria-label={`Monter l'élément ${index + 1}`}
              disabled={isFirst}
              onClick={() => onMove(index, index - 1)}
              style={{ ...moveButtonStyle, opacity: isFirst ? 0.35 : 1 }}
              type="button"
            >
              ↑
            </button>
            <button
              aria-label={`Descendre l'élément ${index + 1}`}
              disabled={isLast}
              onClick={() => onMove(index, index + 1)}
              style={{ ...moveButtonStyle, opacity: isLast ? 0.35 : 1 }}
              type="button"
            >
              ↓
            </button>
          </>
        )}

        <FavoriteToggleButton
          favorite={Boolean(item.data?.favorite)}
          onToggle={() => onToggleFavorite(item)}
        />

        <SuspendToggleButton
          suspended={Boolean(item.suspended)}
          disabled={!item.id}
          onToggle={() => onToggleSuspended(item)}
        />

        <button
          onClick={() => onRemoveItem(item)}
          style={{ ...dangerButtonStyle, padding: "6px 9px" }}
          type="button"
        >
          ✕
        </button>
      </div>
    </div>
  );
});

export default function SequenceGroupEditor({
  group,
  availableTags = [],
  ensurePersistedGroup,
  onSave,
  registerPendingSaveHandler,
  selectedItem,
  headerAction,
  updateQuestion
}) {
  const [editableGroup, setEditableGroup] = useState(group);
  const [items, setItems] = useState([]);
  const [deletedItemIds, setDeletedItemIds] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [sharedTags, setSharedTags] = useState(group?.tags || []);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [initialSignature, setInitialSignature] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const itemsScrollRef = useRef(null);
  const currentGroupRef = useRef(group);
  const saveItemsRef = useRef(null);
  const dragTempIdRef = useRef(null);
  const savedStateRef = useRef(null);
  const groupId = group?.id;
  const selectedItemId = selectedItem?.id ?? null;

  const currentSignature = useMemo(() => (
    buildSignature(editableGroup, sharedTags, items, deletedItemIds)
  ), [deletedItemIds, editableGroup, items, sharedTags]);
  const hasUnsavedChanges = currentSignature !== initialSignature;

  const order = useMemo(
    () => normalizeOrder(editableGroup?.data?.order),
    [editableGroup]
  );
  const isDerived = order.mode === "derived";
  const reviewGoal = normalizeReviewGoal(editableGroup?.data?.review_goal);
  const effectiveReviewGoal = resolvedReviewGoal(reviewGoal, order);

  const updateOrder = useCallback(patch => {
    setEditableGroup(prev => {
      const previousOrder = normalizeOrder(prev?.data?.order);

      return {
        ...(prev || {}),
        data: {
          ...((prev || {}).data || {}),
          order: { ...previousOrder, ...patch }
        }
      };
    });
  }, []);

  const updateReviewGoal = useCallback(value => {
    setEditableGroup(prev => ({
      ...(prev || {}),
      data: {
        ...((prev || {}).data || {}),
        review_goal: normalizeReviewGoal(value)
      }
    }));
  }, []);

  // A derived list is sorted by its attribute, so showing it in array order
  // would be a lie between typing a value and saving.
  const displayItems = useMemo(() => {
    if (!isDerived) return items;

    return [...items]
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const leftValue = sortableOrderValue(left.item, order.kind);
        const rightValue = sortableOrderValue(right.item, order.kind);

        if (leftValue === null && rightValue === null) return left.index - right.index;
        if (leftValue === null) return 1;
        if (rightValue === null) return -1;
        if (leftValue !== rightValue) return leftValue - rightValue;

        return left.index - right.index;
      })
      .map(entry => entry.item);
  }, [isDerived, items, order.kind]);

  useEffect(() => {
    currentGroupRef.current = group;
  });

  useEffect(() => {
    if (!groupId) {
      // A pending group has nothing to fetch, and it starts clean so the unsaved
      // marker only appears once the user actually names it or adds a row.
      setItems([]);
      setDeletedItemIds([]);
      setInitialSignature(
        buildSignature(currentGroupRef.current, [], [], [])
      );
      savedStateRef.current = {
        group: currentGroupRef.current,
        tags: [],
        items: []
      };

      return undefined;
    }

    let cancelled = false;
    const selectedGroup = currentGroupRef.current;

    setEditableGroup(selectedGroup);
    setSharedTags(selectedGroup.tags || []);
    setTagInput("");
    setDeletedItemIds([]);
    setBulkText("");
    setBulkOpen(false);
    setLoading(true);
    setSaveStatus("");

    getSequenceGroupItems(groupId)
      .then((data) => {
        if (cancelled) return;

        const normalizedItems = (data || []).map(normalizeItem);

        setItems(normalizedItems);
        setInitialSignature(buildSignature(
          selectedGroup,
          selectedGroup.tags || [],
          normalizedItems,
          []
        ));
        savedStateRef.current = {
          group: selectedGroup,
          tags: selectedGroup.tags || [],
          items: normalizedItems
        };
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setSaveStatus("Chargement impossible");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const updateGroupField = useCallback((field, value) => {
    setEditableGroup(prev => ({ ...(prev || {}), [field]: value }));
  }, []);

  const updateItem = useCallback((tempId, patch) => {
    setItems(prev =>
      prev.map(item =>
        item.tempId === tempId ? { ...item, ...patch } : item
      )
    );
  }, []);

  const moveItem = useCallback((from, to) => {
    setItems(prev => {
      if (to < 0 || to >= prev.length) return prev;

      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);

      return next;
    });
  }, []);

  const handleDragStart = useCallback((event, item) => {
    dragTempIdRef.current = item.tempId;
    event.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback(event => {
    event.preventDefault();
  }, []);

  const handleDrop = useCallback((event, targetIndex) => {
    event.preventDefault();

    const tempId = dragTempIdRef.current;
    dragTempIdRef.current = null;

    if (!tempId) return;

    setItems(prev => {
      const from = prev.findIndex(item => item.tempId === tempId);

      if (from < 0 || from === targetIndex) return prev;

      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(targetIndex, 0, moved);

      return next;
    });
  }, []);

  const addEmptyItem = useCallback(() => {
    const nextItem = normalizeItem({
      answer: "",
      data: { aliases: [] },
      group_id: editableGroup?.id
    });

    setItems(prev => [...prev, nextItem]);

    window.requestAnimationFrame(() => {
      const scrollElement = itemsScrollRef.current;
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    });
  }, [editableGroup]);

  // Typing a 24-letter alphabet one row at a time is the kind of friction that
  // stops a list from ever being created, so one-item-per-line paste is part of
  // the editor rather than a nice-to-have.
  const appendBulkItems = useCallback(() => {
    const labels = bulkText
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);

    if (!labels.length) return;

    setItems(prev => [
      ...prev,
      ...labels.map(label =>
        normalizeItem({
          answer: label,
          data: { aliases: [] },
          group_id: editableGroup?.id
        })
      )
    ]);
    setBulkText("");
    setBulkOpen(false);
  }, [bulkText, editableGroup]);

  const removeItem = useCallback((item) => {
    if (item.id) {
      setDeletedItemIds(prev =>
        prev.includes(item.id) ? prev : [...prev, item.id]
      );
    }

    setItems(prev => prev.filter(candidate => candidate.tempId !== item.tempId));
  }, []);

  const toggleFavorite = useCallback((item) => {
    const data = { ...(item.data || {}) };

    if (data.favorite) {
      delete data.favorite;
    } else {
      data.favorite = true;
    }

    updateItem(item.tempId, { data });
  }, [updateItem]);

  const toggleSuspended = useCallback(async (item) => {
    if (!item.id) return;

    const nextSuspended = !item.suspended;

    try {
      await updateQuestion?.(item.id, { suspended: nextSuspended });
    } catch (error) {
      console.error(error);
      alert(error.message || "Impossible de suspendre la question.");
      return;
    }

    updateItem(item.tempId, { suspended: nextSuspended });
  }, [updateItem, updateQuestion]);

  const addTag = useCallback((selectedTag) => {
    const value = String(selectedTag ?? tagInput).trim();

    if (!value || sharedTags.includes(value)) return;

    setSharedTags(prev => [...prev, value]);
    setTagInput("");
  }, [sharedTags, tagInput]);

  const removeTag = useCallback((tag) => {
    setSharedTags(prev => prev.filter(item => item !== tag));
  }, []);

  const cancelChanges = useCallback(() => {
    const snapshot = savedStateRef.current;
    if (!snapshot) return;

    setEditableGroup(snapshot.group);
    setSharedTags(snapshot.tags);
    setItems(snapshot.items);
    setDeletedItemIds([]);
    setTagInput("");
    setSaveStatus("");
  }, []);

  async function saveSequenceItems({ autosave = false } = {}) {
    if (!hasUnsavedChanges) {
      return { saved: false };
    }

    // The group may not exist server-side yet: it is created at the first save
    // that has something worth keeping, so backing out of a mis-click leaves no
    // row behind.
    let targetGroupId = group?.id;
    let nameForSave = editableGroup?.name || "";

    if (!targetGroupId) {
      const created = await ensurePersistedGroup?.({
        name: nameForSave,
        itemCount: items.length
      });

      if (!created?.id) {
        return { saved: false };
      }

      targetGroupId = created.id;
      // An unnamed list is created under a default name. Adopt it, or the PATCH
      // below would immediately blank it back out.
      nameForSave = created.name || nameForSave;
      setEditableGroup(prev => ({ ...(prev || {}), ...created }));
    }

    setSaveStatus("Enregistrement...");

    try {
      const saveResult = await patchSequenceGroupItems(targetGroupId, {
        group: {
          name: nameForSave,
          tags: sharedTags || [],
          order,
          review_goal: reviewGoal
        },
        items: items.map(serializeItem),
        deleted_item_ids: deletedItemIds
      });
      const savedGroup = saveResult.group || editableGroup;
      const savedItems = (saveResult.items || []).map(normalizeItem);

      setEditableGroup(savedGroup);
      setItems(savedItems);
      setDeletedItemIds([]);
      setSharedTags(savedGroup.tags || sharedTags || []);
      setInitialSignature(buildSignature(
        savedGroup,
        savedGroup.tags || sharedTags || [],
        savedItems,
        []
      ));
      savedStateRef.current = {
        group: savedGroup,
        tags: savedGroup.tags || sharedTags || [],
        items: savedItems
      };
      setSaveStatus("Enregistré");
      invalidateTags().catch(() => {});

      await onSave?.(saveResult);

      return { saved: true, group: savedGroup, items: savedItems };
    } catch (error) {
      console.error(error);
      setSaveStatus("Enregistrement impossible");

      if (!autosave) {
        alert(error.message || "Impossible de sauvegarder la liste.");
      }

      throw error;
    }
  }

  useEffect(() => {
    saveItemsRef.current = saveSequenceItems;
  });

  useEffect(() => {
    if (!registerPendingSaveHandler) {
      return undefined;
    }

    const saveIfDirty = () => saveItemsRef.current?.({ autosave: true }) || {
      saved: false
    };

    return registerPendingSaveHandler(saveIfDirty);
  }, [registerPendingSaveHandler]);

  return (
    <div
      style={{
        background: "#1e1e1e",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden"
      }}
    >
      <div
        style={{
          borderBottom: "1px solid #2a2a2a",
          padding: "12px 14px",
          display: "grid",
          gap: "9px"
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: "10px",
            justifyContent: "space-between"
          }}
        >
          <div>
            <div style={{ color: "#777", fontSize: "11px", marginBottom: "3px" }}>
              Liste ordonnée
            </div>
            <div style={{ color: "#eee", fontSize: "17px", fontWeight: 800 }}>
              {editableGroup?.name || "Sans titre"}
            </div>
          </div>

          <div style={{ alignItems: "center", display: "flex", gap: "10px" }}>
            {headerAction}
            <button
              type="button"
              onClick={cancelChanges}
              disabled={!hasUnsavedChanges}
              title={hasUnsavedChanges ? undefined : "Aucune modification à annuler"}
              style={
                hasUnsavedChanges
                  ? { ...cancelButtonStyle, ...compactHeaderButtonStyle }
                  : { ...disabledCancelButtonStyle, ...compactHeaderButtonStyle }
              }
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => saveSequenceItems()}
              disabled={!hasUnsavedChanges}
              style={
                hasUnsavedChanges
                  ? { ...pendingSaveButtonStyle, ...compactHeaderButtonStyle }
                  : { ...disabledSaveButtonStyle, ...compactHeaderButtonStyle }
              }
            >
              {hasUnsavedChanges && <span aria-hidden="true" style={pendingSaveDotStyle} />}
              Enregistrer
            </button>
          </div>
        </div>

        <QuestionEditorField label="Nom de la liste" compact>
          <input
            value={editableGroup?.name || ""}
            onChange={(event) => updateGroupField("name", event.target.value)}
            style={compactHeaderInputStyle}
          />
        </QuestionEditorField>

        <TagEditor
          compact
          tags={sharedTags}
          tagInput={tagInput}
          availableTags={availableTags}
          onTagInputChange={setTagInput}
          onAddTag={addTag}
          onRemoveTag={removeTag}
          chipStyle={sequenceGroupHeaderTagChipStyle}
          inputOverrideStyle={compactHeaderInputStyle}
          labelOverrideStyle={{ fontSize: "12px" }}
        />

        <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={addEmptyItem}
            style={{ ...buttonStyle, ...compactHeaderButtonStyle }}
          >
            Ajouter une ligne
          </button>

          <button
            type="button"
            onClick={() => setBulkOpen(prev => !prev)}
            style={{ ...buttonStyle, ...compactHeaderButtonStyle }}
          >
            Coller une liste
          </button>

          <button
            data-sequence-order-toggle=""
            type="button"
            onClick={() => setOrderOpen(prev => !prev)}
            style={{ ...buttonStyle, ...compactHeaderButtonStyle }}
          >
            Ordre{isDerived ? " · calculé" : ""}
          </button>

          {saveStatus && (
            <span style={{ color: "#888", fontSize: "13px" }}>{saveStatus}</span>
          )}
        </div>

        {orderOpen && (
          <div data-sequence-order-panel="" style={{ display: "grid", gap: "7px" }}>
            <label
              htmlFor="sequence-order-mode"
              style={{ color: "#bbb", fontSize: "12px" }}
            >
              Ordre de la liste
            </label>
            <select
              id="sequence-order-mode"
              onChange={event => updateOrder({ mode: event.target.value })}
              style={compactHeaderInputStyle}
              value={order.mode}
            >
              <option value="manual">Manuel — l'ordre des lignes</option>
              <option value="derived">Calculé — trier par une valeur</option>
            </select>

            {isDerived && (
              <>
                <label
                  htmlFor="sequence-order-kind"
                  style={{ color: "#bbb", fontSize: "12px" }}
                >
                  Trier par
                </label>
                <select
                  id="sequence-order-kind"
                  onChange={event => updateOrder({ kind: event.target.value })}
                  style={compactHeaderInputStyle}
                  value={order.kind}
                >
                  <option value="date">Année</option>
                  <option value="number">Nombre</option>
                </select>

                <span style={{ color: "#888", fontSize: "12px" }}>
                  Le rang est recalculé à l'enregistrement. Les éléments sans
                  valeur passent à la fin.
                </span>
              </>
            )}

            <label
              htmlFor="sequence-review-goal"
              style={{ color: "#bbb", fontSize: "12px" }}
            >
              Objectif de révision
            </label>
            <select
              id="sequence-review-goal"
              onChange={event => updateReviewGoal(event.target.value)}
              style={compactHeaderInputStyle}
              value={reviewGoal}
            >
              <option value="auto">Automatique</option>
              <option value="recitation">Réciter dans l'ordre</option>
              <option value="random_access">Retrouver par position</option>
            </select>
            <span style={{ color: "#888", fontSize: "12px" }}>
              Automatique utilise {effectiveReviewGoal === "recitation"
                ? "la récitation pour un ordre manuel"
                : "l'accès par position pour un ordre calculé"}.
            </span>
          </div>
        )}

        {bulkOpen && (
          <div style={{ display: "grid", gap: "7px" }}>
            <textarea
              aria-label="Coller une liste, un élément par ligne"
              onChange={event => setBulkText(event.target.value)}
              placeholder={"Alpha\nBêta\nGamma"}
              rows={5}
              style={{ ...compactHeaderInputStyle, resize: "vertical" }}
              value={bulkText}
            />
            <div>
              <button
                onClick={appendBulkItems}
                style={{ ...buttonStyle, ...compactHeaderButtonStyle }}
                type="button"
              >
                Ajouter à la liste
              </button>
            </div>
          </div>
        )}
      </div>

      <div
        ref={itemsScrollRef}
        data-testid="sequence-group-items-scroll"
        className="app-scrollbar"
        style={{
          flex: 1,
          overflow: "auto",
          padding: "14px",
          display: "grid",
          gap: "8px",
          alignContent: "start",
          scrollbarGutter: "stable"
        }}
      >
        {loading && (
          <div style={{ color: "#888", padding: "18px" }}>Chargement...</div>
        )}

        {!loading && items.length === 0 && (
          <div
            style={{
              alignItems: "center",
              border: "1px dashed #333",
              borderRadius: "10px",
              color: "#777",
              display: "flex",
              justifyContent: "center",
              minHeight: "160px"
            }}
          >
            Liste vide — ajoute une ligne ou colle une liste
          </div>
        )}

        {!loading && displayItems.map((item, index) => (
          <SequenceItemRow
            key={item.tempId}
            index={index}
            isFirst={index === 0}
            isLast={index === displayItems.length - 1}
            item={item}
            order={order}
            onDragOver={handleDragOver}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onMove={moveItem}
            onRemoveItem={removeItem}
            onToggleFavorite={toggleFavorite}
            onToggleSuspended={toggleSuspended}
            onUpdateItem={updateItem}
            selected={Boolean(item.id) && item.id === selectedItemId}
          />
        ))}
      </div>
    </div>
  );
}
