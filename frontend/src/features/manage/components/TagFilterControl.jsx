import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { labelForTag, useTagHierarchy } from "../../../shared/tagLabels";
import { buildTagFilterModel } from "../utils/tagFilterModel";


const rootStyle = {
  position: "relative",
  width: "100%"
};

const triggerStyle = {
  alignItems: "center",
  background: "#111",
  border: "1px solid #2f2f2f",
  borderRadius: "10px",
  boxSizing: "border-box",
  color: "#eee",
  cursor: "pointer",
  display: "flex",
  font: "inherit",
  fontSize: "14px",
  gap: "8px",
  justifyContent: "space-between",
  minHeight: "42px",
  padding: "8px 10px",
  textAlign: "left",
  width: "100%"
};

const popoverStyle = {
  background: "#161616",
  border: "1px solid #333",
  borderRadius: "10px",
  boxShadow: "0 14px 32px rgba(0, 0, 0, 0.35)",
  boxSizing: "border-box",
  left: 0,
  padding: "8px",
  position: "absolute",
  right: 0,
  top: "calc(100% + 4px)",
  zIndex: 35
};

const searchStyle = {
  background: "#101010",
  border: "1px solid #303030",
  borderRadius: "8px",
  boxSizing: "border-box",
  color: "#eee",
  font: "inherit",
  fontSize: "13px",
  outline: "none",
  padding: "8px 9px",
  width: "100%"
};

const listStyle = {
  marginTop: "8px",
  maxHeight: "230px",
  overflowY: "auto"
};

const rowStyle = {
  alignItems: "center",
  background: "transparent",
  border: "none",
  color: "#eee",
  cursor: "pointer",
  display: "flex",
  flex: 1,
  font: "inherit",
  gap: "8px",
  justifyContent: "space-between",
  minWidth: 0,
  padding: "8px 9px",
  textAlign: "left"
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


export default function TagFilterControl({
  value = "",
  onChange,
  availableTags = []
}) {
  const { parents, labels, nodes, usage, totalUsage } = useTagHierarchy();
  const listboxId = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const listboxRef = useRef(null);
  const rowRefs = useRef(new Map());
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState(null);
  const [highlight, setHighlight] = useState(0);

  const selectedLabel = value ? labelForTag(value, labels) : "";
  const model = useMemo(
    () => buildTagFilterModel({
      query,
      branch,
      selectedTag: value,
      availableTags,
      parents,
      labels,
      nodes,
      usage,
      totalUsage
    }),
    [availableTags, branch, labels, nodes, parents, query, totalUsage, usage, value]
  );
  const rows = model.rows;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query, branch]);

  useEffect(() => {
    setHighlight(current => Math.min(current, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useLayoutEffect(() => {
    if (!open) return;
    const row = rows[highlight];
    if (!row) return;

    keepRowVisible(listboxRef.current, rowRefs.current.get(row.id));
  }, [highlight, open, rows]);

  function setRowRef(rowId) {
    return (element) => {
      if (element) {
        rowRefs.current.set(rowId, element);
      } else {
        rowRefs.current.delete(rowId);
      }
    };
  }

  function close({ restoreFocus = false } = {}) {
    setOpen(false);
    setQuery("");
    setBranch(null);
    setHighlight(0);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function selectTag(tagId) {
    onChange?.(tagId);
    close();
  }

  function goUp() {
    if (!branch) return;
    setBranch((parents[branch] || [])[0] || null);
  }

  function executeRow(row) {
    if (!row) return;
    if (row.type === "back") {
      goUp();
      return;
    }
    if (row.tagId) selectTag(row.tagId);
  }

  function drill(row) {
    if (!row?.openable) return;
    setBranch(row.tagId);
    setQuery("");
    setHighlight(0);
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight(current => Math.min(current + 1, Math.max(rows.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight(current => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "ArrowRight") {
      const row = rows[highlight];
      if (row?.openable) {
        event.preventDefault();
        drill(row);
      }
      return;
    }

    if (event.key === "ArrowLeft") {
      if (branch) {
        event.preventDefault();
        goUp();
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      executeRow(rows[highlight]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
    }
  }

  function handleBlur(event) {
    if (rootRef.current?.contains(event.relatedTarget)) return;
    close();
  }

  return (
    <div ref={rootRef} onBlur={handleBlur} style={rootStyle}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Filtrer par tag"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(current => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        style={triggerStyle}
      >
        {value ? (
          <span style={{ alignItems: "center", display: "inline-flex", gap: "7px", minWidth: 0 }}>
            <span style={{ color: "#8f7de8" }}>#</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedLabel}
            </span>
          </span>
        ) : (
          <span style={{ color: "#777" }}>Filtrer par tag…</span>
        )}
        <span aria-hidden="true" style={{ color: "#777", flexShrink: 0 }}>
          ▾
        </span>
      </button>

      {value && (
        <button
          type="button"
          aria-label="Effacer le filtre tag"
          onClick={(event) => {
            event.stopPropagation();
            onChange?.("");
            close();
          }}
          style={{
            background: "transparent",
            border: "none",
            borderRadius: "50%",
            color: "#777",
            cursor: "pointer",
            fontSize: "18px",
            height: "24px",
            lineHeight: "24px",
            padding: 0,
            position: "absolute",
            right: "28px",
            top: "9px",
            width: "24px"
          }}
        >
          ×
        </button>
      )}

      {open && (
        <div style={popoverStyle}>
          <input
            ref={inputRef}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={open}
            aria-label="Rechercher un tag à filtrer"
            placeholder="Chercher un tag…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            style={searchStyle}
          />

          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            className="app-scrollbar"
            style={listStyle}
          >
            {rows.length === 0 && (
              <div style={{ color: "#777", fontSize: "13px", padding: "10px" }}>
                {model.searching ? "Aucun tag." : "Aucun tag utilisé ici."}
              </div>
            )}

            {rows.map((row, index) => {
              const highlighted = index === highlight;
              const isSelected = row.selected;

              if (row.type === "back") {
                return (
                  <button
                    key={row.id}
                    ref={setRowRef(row.id)}
                    type="button"
                    data-tag-filter-row-index={index}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      executeRow(row);
                    }}
                    onMouseEnter={() => setHighlight(index)}
                    style={{
                      ...rowStyle,
                      background: highlighted ? "#242424" : "transparent",
                      borderRadius: "8px",
                      color: "#888",
                      width: "100%"
                    }}
                  >
                    ◂ {row.label}
                  </button>
                );
              }

              return (
                <div
                  key={row.id}
                  ref={setRowRef(row.id)}
                  data-tag-filter-row-index={index}
                  style={{
                    background: highlighted ? "#242424" : "transparent",
                    borderRadius: "8px",
                    display: "flex"
                  }}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={highlighted}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      executeRow(row);
                    }}
                    onMouseEnter={() => setHighlight(index)}
                    style={{
                      ...rowStyle,
                      color: isSelected ? "#d2c2ff" : "#eee"
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: isSelected ? 800 : 600 }}>
                        #{row.label}
                      </span>
                      {row.breadcrumb && (
                        <span style={{ color: "#777", display: "block", fontSize: "11px" }}>
                          {row.breadcrumb}
                        </span>
                      )}
                    </span>
                    {row.count > 0 && (
                      <span style={{ color: "#777", fontSize: "11px", flexShrink: 0 }}>
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
                        drill(row);
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        borderLeft: "1px solid #262626",
                        color: "#888",
                        cursor: "pointer",
                        font: "inherit",
                        padding: "0 10px"
                      }}
                    >
                      ▸
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
