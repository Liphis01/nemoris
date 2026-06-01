import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getImageGroupItems, patchImageGroupItems } from "../../../api/imageGroups";
import { resolveMediaUrl } from "../../../shared/media";
import FavoriteToggleButton from "./FavoriteToggleButton";
import {
  buttonStyle,
  dangerButtonStyle,
  disabledSaveButtonStyle,
  inputStyle,
  labelStyle,
  pendingSaveButtonStyle,
  pendingSaveDotStyle,
  primaryButtonStyle
} from "./QuestionEditorStyles";
import {
  QuestionEditorField,
  TagEditor
} from "./QuestionEditorPrimitives";

let tempItemCounter = 0;
const IMAGE_GROUP_ROW_HEIGHT = 292;
const IMAGE_GROUP_ROW_GAP = 10;
const IMAGE_GROUP_ROW_SLOT_HEIGHT = IMAGE_GROUP_ROW_HEIGHT + IMAGE_GROUP_ROW_GAP;
const IMAGE_GROUP_OVERSCAN_ROWS = 8;
const IMAGE_GROUP_DEFAULT_VIEWPORT_HEIGHT = 720;

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

function normalizeItem(item) {
  const data = item?.data || {};

  return {
    tempId: item?.id ? `image-${item.id}` : item?.tempId || nextTempId(),
    id: item?.id || null,
    type_q: "image",
    question: item?.question || "",
    answer: item?.answer || item?.label || "",
    media: item?.media || "",
    tags: item?.tags || [],
    group_id: item?.group_id || null,
    data,
    aliases: item?.aliases || data.aliases || [],
    progress: item?.progress || null,
    group: item?.group || null
  };
}

function serializeItem(item) {
  const data = {
    ...(item.data || {})
  };
  data.aliases = item.aliases || [];

  return {
    ...(item.id ? { id: item.id } : {}),
    answer: item.answer || "",
    media: item.media || "",
    aliases: item.aliases || [],
    data
  };
}

function buildSignature(group, tags, items, deletedItemIds) {
  return JSON.stringify({
    group: {
      name: group?.name || "",
      media: group?.media || "",
      tags: tags || []
    },
    items: items.map(item => ({
      id: item.id || item.tempId,
      answer: item.answer || "",
      media: item.media || "",
      aliases: item.aliases || [],
      data: item.data || {}
    })),
    deletedItemIds: [...deletedItemIds].sort((a, b) => a - b)
  });
}

function imagePreviewStyle(hasImage) {
  return {
    width: "86px",
    height: "62px",
    borderRadius: "8px",
    border: "1px solid #2f2f2f",
    background: hasImage ? "#101010" : "#181818",
    objectFit: "contain"
  };
}

function imagePreviewButtonStyle(hasImage) {
  return {
    ...imagePreviewStyle(hasImage),
    alignItems: "center",
    cursor: hasImage ? "zoom-in" : "default",
    display: "flex",
    justifyContent: "center",
    overflow: "hidden",
    padding: 0
  };
}

const ImageGroupItemRow = memo(function ImageGroupItemRow({
  aliasInputValue,
  item,
  onAddAlias,
  onHorizontalChipWheel,
  onPreviewItem,
  onRegisterAliasInput,
  onRemoveAlias,
  onRemoveItem,
  onToggleFavorite,
  onUpdateAliasInput,
  onUpdateItem,
  selected
}) {
  const mediaSrc = useMemo(() => resolveMediaUrl(item.media), [item.media]);

  const handleAnswerChange = useCallback((event) => {
    onUpdateItem(item.tempId, {
      answer: event.target.value
    });
  }, [item.tempId, onUpdateItem]);

  const handleMediaChange = useCallback((event) => {
    onUpdateItem(item.tempId, {
      media: event.target.value
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
        border: selected
          ? "1px solid #f0c36a"
          : "1px solid #2a2a2a",
        borderRadius: "10px",
        background: selected ? "#241f15" : "#171717",
        boxSizing: "border-box",
        height: `${IMAGE_GROUP_ROW_HEIGHT}px`,
        padding: "12px",
        display: "grid",
        gridTemplateColumns: "96px minmax(0, 1fr) auto",
        gap: "12px",
        alignItems: "start"
      }}
    >
      {mediaSrc ? (
        <button
          type="button"
          onClick={() => onPreviewItem(item)}
          aria-label={`Agrandir ${item.answer || "l'image"}`}
          title="Agrandir l'image"
          style={imagePreviewButtonStyle(true)}
        >
          <img
            src={mediaSrc}
            alt={item.answer || "image"}
            loading="lazy"
            decoding="async"
            fetchpriority="low"
            style={{
              maxHeight: "100%",
              maxWidth: "100%",
              objectFit: "contain"
            }}
          />
        </button>
      ) : (
        <div
          style={{
            ...imagePreviewStyle(false),
            alignItems: "center",
            color: "#666",
            display: "flex",
            fontSize: "11px",
            justifyContent: "center"
          }}
        >
          image
        </div>
      )}

      <div
        style={{
          display: "grid",
          gap: "10px",
          minWidth: 0
        }}
      >
        <label style={{ display: "grid", gap: "6px" }}>
          <span style={labelStyle}>Réponse</span>
          <input
            value={item.answer || ""}
            onChange={handleAnswerChange}
            style={inputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: "6px" }}>
          <span style={labelStyle}>Image / URL</span>
          <input
            value={item.media || ""}
            onChange={handleMediaChange}
            style={inputStyle}
          />
        </label>

        <div style={{ minWidth: 0 }}>
          <div style={{ ...labelStyle, marginBottom: "6px" }}>
            Alias
          </div>
          <div
            style={{
              marginBottom: "8px",
              minWidth: 0,
              position: "relative"
            }}
          >
            <div
              className="map-editor-chip-strip"
              onWheel={onHorizontalChipWheel}
              style={{
                display: "flex",
                flexWrap: "nowrap",
                gap: "6px",
                minHeight: "27px",
                minWidth: 0,
                overflowX: "auto",
                overflowY: "hidden",
                paddingRight: "24px",
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
                    gap: "6px",
                    maxWidth: "150px",
                    padding: "5px 8px"
                  }}
                >
                  <span
                    title={alias}
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
                  background: "linear-gradient(90deg, rgba(23, 23, 23, 0), #171717 82%)",
                  bottom: 0,
                  pointerEvents: "none",
                  position: "absolute",
                  right: 0,
                  top: 0,
                  width: "28px"
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
          display: "flex",
          flexDirection: "column",
          gap: "8px"
        }}
      >
        <FavoriteToggleButton
          favorite={Boolean(item.data?.favorite)}
          onToggle={() => onToggleFavorite(item)}
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

export default function ImageGroupEditor({
  group,
  availableTags = [],
  onSave,
  onUploadFile,
  registerPendingSaveHandler,
  selectedItem,
  headerAction
}) {
  const [editableGroup, setEditableGroup] = useState(group);
  const [items, setItems] = useState([]);
  const [deletedItemIds, setDeletedItemIds] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [sharedTags, setSharedTags] = useState(group?.tags || []);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [initialSignature, setInitialSignature] = useState("");
  const [previewItem, setPreviewItem] = useState(null);
  const [aliasInputByTempId, setAliasInputByTempId] = useState({});
  const [itemsScrollTop, setItemsScrollTop] = useState(0);
  const [itemsViewportHeight, setItemsViewportHeight] = useState(
    IMAGE_GROUP_DEFAULT_VIEWPORT_HEIGHT
  );
  const fileInputRef = useRef(null);
  const aliasInputRefs = useRef({});
  const itemsScrollRef = useRef(null);
  const currentGroupRef = useRef(group);
  const saveImageItemsRef = useRef(null);
  const groupId = group?.id;
  const selectedItemId = selectedItem?.id ?? null;

  const currentSignature = useMemo(() => (
    buildSignature(editableGroup, sharedTags, items, deletedItemIds)
  ), [deletedItemIds, editableGroup, items, sharedTags]);
  const hasUnsavedChanges = currentSignature !== initialSignature;
  const selectedItemIndex = useMemo(() => {
    if (!selectedItemId) return -1;

    return items.findIndex((item) => item.id === selectedItemId);
  }, [items, selectedItemId]);
  const visibleItemWindow = useMemo(() => {
    if (items.length === 0) {
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
      IMAGE_GROUP_DEFAULT_VIEWPORT_HEIGHT
    );
    const startIndex = Math.max(
      0,
      Math.floor(itemsScrollTop / IMAGE_GROUP_ROW_SLOT_HEIGHT) -
        IMAGE_GROUP_OVERSCAN_ROWS
    );
    const visibleCount = Math.ceil(viewportHeight / IMAGE_GROUP_ROW_SLOT_HEIGHT) +
      (IMAGE_GROUP_OVERSCAN_ROWS * 2) +
      1;
    const endIndex = Math.min(items.length, startIndex + visibleCount);

    return {
      startIndex,
      endIndex,
      items: items.slice(startIndex, endIndex),
      topSpacerHeight: startIndex * IMAGE_GROUP_ROW_SLOT_HEIGHT,
      bottomSpacerHeight: Math.max(0, (items.length - endIndex) * IMAGE_GROUP_ROW_SLOT_HEIGHT)
    };
  }, [items, itemsScrollTop, itemsViewportHeight]);

  useEffect(() => {
    currentGroupRef.current = group;
  });

  useEffect(() => {
    if (!groupId) return undefined;

    let cancelled = false;
    const selectedGroup = currentGroupRef.current;
    const nextGroup = {
      ...selectedGroup,
      media: selectedGroup.media || ""
    };

    setEditableGroup(nextGroup);
    setSharedTags(selectedGroup.tags || []);
    setTagInput("");
    setDeletedItemIds([]);
    setAliasInputByTempId({});
    aliasInputRefs.current = {};
    setItemsScrollTop(0);
    if (itemsScrollRef.current) {
      itemsScrollRef.current.scrollTop = 0;
    }
    setLoading(true);
    setSaveStatus("");

    getImageGroupItems(groupId)
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
        scrollElement.clientHeight || IMAGE_GROUP_DEFAULT_VIEWPORT_HEIGHT
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

  useEffect(() => {
    if (loading || selectedItemIndex < 0) return;

    const nextScrollTop = Math.max(
      0,
      selectedItemIndex * IMAGE_GROUP_ROW_SLOT_HEIGHT
    );

    if (itemsScrollRef.current) {
      itemsScrollRef.current.scrollTop = nextScrollTop;
    }

    setItemsScrollTop(nextScrollTop);
  }, [loading, selectedItemId, selectedItemIndex]);

  const updateGroupField = useCallback((field, value) => {
    setEditableGroup(prev => ({
      ...(prev || {}),
      [field]: value
    }));
  }, []);

  const handleItemsScroll = useCallback((event) => {
    setItemsScrollTop(event.currentTarget.scrollTop);
  }, []);

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

  const handleHorizontalChipWheel = useCallback((event) => {
    const chip = event.target?.closest?.("[data-chip-wheel-target]");

    if (!chip || !event.currentTarget.contains(chip)) {
      return;
    }

    const strip = event.currentTarget;
    const maxScrollLeft = strip.scrollWidth - strip.clientWidth;

    if (maxScrollLeft <= 0) return;

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;

    if (!delta) return;

    event.preventDefault();
    strip.scrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, strip.scrollLeft + delta)
    );
  }, []);

  const addEmptyItem = useCallback(() => {
    setItems(prev => [
      ...prev,
      normalizeItem({
        answer: "",
        media: "",
        data: {
          aliases: []
        },
        group: editableGroup,
        group_id: editableGroup?.id
      })
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
    const files = Array.from(fileList || []).filter(file =>
      !file.type || file.type.startsWith("image/")
    );

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

  async function saveImageItems({ autosave = false } = {}) {
    if (!group?.id || !hasUnsavedChanges) {
      return { saved: false };
    }

    setSaveStatus("Enregistrement...");

    try {
      const saveResult = await patchImageGroupItems(group.id, {
        group: {
          name: editableGroup.name || "",
          media: editableGroup.media || "",
          tags: sharedTags || []
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
      setSaveStatus("Enregistré");

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

  useEffect(() => {
    if (!previewItem) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setPreviewItem(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewItem]);

  return (
    <div
      style={{
        background: "#1e1e1e",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden"
      }}
    >
      <div
        style={{
          borderBottom: "1px solid #2a2a2a",
          padding: "18px",
          display: "grid",
          gap: "14px"
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: "12px",
            justifyContent: "space-between"
          }}
        >
          <div>
            <div style={{ color: "#777", fontSize: "12px", marginBottom: "6px" }}>
              Groupe d'images
            </div>
            <div style={{ color: "#eee", fontSize: "20px", fontWeight: 800 }}>
              {editableGroup?.name || "Sans titre"}
            </div>
          </div>

          <div style={{ alignItems: "center", display: "flex", gap: "10px" }}>
            {headerAction}
            <button
              type="button"
              onClick={() => saveImageItems()}
              disabled={!hasUnsavedChanges}
              style={
                hasUnsavedChanges
                  ? pendingSaveButtonStyle
                  : disabledSaveButtonStyle
              }
            >
              {hasUnsavedChanges && <span aria-hidden="true" style={pendingSaveDotStyle} />}
              Enregistrer
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: "12px"
          }}
        >
          <QuestionEditorField label="Nom du groupe">
            <input
              value={editableGroup?.name || ""}
              onChange={(event) => updateGroupField("name", event.target.value)}
              style={inputStyle}
            />
          </QuestionEditorField>

          <QuestionEditorField label="Image de couverture / URL">
            <input
              value={editableGroup?.media || ""}
              onChange={(event) => updateGroupField("media", event.target.value)}
              style={inputStyle}
            />
          </QuestionEditorField>
        </div>

        <TagEditor
          tags={sharedTags}
          tagInput={tagInput}
          availableTags={availableTags}
          onTagInputChange={setTagInput}
          onAddTag={addTag}
          onRemoveTag={removeTag}
        />

        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: "10px"
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => handleUploadFiles(event.target.files)}
            style={{ display: "none" }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!onUploadFile || uploading}
            style={{
              ...primaryButtonStyle,
              opacity: !onUploadFile || uploading ? 0.6 : 1
            }}
          >
            {uploading ? "Import..." : "Importer des images"}
          </button>
          <button type="button" onClick={addEmptyItem} style={buttonStyle}>
            Ajouter une ligne
          </button>
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

        {!loading && items.length === 0 && (
          <div
            style={{
              alignItems: "center",
              border: "1px dashed #333",
              borderRadius: "10px",
              color: "#777",
              display: "flex",
              justifyContent: "center",
              minHeight: "180px"
            }}
          >
            Aucun item image
          </div>
        )}

        {!loading && items.length > 0 && (
          <div>
            {visibleItemWindow.topSpacerHeight > 0 && (
              <div
                aria-hidden="true"
                style={{ height: `${visibleItemWindow.topSpacerHeight}px` }}
              />
            )}

            {visibleItemWindow.items.map((item, index) => {
              const itemIndex = visibleItemWindow.startIndex + index;
              const hasFollowingRows = itemIndex < items.length - 1;

              return (
                <div
                  key={item.tempId}
                  style={{
                    height: `${IMAGE_GROUP_ROW_HEIGHT}px`,
                    marginBottom: hasFollowingRows
                      ? `${IMAGE_GROUP_ROW_GAP}px`
                      : 0
                  }}
                >
                  <ImageGroupItemRow
                    aliasInputValue={aliasInputByTempId[item.tempId] || ""}
                    item={item}
                    onAddAlias={addAlias}
                    onHorizontalChipWheel={handleHorizontalChipWheel}
                    onPreviewItem={setPreviewItem}
                    onRegisterAliasInput={registerAliasInput}
                    onRemoveAlias={removeAlias}
                    onRemoveItem={removeItem}
                    onToggleFavorite={toggleFavorite}
                    onUpdateAliasInput={updateAliasInput}
                    onUpdateItem={updateItem}
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
      </div>

      {previewItem && (
        <div
          role="presentation"
          onClick={() => setPreviewItem(null)}
          style={{
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.82)",
            display: "flex",
            inset: 0,
            justifyContent: "center",
            padding: "28px",
            position: "fixed",
            zIndex: 1000
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: "#111",
              border: "1px solid #333",
              borderRadius: "12px",
              boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
              boxSizing: "border-box",
              display: "grid",
              gridTemplateRows: "auto auto",
              maxHeight: "86vh",
              width: "min(82vw, 900px)",
              overflow: "hidden",
              padding: "14px",
              position: "relative"
            }}
          >
            <button
              type="button"
              onClick={() => setPreviewItem(null)}
              aria-label="Fermer l'image agrandie"
              style={{
                alignItems: "center",
                background: "#1f1f1f",
                border: "1px solid #3a3a3a",
                borderRadius: "999px",
                color: "#ddd",
                cursor: "pointer",
                display: "flex",
                fontSize: "20px",
                height: "34px",
                justifyContent: "center",
                lineHeight: 1,
                position: "absolute",
                right: "12px",
                top: "12px",
                width: "34px",
                zIndex: 1
              }}
            >
              ×
            </button>

            <img
              src={resolveMediaUrl(previewItem.media)}
              alt={previewItem.answer || "image"}
              style={{
                background: "#0d0d0d",
                borderRadius: "8px",
                display: "block",
                height: "min(62vh, 560px)",
                objectFit: "contain",
                width: "100%"
              }}
            />

            <div
              style={{
                color: "#eee",
                fontSize: "16px",
                fontWeight: 800,
                padding: "12px 44px 0",
                textAlign: "center"
              }}
            >
              {previewItem.answer || "Image"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
