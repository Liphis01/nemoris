// Browse-first tag picker.
//
// The old flat autocomplete assumed you already knew your own vocabulary: to
// pick a tag you had to recall it existed. This shows the categories instead —
// focus with an empty box and the roots are right there, click to go deeper.
// Typing switches to search, with each hit showing where it lives so you can
// tell "Linux (Sciences › Technologie › Informatique)" from a stray duplicate.
//
// Creating a tag while drilled into a branch files it there, so the hierarchy
// grows as a side effect of ordinary tagging instead of being a separate chore.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { labelForTag, primeTags, useTagHierarchy } from "./tagLabels";
import { buildTagPickerModel } from "./tagPickerModel";
import { applyTagActions } from "../api/tags";


function newTagId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, token => {
    const value = Math.floor(Math.random() * 16);
    return (token === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}


const panelStyle = {
  background: "#161616",
  border: "1px solid #333",
  borderRadius: "8px",
  boxShadow: "0 14px 32px rgba(0, 0, 0, 0.35)",
  boxSizing: "border-box",
  left: 0,
  maxHeight: "260px",
  overflowY: "auto",
  position: "absolute",
  right: 0,
  top: "calc(100% + 4px)",
  zIndex: 30
};

const rowStyle = {
  alignItems: "center",
  background: "transparent",
  border: "none",
  color: "#eee",
  cursor: "pointer",
  display: "flex",
  font: "inherit",
  gap: "8px",
  justifyContent: "space-between",
  padding: "8px 10px",
  textAlign: "left",
  width: "100%"
};

function keepRowVisible(list, row) {
  if (!list || !row) return;

  const padding = 4;
  const rowTop = row.offsetTop;
  const rowBottom = rowTop + row.offsetHeight;
  const visibleTop = list.scrollTop;
  const visibleBottom = visibleTop + list.clientHeight;

  if (rowTop < visibleTop + padding) {
    list.scrollTop = Math.max(0, rowTop - padding);
    return;
  }

  if (rowBottom > visibleBottom - padding) {
    list.scrollTop = Math.max(0, rowBottom - list.clientHeight + padding);
  }
}


export default function TagPicker({
  tags = [],
  value,
  onChange,
  onAdd,
  onRemove,
  placeholder = "Ajouter un tag",
  extraKeys = [],
  inputStyle,
  chipStyle,
  compact = false,
  allowCreate = true,
  showChips = true
}) {
  const { parents, labels, usage, revision, nodes, suggestions } = useTagHierarchy();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState(null);
  const [highlight, setHighlight] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const blurTimer = useRef(null);
  const listboxRef = useRef(null);
  const rowRefs = useRef(new Map());

  const query = String(value || "");

  const model = useMemo(
    () => buildTagPickerModel({
      query,
      branch,
      appliedTags: tags,
      parents,
      labels,
      nodes,
      usage,
      suggestions,
      extraKeys,
      allowCreate
    }),
    [query, branch, tags, parents, labels, nodes, usage, suggestions, extraKeys, allowCreate]
  );
  const rows = model.rows;

  useEffect(() => {
    setHighlight(0);
  }, [query, branch]);

  useEffect(() => {
    setHighlight((current) => Math.min(current, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useLayoutEffect(() => {
    if (!open) return;
    const row = rows[highlight];
    if (!row) return;

    keepRowVisible(listboxRef.current, rowRefs.current.get(row.id));
  }, [highlight, open, rows]);

  useEffect(() => () => window.clearTimeout(blurTimer.current), []);

  function setRowRef(rowId) {
    return (element) => {
      if (element) {
        rowRefs.current.set(rowId, element);
      } else {
        rowRefs.current.delete(rowId);
      }
    };
  }

  function close() {
    setOpen(false);
    setBranch(null);
  }

  function applyTag(key) {
    onAdd?.(key);
    onChange?.("");
    setHighlight(0);
  }

  // Creating inside a branch is what makes the tree build itself: the user has
  // just demonstrated where the tag belongs by browsing there.
  async function createTag(text, { parentId = branch, suggestionKey = null } = {}) {
    const label = String(text || "").trim();
    if (!label) return;
    const tagId = newTagId();

    setSaving(true);
    setError("");

    try {
      const saved = await applyTagActions(revision, [{
        type: "create",
        tag_id: tagId,
        label,
        locale: "fr",
        parent_ids: parentId ? [parentId] : [],
        suggestion_key: suggestionKey
      }]);
      primeTags(saved);
      applyTag(saved.created_ids?.[0] || tagId);
    } catch (error) {
      console.error(error);
      setError("Création impossible. Réessaie après actualisation.");
    } finally {
      setSaving(false);
    }
  }

  function executeRow(row) {
    if (!row) return;
    if (row.type === "back") {
      goUp();
      return;
    }
    if (row.type === "suggestion") {
      createTag(row.label, {
        parentId: row.parentId,
        suggestionKey: row.suggestionKey
      });
      return;
    }
    if (row.type === "create") {
      createTag(row.label, { parentId: row.parentId });
      return;
    }
    if (row.tagId) applyTag(row.tagId);
  }

  function drill(key) {
    setBranch(key);
    onChange?.("");
    setHighlight(0);
  }

  function goUp() {
    if (!branch) return;
    setBranch((ancestors(branch)[0]) || null);
  }

  function ancestors(key) {
    return parents[key] || [];
  }

  function handleKeyDown(event) {
    if (!open) {
      if (event.key === "ArrowDown") setOpen(true);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, Math.max(rows.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "ArrowRight") {
      const row = rows[highlight];
      if (row?.openable) {
        event.preventDefault();
        drill(row.tagId);
      }
      return;
    }

    if (event.key === "ArrowLeft" || (event.key === "Backspace" && !query)) {
      if (branch) {
        event.preventDefault();
        goUp();
      }
      return;
    }

    if (event.key === "Tab") {
      const row = rows[highlight];
      if (row?.type === "suggestion") {
        event.preventDefault();
        executeRow(row);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const createRow = rows.find(row => row.type === "create");
        if (createRow) executeRow(createRow);
        return;
      }
      executeRow(rows[highlight]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  return (
    <div>
      {showChips && tags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: compact ? "6px" : "8px",
            marginBottom: compact ? "7px" : "10px"
          }}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              style={{
                alignItems: "center",
                background: "#212121",
                borderRadius: "999px",
                color: "#ccc",
                display: "inline-flex",
                gap: "8px",
                padding: compact ? "4px 8px" : "6px 9px",
                ...chipStyle
              }}
            >
              #{labelForTag(tag, labels)}
              <button
                type="button"
                aria-label={`Retirer le tag ${labelForTag(tag, labels)}`}
                onClick={() => onRemove?.(tag)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#888",
                  cursor: "pointer",
                  padding: 0
                }}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ position: "relative" }}>
        <input
          value={query}
          onChange={(event) => {
            setOpen(true);
            onChange?.(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Let a click on a row land before the panel unmounts.
            blurTimer.current = window.setTimeout(close, 120);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          // An input that owns a listbox popup is a combobox; saying so keeps
          // it reachable the same way the native datalist input was.
          role="combobox"
          aria-autocomplete="list"
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          disabled={saving}
          style={{ boxSizing: "border-box", width: "100%", ...inputStyle }}
        />

        {error && (
          <div role="alert" style={{ color: "#f2b8b8", fontSize: "11px", marginTop: "4px" }}>
            {error}
          </div>
        )}

        {open && (
          <div ref={listboxRef} id={listboxId} role="listbox" className="app-scrollbar" style={panelStyle}>
            {rows.length === 0 && (
              <div style={{ color: "#777", fontSize: "13px", padding: "10px" }}>
                {model.searching ? "Aucun tag." : "Aucune sous-catégorie."}
              </div>
            )}

            {model.groups.map(group => (
              <div key={group.id}>
                {group.label && (
                  <div style={{ color: "#777", fontSize: "11px", fontWeight: 800, padding: "8px 10px 4px", textTransform: "uppercase" }}>
                    {group.label}
                  </div>
                )}
                {group.rows.map(row => {
                  const index = rows.indexOf(row);
                  const selected = index === highlight;
                  const color = row.type === "suggestion"
                    ? "#b9a9e7"
                    : row.type === "create"
                      ? "#d2c2ff"
                      : row.type === "back"
                        ? "#888"
                        : "#eee";

                  return (
                    <div
                      key={row.id}
                      ref={setRowRef(row.id)}
                      data-tag-picker-row-index={index}
                      style={{
                        background: selected ? "#242424" : "transparent",
                        display: "flex"
                      }}
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          executeRow(row);
                        }}
                        onMouseEnter={() => setHighlight(index)}
                        style={{
                          ...rowStyle,
                          background: "transparent",
                          color,
                          borderTop: row.type === "create" ? "1px solid #262626" : "none"
                        }}
                      >
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block" }}>
                            {row.type === "back" && `◂ ${row.label}`}
                            {row.type === "suggestion" && `＋ ${row.label}`}
                            {row.type === "create" && `＋ Créer « ${row.label} »`}
                            {(row.type === "existing" || row.type === "branch") && `#${row.label}`}
                          </span>
                          {row.breadcrumb && (
                            <span style={{ color: "#777", fontSize: "11px" }}>
                              {row.breadcrumb}
                            </span>
                          )}
                          {row.type === "branch" && (
                            <span style={{ color: "#777", display: "block", fontSize: "11px" }}>
                              Entrée ajouter · → ouvrir
                            </span>
                          )}
                          {row.type === "suggestion" && (
                            <span style={{ color: "#777", display: "block", fontSize: "11px" }}>
                              Suggestion · sera créée{row.pathLabel ? ` sous ${row.pathLabel}` : " dans ta base"}
                            </span>
                          )}
                          {row.type === "create" && (
                            <span style={{ color: "#777", display: "block", fontSize: "11px" }}>
                              Ctrl+Entrée{row.pathLabel ? ` · dans ${row.pathLabel}` : ""}
                            </span>
                          )}
                        </span>
                        {row.count > 0 && (
                          <span style={{ color: "#666", fontSize: "11px" }}>
                            {row.count}
                          </span>
                        )}
                      </button>

                      {row.openable && (
                        <button
                          type="button"
                          aria-label={`Ouvrir ${row.label}`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            drill(row.tagId);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            borderLeft: "1px solid #262626",
                            color: "#888",
                            cursor: "pointer",
                            font: "inherit",
                            padding: "0 12px"
                          }}
                        >
                          ▸
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
