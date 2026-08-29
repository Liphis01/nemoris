import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMediaGroupItems, patchMediaGroupItems } from "../../../api/mediaGroups";
import { invalidateTags } from "../../../shared/tagLabels";
import FavoriteToggleButton from "./FavoriteToggleButton";
import SuspendToggleButton from "./SuspendToggleButton";
import {
  buttonStyle,
  cancelButtonStyle,
  dangerButtonStyle,
  disabledCancelButtonStyle,
  disabledSaveButtonStyle,
  inputStyle,
  labelStyle,
  pendingSaveButtonStyle,
  pendingSaveDotStyle
} from "./QuestionEditorStyles";
import { normalizeMediaPool } from "../../../shared/media";
import { matchesSearch } from "../utils/questionFilters";
import {
  MediaPoolField,
  QuestionEditorField,
  TagEditor
} from "./QuestionEditorPrimitives";
import AnswerPolicyControl from "./AnswerPolicyControl";
import { answerPolicyFromGroup } from "./answerPolicyControlUtils";

let tempItemCounter = 0;
const MEDIA_GROUP_ROW_HEIGHT = 214;
const MEDIA_GROUP_ROW_GAP = 10;
const MEDIA_GROUP_ROW_SLOT_HEIGHT = MEDIA_GROUP_ROW_HEIGHT + MEDIA_GROUP_ROW_GAP;
const MEDIA_GROUP_OVERSCAN_ROWS = 8;
const MEDIA_GROUP_DEFAULT_VIEWPORT_HEIGHT = 720;

function nextTempId() {
  tempItemCounter += 1;
  return `new-image-${Date.now()}-${tempItemCounter}`;
}

function answerFromFilename(filename) {
  const basename = String(filename || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();

  return basename || "Image";
}

function filenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split("/").filter(Boolean).pop();

    return filename ? decodeURIComponent(filename) : parsed.hostname;
  } catch {
    return url;
  }
}

function isMediaFile(file) {
  const type = file?.type || "";

  return (
    !type ||
    type.startsWith("image/") ||
    type.startsWith("audio/") ||
    type.startsWith("video/")
  );
}

function imageFilesFromFileList(fileList) {
  return Array.from(fileList || []).filter(isMediaFile);
}

function transferHasImageFiles(dataTransfer) {
  return Array.from(dataTransfer?.items || []).some(item =>
    item.kind === "file" && isMediaFile(item)
  );
}

// Converts vertical wheel scroll into horizontal scroll on the (scrollbar-less)
// alias chip strip, since a trackpad/mouse wheel over a nowrap row otherwise
// does nothing. Mirrors MapEditor's identical chip-strip behaviour.
function handleHorizontalChipWheel(event) {
  const chip = event.target?.closest?.("[data-chip-wheel-target]");

  if (!chip || !event.currentTarget.contains(chip)) {
    return;
  }

  const strip = event.currentTarget;
  const maxScrollLeft = strip.scrollWidth - strip.clientWidth;

  if (maxScrollLeft <= 0) {
    return;
  }

  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX
    : event.deltaY;

  if (!delta) {
    return;
  }

  event.preventDefault();
  strip.scrollLeft = Math.max(
    0,
    Math.min(maxScrollLeft, strip.scrollLeft + delta)
  );
}

function normalizeItem(item) {
  const data = item?.data || {};
  const mediaPool = normalizeMediaPool(
    item?.media_pool?.length
      ? item.media_pool
      : data.media_pool?.length
        ? data.media_pool
        : item?.media
          ? [item.media]
          : []
  );

  return {
    tempId: item?.id ? `image-${item.id}` : item?.tempId || nextTempId(),
    id: item?.id || null,
    type_q: "media",
    question: item?.question || "",
    answer: item?.answer || item?.label || "",
    media: item?.media || mediaPool[0] || "",
    media_pool: mediaPool,
    tags: item?.tags || [],
    group_id: item?.group_id || null,
    data,
    aliases: item?.aliases || data.aliases || [],
    progress: item?.progress || null,
    group: item?.group || null,
    suspended: Boolean(item?.suspended)
  };
}

function serializeItem(item) {
  const pool = normalizeMediaPool(
    item.media_pool?.length
      ? item.media_pool
      : item.media
        ? [item.media]
        : []
  );
  const data = {
    ...(item.data || {})
  };
  data.aliases = item.aliases || [];
  // The backend rederives data.media_pool from the media_pool field, so don't
  // ship a stale copy inside data.
  delete data.media_pool;

  return {
    ...(item.id ? { id: item.id } : {}),
    answer: item.answer || "",
    media: pool[0] || "",
    media_pool: pool,
    aliases: item.aliases || [],
    data
  };
}

function buildSignature(group, tags, items, deletedItemIds) {
  return JSON.stringify({
    group: {
      name: group?.name || "",
      media: group?.media || "",
      tags: tags || [],
      answerPolicy: answerPolicyFromGroup(group)
    },
    items: items.map(item => ({
      id: item.id || item.tempId,
      answer: item.answer || "",
      media: item.media || "",
      media_pool: item.media_pool || [],
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

const imageGroupHeaderTagChipStyle = {
  background: "#322814",
  border: "1px solid #6f5520",
  color: "#f5d27b",
  fontSize: "12px",
  fontWeight: 700
};

const MediaGroupItemRow = memo(function MediaGroupItemRow({
  aliasInputValue,
  item,
  onAddAlias,
  onImportMediaUrl,
  onRegisterAliasInput,
  onRemoveAlias,
  onRemoveItem,
  onToggleFavorite,
  onToggleSuspended,
  onUpdateAliasInput,
  onUpdateItem,
  onUploadFile,
  selected
}) {
  const handleAnswerChange = useCallback((event) => {
    onUpdateItem(item.tempId, {
      answer: event.target.value
    });
  }, [item.tempId, onUpdateItem]);

  const handlePoolChange = useCallback((pool) => {
    onUpdateItem(item.tempId, {
      media_pool: pool,
      media: pool[0] || ""
    });
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
      data-image-group-item-row
      data-image-group-item-id={item.id || item.tempId}
      style={{
        border: selected ? "1px solid #f0c36a" : "1px solid #2a2a2a",
        borderRadius: "10px",
        background: selected ? "#241f15" : "#171717",
        boxSizing: "border-box",
        height: `${MEDIA_GROUP_ROW_HEIGHT}px`,
        padding: "12px",
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        gap: "12px",
        alignItems: "start"
      }}
    >
      <div style={{ alignSelf: "center", display: "grid", justifyItems: "start" }}>
        <MediaPoolField
          compact
          size={180}
          pool={item.media_pool || (item.media ? [item.media] : [])}
          onPoolChange={handlePoolChange}
          onUploadFile={onUploadFile}
          onImportMediaUrl={onImportMediaUrl}
          accept="image/*,audio/*,video/*"
        />
      </div>

      <div
        style={{
          alignContent: "start",
          display: "grid",
          gap: "6px",
          minWidth: 0,
          overflow: "hidden"
        }}
      >
        <label style={{ display: "grid", gap: "4px" }}>
          <span style={labelStyle}>Réponse</span>
          <input
            value={item.answer || ""}
            onChange={handleAnswerChange}
            style={inputStyle}
          />
        </label>

        <div style={{ minWidth: 0 }}>
          <div style={{ ...labelStyle, marginBottom: "4px" }}>
            Alias
          </div>
          <div
            style={{
              marginBottom: (item.aliases || []).length > 0 ? "6px" : 0,
              minWidth: 0,
              position: "relative"
            }}
          >
            <div
              className="map-editor-chip-strip"
              onWheel={handleHorizontalChipWheel}
              style={{
                display: "flex",
                flexWrap: "nowrap",
                fontSize: "12px",
                gap: "5px",
                minHeight: "24px",
                minWidth: 0,
                overflowX: "auto",
                overflowY: "hidden",
                paddingRight: "22px",
                scrollbarWidth: "none"
              }}
            >
              {(item.aliases || []).map((alias, index) => (
                <div
                  key={`${alias}-${index}`}
                  data-chip-wheel-target
                  style={{
                    alignItems: "center",
                    background: "#333",
                    borderRadius: "6px",
                    display: "inline-flex",
                    flex: "0 0 auto",
                    gap: "5px",
                    maxWidth: "140px",
                    padding: "4px 6px"
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
                      flexShrink: 0,
                      lineHeight: 1,
                      padding: 0
                    }}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
            {(item.aliases || []).length > 0 && (
              <div
                aria-hidden="true"
                style={{
                  background: `linear-gradient(90deg, rgba(23, 23, 23, 0), ${
                    selected ? "#241f15" : "#171717"
                  } 82%)`,
                  bottom: 0,
                  pointerEvents: "none",
                  position: "absolute",
                  right: 0,
                  top: 0,
                  width: "22px"
                }}
              />
            )}
          </div>
          <input
            ref={handleAliasRef}
            value={aliasInputValue || ""}
            onChange={handleAliasInputChange}
            onKeyDown={handleAliasKeyDown}
            onBlur={handleAliasBlur}
            placeholder="Alias"
            style={inputStyle}
          />
        </div>
      </div>

      <div
        style={{
          alignItems: "center",
          alignSelf: "center",
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
          style={{
            ...dangerButtonStyle,
            padding: "8px 10px"
          }}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
});

export default function MediaGroupEditor({
  group,
  availableTags = [],
  ensurePersistedGroup,
  onSave,
  onUploadFile,
  onImportMediaUrl,
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
  const [uploading, setUploading] = useState(false);
  const [importUrlInput, setImportUrlInput] = useState("");
  const [importingUrl, setImportingUrl] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [initialSignature, setInitialSignature] = useState("");
  const [aliasInputByTempId, setAliasInputByTempId] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [itemsScrollTop, setItemsScrollTop] = useState(0);
  const [itemsViewportHeight, setItemsViewportHeight] = useState(
    MEDIA_GROUP_DEFAULT_VIEWPORT_HEIGHT
  );
  const fileInputRef = useRef(null);
  const aliasInputRefs = useRef({});
  const itemsScrollRef = useRef(null);
  const pendingScrollItemTempIdRef = useRef(null);
  const currentGroupRef = useRef(group);
  const saveImageItemsRef = useRef(null);
  const savedStateRef = useRef(null);
  const groupId = group?.id;
  const selectedItemId = selectedItem?.id ?? null;

  const currentSignature = useMemo(() => (
    buildSignature(editableGroup, sharedTags, items, deletedItemIds)
  ), [deletedItemIds, editableGroup, items, sharedTags]);
  const hasUnsavedChanges = currentSignature !== initialSignature;
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;

    return items.filter((item) => matchesSearch(item, searchQuery));
  }, [items, searchQuery]);
  const selectedItemIndex = useMemo(() => {
    if (!selectedItemId) return -1;

    return filteredItems.findIndex((item) => item.id === selectedItemId);
  }, [filteredItems, selectedItemId]);
  const visibleItemWindow = useMemo(() => {
    if (filteredItems.length === 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        items: [],
        topSpacerHeight: 0,
        bottomSpacerHeight: 0
      };
    }

    const viewportHeight = Math.max(
      itemsViewportHeight || 0,
      MEDIA_GROUP_DEFAULT_VIEWPORT_HEIGHT
    );
    const startIndex = Math.max(
      0,
      Math.floor(itemsScrollTop / MEDIA_GROUP_ROW_SLOT_HEIGHT) -
        MEDIA_GROUP_OVERSCAN_ROWS
    );
    const visibleCount = Math.ceil(viewportHeight / MEDIA_GROUP_ROW_SLOT_HEIGHT) +
      (MEDIA_GROUP_OVERSCAN_ROWS * 2) +
      1;
    const endIndex = Math.min(filteredItems.length, startIndex + visibleCount);

    return {
      startIndex,
      endIndex,
      items: filteredItems.slice(startIndex, endIndex),
      topSpacerHeight: startIndex * MEDIA_GROUP_ROW_SLOT_HEIGHT,
      bottomSpacerHeight: Math.max(0, (filteredItems.length - endIndex) * MEDIA_GROUP_ROW_SLOT_HEIGHT)
    };
  }, [filteredItems, itemsScrollTop, itemsViewportHeight]);

  useEffect(() => {
    currentGroupRef.current = group;
  });

  useEffect(() => {
    if (!groupId) {
      // A pending group has nothing to fetch, and it starts clean so the unsaved
      // marker only appears once the user actually names it or adds an item.
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
    const nextGroup = {
      ...selectedGroup,
      media: selectedGroup.media || ""
    };

    setEditableGroup(nextGroup);
    setSharedTags(selectedGroup.tags || []);
    setTagInput("");
    setImportUrlInput("");
    setImportingUrl(false);
    setIsDraggingImage(false);
    setDeletedItemIds([]);
    setAliasInputByTempId({});
    aliasInputRefs.current = {};
    pendingScrollItemTempIdRef.current = null;
    setItemsScrollTop(0);
    if (itemsScrollRef.current) {
      itemsScrollRef.current.scrollTop = 0;
    }
    setLoading(true);
    setSaveStatus("");

    getMediaGroupItems(groupId)
      .then((data) => {
        if (cancelled) return;

        const normalizedItems = (data || []).map(item => normalizeItem({
          ...item,
          group: nextGroup
        }));

        setItems(normalizedItems);
        setInitialSignature(buildSignature(
          nextGroup,
          selectedGroup.tags || [],
          normalizedItems,
          []
        ));
        savedStateRef.current = {
          group: nextGroup,
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

  useEffect(() => {
    const scrollElement = itemsScrollRef.current;
    if (!scrollElement) return undefined;

    const updateViewportHeight = () => {
      setItemsViewportHeight(
        scrollElement.clientHeight || MEDIA_GROUP_DEFAULT_VIEWPORT_HEIGHT
      );
    };

    updateViewportHeight();

    if (!window.ResizeObserver) {
      window.addEventListener("resize", updateViewportHeight);
      return () => {
        window.removeEventListener("resize", updateViewportHeight);
      };
    }

    const observer = new window.ResizeObserver(updateViewportHeight);
    observer.observe(scrollElement);

    return () => {
      observer.disconnect();
    };
  }, []);

  const updateGroupField = useCallback((field, value) => {
    setEditableGroup(prev => ({
      ...(prev || {}),
      [field]: value
    }));
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

  const handleItemsScroll = useCallback((event) => {
    setItemsScrollTop(event.currentTarget.scrollTop);
  }, []);

  const scrollToItemIndex = useCallback((itemIndex) => {
    const scrollElement = itemsScrollRef.current;
    if (!scrollElement || itemIndex < 0) return;

    const viewportHeight = scrollElement.clientHeight ||
      itemsViewportHeight ||
      MEDIA_GROUP_DEFAULT_VIEWPORT_HEIGHT;
    const maxScrollTop = Math.max(
      0,
      (filteredItems.length * MEDIA_GROUP_ROW_SLOT_HEIGHT) - viewportHeight
    );
    const nextScrollTop = Math.min(
      maxScrollTop,
      Math.max(0, itemIndex * MEDIA_GROUP_ROW_SLOT_HEIGHT)
    );

    scrollElement.scrollTop = nextScrollTop;
    setItemsScrollTop(nextScrollTop);
  }, [filteredItems.length, itemsViewportHeight]);

  useEffect(() => {
    if (loading || selectedItemIndex < 0) return;

    scrollToItemIndex(selectedItemIndex);
  }, [loading, scrollToItemIndex, selectedItemId, selectedItemIndex]);

  useEffect(() => {
    if (loading || !pendingScrollItemTempIdRef.current) return;

    const targetIndex = filteredItems.findIndex(
      item => item.tempId === pendingScrollItemTempIdRef.current
    );

    if (targetIndex < 0) return;

    pendingScrollItemTempIdRef.current = null;
    scrollToItemIndex(targetIndex);
  }, [filteredItems, loading, scrollToItemIndex]);

  const updateItem = useCallback((tempId, patch) => {
    setItems(prev =>
      prev.map(item =>
        item.tempId === tempId
          ? { ...item, ...patch }
          : item
      )
    );
  }, []);

  const updateAliasInput = useCallback((tempId, value) => {
    setAliasInputByTempId(prev => ({
      ...prev,
      [tempId]: value
    }));
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
      updateItem(item.tempId, {
        aliases: [...currentAliases, value]
      });
    }

    setAliasInputByTempId(prev => ({
      ...prev,
      [item.tempId]: ""
    }));

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
      answer: "",
      media: "",
      data: {
        aliases: []
      },
      group: editableGroup,
      group_id: editableGroup?.id
    });

    pendingScrollItemTempIdRef.current = nextItem.tempId;
    setSearchQuery("");
    setItems(prev => [
      ...prev,
      nextItem
    ]);
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

  const addTag = useCallback((selectedTag) => {
    const value = String(selectedTag ?? tagInput).trim();

    if (!value || sharedTags.includes(value)) return;

    setSharedTags(prev => [...prev, value]);
    setTagInput("");
  }, [sharedTags, tagInput]);

  const removeTag = useCallback((tag) => {
    setSharedTags(prev => prev.filter(item => item !== tag));
  }, []);

  const handleUploadFiles = useCallback(async (fileList) => {
    const files = imageFilesFromFileList(fileList);

    if (files.length === 0 || !onUploadFile) return;

    setUploading(true);
    setSaveStatus("");

    try {
      const uploadedItems = [];

      for (const file of files) {
        const result = await onUploadFile(file);
        const media = result?.media || result?.url || "";

        uploadedItems.push(normalizeItem({
          answer: answerFromFilename(file.name),
          media,
          data: {
            aliases: []
          },
          group: editableGroup,
          group_id: editableGroup?.id
        }));
      }

      pendingScrollItemTempIdRef.current = uploadedItems[0]?.tempId || null;
      setSearchQuery("");
      setItems(prev => [...prev, ...uploadedItems]);
    } catch (error) {
      console.error(error);
      setSaveStatus("Import impossible");
    } finally {
      setUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [editableGroup, onUploadFile]);

  const handleImportUrl = useCallback(async () => {
    const url = importUrlInput.trim();

    if (!url || !onImportMediaUrl) return;

    setImportingUrl(true);
    setSaveStatus("");

    try {
      const result = await onImportMediaUrl(url);
      const media = result?.media || result?.url || "";
      const nextItem = normalizeItem({
        answer: answerFromFilename(filenameFromUrl(url)),
        media,
        data: {
          aliases: []
        },
        group: editableGroup,
        group_id: editableGroup?.id
      });

      pendingScrollItemTempIdRef.current = nextItem.tempId;
      setSearchQuery("");
      setItems(prev => [...prev, nextItem]);
      setImportUrlInput("");
    } catch (error) {
      console.error(error);
      setSaveStatus("Import URL impossible");
    } finally {
      setImportingUrl(false);
    }
  }, [editableGroup, importUrlInput, onImportMediaUrl]);

  const handleImportUrlKeyDown = useCallback((event) => {
    if (event.key !== "Enter") return;

    event.preventDefault();
    handleImportUrl();
  }, [handleImportUrl]);

  const handlePasteImages = useCallback((event) => {
    const files = imageFilesFromFileList(event.clipboardData?.files);

    if (files.length === 0) return;

    event.preventDefault();
    handleUploadFiles(files);
  }, [handleUploadFiles]);

  const handleDragEnter = useCallback((event) => {
    if (!transferHasImageFiles(event.dataTransfer)) return;

    event.preventDefault();
    setIsDraggingImage(true);
  }, []);

  const handleDragOver = useCallback((event) => {
    if (!transferHasImageFiles(event.dataTransfer)) return;

    event.preventDefault();
    setIsDraggingImage(true);
  }, []);

  const handleDragLeave = useCallback((event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsDraggingImage(false);
    }
  }, []);

  const handleDropImages = useCallback((event) => {
    const files = imageFilesFromFileList(event.dataTransfer?.files);

    if (files.length === 0) return;

    event.preventDefault();
    setIsDraggingImage(false);
    handleUploadFiles(files);
  }, [handleUploadFiles]);

  async function saveImageItems({ autosave = false } = {}) {
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
      const saveResult = await patchMediaGroupItems(targetGroupId, {
        group: {
          name: nameForSave,
          media: editableGroup.media || "",
          tags: sharedTags || [],
          answer_policy: answerPolicyFromGroup(editableGroup)
        },
        items: items.map(serializeItem),
        deleted_item_ids: deletedItemIds
      });
      const savedGroup = saveResult.group || editableGroup;
      const savedItems = (saveResult.items || []).map(item => normalizeItem({
        ...item,
        group: savedGroup
      }));

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

      return {
        saved: true,
        group: savedGroup,
        items: savedItems
      };
    } catch (error) {
      console.error(error);
      setSaveStatus("Enregistrement impossible");

      if (!autosave) {
        alert(error.message || "Impossible de sauvegarder le groupe d'images.");
      }

      throw error;
    }
  }

  useEffect(() => {
    saveImageItemsRef.current = saveImageItems;
  });

  useEffect(() => {
    if (!registerPendingSaveHandler) {
      return undefined;
    }

    const saveIfDirty = () => saveImageItemsRef.current?.({ autosave: true }) || {
      saved: false
    };

    return registerPendingSaveHandler(saveIfDirty);
  }, [registerPendingSaveHandler]);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropImages}
      onPaste={handlePasteImages}
      style={{
        background: "#1e1e1e",
        border: isDraggingImage
          ? "1px solid rgba(126, 226, 168, 0.75)"
          : "1px solid transparent",
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
              Groupe média
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
              onClick={() => saveImageItems()}
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
          chipStyle={imageGroupHeaderTagChipStyle}
          inputOverrideStyle={compactHeaderInputStyle}
          labelOverrideStyle={{ fontSize: "12px" }}
        />

        <AnswerPolicyControl
          policy={answerPolicyFromGroup(editableGroup)}
          onChange={updateAnswerPolicy}
        />

        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: "8px"
          }}
        >
          <button
            type="button"
            onClick={addEmptyItem}
            style={{ ...buttonStyle, ...compactHeaderButtonStyle }}
          >
            Ajouter une ligne
          </button>

          <div style={{ flex: "1 1 160px", maxWidth: "240px", position: "relative" }}>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Recherche..."
              aria-label="Rechercher dans le groupe"
              style={{
                ...compactHeaderInputStyle,
                ...(searchQuery ? { paddingRight: "28px" } : null),
                width: "100%"
              }}
            />
            {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Effacer la recherche"
                  style={{
                  background: "transparent",
                  border: "none",
                  borderRadius: "50%",
                  color: "#777",
                  cursor: "pointer",
                  fontSize: "16px",
                  height: "20px",
                  lineHeight: 1,
                  position: "absolute",
                  right: "6px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "20px"
                }}
              >
                ×
              </button>
            )}
          </div>

          {searchQuery.trim() && (
            <span style={{ color: "#888", fontSize: "12px" }}>
              {filteredItems.length} / {items.length}
            </span>
          )}
          {saveStatus && (
            <span style={{ color: "#888", fontSize: "13px" }}>
              {saveStatus}
            </span>
          )}
        </div>
      </div>

      <div
        ref={itemsScrollRef}
        data-testid="image-group-items-scroll"
        className="app-scrollbar"
        onScroll={handleItemsScroll}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "14px",
          display: "block",
          scrollbarGutter: "stable"
        }}
      >
        {loading && (
          <div style={{ color: "#888", padding: "18px" }}>
            Chargement...
          </div>
        )}

        {!loading && searchQuery.trim() && filteredItems.length === 0 && (
          <div
            style={{
              alignItems: "center",
              border: "1px dashed #333",
              borderRadius: "10px",
              color: "#777",
              display: "flex",
              justifyContent: "center",
              marginBottom: `${MEDIA_GROUP_ROW_GAP}px`,
              minHeight: "80px",
              padding: "18px",
              textAlign: "center"
            }}
          >
            Aucun résultat pour « {searchQuery.trim()} »
          </div>
        )}

        {!loading && filteredItems.length > 0 && (
          <div>
            {visibleItemWindow.topSpacerHeight > 0 && (
              <div
                aria-hidden="true"
                style={{ height: `${visibleItemWindow.topSpacerHeight}px` }}
              />
            )}

            {visibleItemWindow.items.map((item, index) => {
              const itemIndex = visibleItemWindow.startIndex + index;
              const hasFollowingRows = itemIndex < filteredItems.length - 1;

              return (
                <div
                  key={item.tempId}
                  style={{
                    height: `${MEDIA_GROUP_ROW_HEIGHT}px`,
                    marginBottom: hasFollowingRows
                      ? `${MEDIA_GROUP_ROW_GAP}px`
                      : 0
                  }}
                >
                  <MediaGroupItemRow
                    aliasInputValue={aliasInputByTempId[item.tempId] || ""}
                    item={item}
                    onAddAlias={addAlias}
                    onImportMediaUrl={onImportMediaUrl}
                    onRegisterAliasInput={registerAliasInput}
                    onRemoveAlias={removeAlias}
                    onRemoveItem={removeItem}
                    onToggleFavorite={toggleFavorite}
                    onToggleSuspended={toggleSuspended}
                    onUpdateAliasInput={updateAliasInput}
                    onUpdateItem={updateItem}
                    onUploadFile={onUploadFile}
                    selected={Boolean(selectedItemId && selectedItemId === item.id)}
                  />
                </div>
              );
            })}

            {visibleItemWindow.bottomSpacerHeight > 0 && (
              <div
                aria-hidden="true"
                style={{ height: `${visibleItemWindow.bottomSpacerHeight}px` }}
              />
            )}
          </div>
        )}

        {!loading && (
          <div
            data-image-group-add-cell
            style={{
              alignItems: "center",
              background: "#171717",
              border: "1px dashed #3a3a3a",
              borderRadius: "10px",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              justifyContent: "center",
              marginTop: items.length > 0 ? `${MEDIA_GROUP_ROW_GAP}px` : 0,
              minHeight: `${MEDIA_GROUP_ROW_HEIGHT}px`,
              padding: "20px"
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,audio/*,video/*"
              multiple
              onChange={(event) => handleUploadFiles(event.target.files)}
              style={{ display: "none" }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!onUploadFile || uploading || importingUrl}
              style={{
                alignItems: "center",
                background: "transparent",
                border: "none",
                color: "#999",
                cursor: !onUploadFile || uploading || importingUrl ? "default" : "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                padding: 0,
                textAlign: "center"
              }}
            >
              <span aria-hidden="true" style={{ fontSize: "26px" }}>＋</span>
              <span style={{ fontSize: "13px", maxWidth: "320px" }}>
                {uploading
                  ? "Import..."
                  : "Glissez une image, collez (Ctrl+V) ou cliquez pour choisir un fichier"}
              </span>
            </button>

            <div
              style={{
                alignItems: "center",
                display: "flex",
                gap: "8px",
                maxWidth: "360px",
                width: "100%"
              }}
            >
              <input
                value={importUrlInput}
                onChange={(event) => setImportUrlInput(event.target.value)}
                onKeyDown={handleImportUrlKeyDown}
                placeholder="URL image"
                style={{ ...compactHeaderInputStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={handleImportUrl}
                disabled={
                  !onImportMediaUrl ||
                  !importUrlInput.trim() ||
                  uploading ||
                  importingUrl
                }
                style={{
                  ...buttonStyle,
                  ...compactHeaderButtonStyle,
                  opacity: !onImportMediaUrl ||
                    !importUrlInput.trim() ||
                    uploading ||
                    importingUrl
                    ? 0.6
                    : 1
                }}
              >
                {importingUrl ? "Import..." : "Importer l'URL"}
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
