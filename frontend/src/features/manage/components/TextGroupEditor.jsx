import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTextGroupItems, patchTextGroupItems } from "../../../api/textGroups";
import { invalidateTags } from "../../../shared/tagLabels";
import FavoriteToggleButton from "./FavoriteToggleButton";
import SuspendToggleButton from "./SuspendToggleButton";
import {
  cancelButtonStyle,
  dangerButtonStyle,
  disabledCancelButtonStyle,
  disabledSaveButtonStyle,
  inputStyle,
  labelStyle,
  pendingSaveButtonStyle,
  pendingSaveDotStyle,
  buttonStyle
} from "./QuestionEditorStyles";
import {
  QuestionEditorField,
  TagEditor
} from "./QuestionEditorPrimitives";
import AnswerPolicyControl from "./AnswerPolicyControl";
import { answerPolicyFromGroup } from "./answerPolicyControlUtils";

let tempItemCounter = 0;

function nextTempId() {
  tempItemCounter += 1;
  return `new-text-${Date.now()}-${tempItemCounter}`;
}

function normalizeItem(item) {
  const data = item?.data || {};

  return {
    tempId: item?.id ? `text-${item.id}` : item?.tempId || nextTempId(),
    id: item?.id || null,
    type_q: "text",
    question: item?.question || "",
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

  return {
    ...(item.id ? { id: item.id } : {}),
    question: item.question || "",
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
      answerPolicy: answerPolicyFromGroup(group)
    },
    items: items.map(item => ({
      id: item.id || item.tempId,
      question: item.question || "",
      answer: item.answer || "",
      aliases: item.aliases || [],
      data: item.data || {}
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

const textGroupHeaderTagChipStyle = {
  background: "#163b63",
  border: "1px solid #2f5f8f",
  color: "#8fc7ff",
  fontSize: "12px",
  fontWeight: 700
};

const TextGroupItemRow = memo(function TextGroupItemRow({
  aliasInputValue,
  item,
  onAddAlias,
  onRegisterAliasInput,
  onRemoveAlias,
  onRemoveItem,
  onToggleFavorite,
  onToggleSuspended,
  onUpdateAliasInput,
  onUpdateItem,
  selected
}) {
  const hasAliases = (item.aliases || []).length > 0;

  const handleQuestionChange = useCallback((event) => {
    onUpdateItem(item.tempId, { question: event.target.value });
  }, [item.tempId, onUpdateItem]);

  const handleAnswerChange = useCallback((event) => {
    onUpdateItem(item.tempId, { answer: event.target.value });
  }, [item.tempId, onUpdateItem]);

  const handleAliasInputChange = useCallback((event) => {
    onUpdateAliasInput(item.tempId, event.target.value);
  }, [item.tempId, onUpdateAliasInput]);

  const handleAliasKeyDown = useCallback((event) => {
    if (event.key !== "Enter") return;

    event.preventDefault();
    onAddAlias(item, true);
  }, [item, onAddAlias]);

  const handleAliasBlur = useCallback(() => {
    onAddAlias(item);
  }, [item, onAddAlias]);

  const handleAliasRef = useCallback((element) => {
    onRegisterAliasInput(item.tempId, element);
  }, [item.tempId, onRegisterAliasInput]);

  return (
    <div
      data-text-group-item-row
      data-text-group-item-id={item.id || item.tempId}
      style={{
        border: selected ? "1px solid #5eb6ff" : "1px solid #2a2a2a",
        borderRadius: "10px",
        background: selected ? "#15202b" : "#171717",
        boxSizing: "border-box",
        padding: "12px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: "12px",
        alignItems: "center"
      }}
    >
      <div style={{ display: "grid", gap: "10px", minWidth: 0 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: "10px"
          }}
        >
          <label style={{ display: "grid", gap: "6px" }}>
            <span style={labelStyle}>Question</span>
            <input
              value={item.question || ""}
              onChange={handleQuestionChange}
              style={inputStyle}
            />
          </label>

          <label style={{ display: "grid", gap: "6px" }}>
            <span style={labelStyle}>Réponse</span>
            <input
              value={item.answer || ""}
              onChange={handleAnswerChange}
              style={inputStyle}
            />
          </label>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ ...labelStyle, marginBottom: "6px" }}>Alias</div>
          {hasAliases && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
                marginBottom: "8px",
                minWidth: 0
              }}
            >
              {(item.aliases || []).map((alias, index) => (
                <div
                  key={`${alias}-${index}`}
                  style={{
                    alignItems: "center",
                    background: "#333",
                    borderRadius: "6px",
                    display: "inline-flex",
                    gap: "6px",
                    maxWidth: "180px",
                    padding: "5px 8px"
                  }}
                >
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {alias}
                  </span>
                  <button
                    type="button"
                    aria-label={`Retirer l'alias ${alias}`}
                    onClick={() => onRemoveAlias(item, index)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#999",
                      cursor: "pointer",
                      lineHeight: 1,
                      padding: 0
                    }}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={handleAliasRef}
            value={aliasInputValue || ""}
            onChange={handleAliasInputChange}
            onKeyDown={handleAliasKeyDown}
            onBlur={handleAliasBlur}
            placeholder="Alias accepté (Entrée)"
            style={inputStyle}
          />
        </div>
      </div>

      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: "8px"
        }}
      >
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
          type="button"
          onClick={() => onRemoveItem(item)}
          style={{ ...dangerButtonStyle, padding: "8px 10px" }}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
});

export default function TextGroupEditor({
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
  const [aliasInputByTempId, setAliasInputByTempId] = useState({});
  const itemsScrollRef = useRef(null);
  const aliasInputRefs = useRef({});
  const currentGroupRef = useRef(group);
  const saveItemsRef = useRef(null);
  const savedStateRef = useRef(null);
  const groupId = group?.id;
  const selectedItemId = selectedItem?.id ?? null;

  const currentSignature = useMemo(() => (
    buildSignature(editableGroup, sharedTags, items, deletedItemIds)
  ), [deletedItemIds, editableGroup, items, sharedTags]);
  const hasUnsavedChanges = currentSignature !== initialSignature;

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
    setAliasInputByTempId({});
    aliasInputRefs.current = {};
    setLoading(true);
    setSaveStatus("");

    getTextGroupItems(groupId)
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

  const updateAnswerPolicy = useCallback((policy) => {
    setEditableGroup(prev => ({
      ...(prev || {}),
      answer_policy: policy,
      data: {
        ...((prev || {}).data || {}),
        answer_policy: policy
      }
    }));
  }, []);

  const updateItem = useCallback((tempId, patch) => {
    setItems(prev =>
      prev.map(item =>
        item.tempId === tempId ? { ...item, ...patch } : item
      )
    );
  }, []);

  const updateAliasInput = useCallback((tempId, value) => {
    setAliasInputByTempId(prev => ({ ...prev, [tempId]: value }));
  }, []);

  const registerAliasInput = useCallback((tempId, element) => {
    if (element) {
      aliasInputRefs.current[tempId] = element;
    } else {
      delete aliasInputRefs.current[tempId];
    }
  }, []);

  const addAlias = useCallback((item, focusAfter = false) => {
    const value = String(aliasInputByTempId[item.tempId] || "").trim();

    if (!value) return;

    const currentAliases = item.aliases || [];

    if (!currentAliases.includes(value)) {
      updateItem(item.tempId, { aliases: [...currentAliases, value] });
    }

    setAliasInputByTempId(prev => ({ ...prev, [item.tempId]: "" }));

    if (focusAfter) {
      window.requestAnimationFrame(() => {
        aliasInputRefs.current[item.tempId]?.focus();
      });
    }
  }, [aliasInputByTempId, updateItem]);

  const removeAlias = useCallback((item, index) => {
    updateItem(item.tempId, {
      aliases: (item.aliases || []).filter((_, aliasIndex) => aliasIndex !== index)
    });
  }, [updateItem]);

  const addEmptyItem = useCallback(() => {
    const nextItem = normalizeItem({
      question: "",
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

  const removeItem = useCallback((item) => {
    if (item.id) {
      setDeletedItemIds(prev =>
        prev.includes(item.id) ? prev : [...prev, item.id]
      );
    }

    setItems(prev => prev.filter(candidate => candidate.tempId !== item.tempId));
    setAliasInputByTempId(prev => {
      const next = { ...prev };
      delete next[item.tempId];
      return next;
    });
    delete aliasInputRefs.current[item.tempId];
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
    setAliasInputByTempId({});
    aliasInputRefs.current = {};
    setSaveStatus("");
  }, []);

  async function saveTextItems({ autosave = false } = {}) {
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
      // An unnamed group is created under a default name. Adopt it, or the PATCH
      // below would immediately blank it back out.
      nameForSave = created.name || nameForSave;
      setEditableGroup(prev => ({ ...(prev || {}), ...created }));
    }

    setSaveStatus("Enregistrement...");

    try {
      const saveResult = await patchTextGroupItems(targetGroupId, {
        group: {
          name: nameForSave,
          tags: sharedTags || [],
          answer_policy: answerPolicyFromGroup(editableGroup)
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
        alert(error.message || "Impossible de sauvegarder le groupe texte.");
      }

      throw error;
    }
  }

  useEffect(() => {
    saveItemsRef.current = saveTextItems;
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
              Groupe texte
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
              onClick={() => saveTextItems()}
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

        <QuestionEditorField label="Nom du groupe" compact>
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
          chipStyle={textGroupHeaderTagChipStyle}
          inputOverrideStyle={compactHeaderInputStyle}
          labelOverrideStyle={{ fontSize: "12px" }}
        />

        <AnswerPolicyControl
          policy={answerPolicyFromGroup(editableGroup)}
          onChange={updateAnswerPolicy}
        />

        <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={addEmptyItem}
            style={{ ...buttonStyle, ...compactHeaderButtonStyle }}
          >
            Ajouter une ligne
          </button>
          {saveStatus && (
            <span style={{ color: "#888", fontSize: "13px" }}>{saveStatus}</span>
          )}
        </div>
      </div>

      <div
        ref={itemsScrollRef}
        data-testid="text-group-items-scroll"
        className="app-scrollbar"
        style={{
          flex: 1,
          overflow: "auto",
          padding: "14px",
          display: "grid",
          gap: "10px",
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
            Aucune paire — ajoute une ligne
          </div>
        )}

        {!loading && items.map((item) => (
          <TextGroupItemRow
            key={item.tempId}
            aliasInputValue={aliasInputByTempId[item.tempId] || ""}
            item={item}
            onAddAlias={addAlias}
            onRegisterAliasInput={registerAliasInput}
            onRemoveAlias={removeAlias}
            onRemoveItem={removeItem}
            onToggleFavorite={toggleFavorite}
            onToggleSuspended={toggleSuspended}
            onUpdateAliasInput={updateAliasInput}
            onUpdateItem={updateItem}
            selected={Boolean(selectedItemId && selectedItemId === item.id)}
          />
        ))}
      </div>
    </div>
  );
}
