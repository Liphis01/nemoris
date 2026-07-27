import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createCollection,
  previewCollection,
  updateCollection
} from "../../../api/collections";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";

/**
 * Rules-first playlist builder.
 *
 * The old composer was a manual shopping cart: you filtered, ticked rows, and
 * saved a snapshot. Two things made that bad enough to replace rather than
 * move -- its bulk "add the visible group" button only added the rows already
 * loaded (silently partial once paginated), and the result never changed
 * again, so a question tagged later never joined.
 *
 * Here a playlist is a rule. "Groupe = Drapeaux du monde OR tag = drapeaux"
 * keeps resolving forever; pinning and excluding individual questions is the
 * escape hatch on top, not the primary interaction.
 */

const CLAUSE_KINDS = [
  { kind: "group", label: "Groupe" },
  { kind: "tag", label: "Tag" },
  { kind: "type", label: "Type" },
  { kind: "difficulty", label: "Difficulté" }
];

const QUESTION_TYPES = ["text", "map", "media", "timeline", "sequence"];

const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
    padding: 18,
    height: "100%",
    minHeight: 0,
    overflowY: "auto",
    scrollbarGutter: "stable",
    color: "#e6e6e6"
  },
  label: {
    display: "block",
    fontSize: 11,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#8a8a8a",
    marginBottom: 6
  },
  input: {
    width: "100%",
    background: "#1b1b1b",
    border: "1px solid #2e2e2e",
    borderRadius: 6,
    color: "#e6e6e6",
    padding: "8px 10px",
    fontSize: 14
  },
  section: {
    border: "1px solid #262626",
    borderRadius: 8,
    padding: 14,
    background: "#161616"
  },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12
  },
  clauseRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8
  },
  select: {
    background: "#1b1b1b",
    border: "1px solid #2e2e2e",
    borderRadius: 6,
    color: "#e6e6e6",
    padding: "6px 8px",
    fontSize: 13
  },
  count: {
    marginLeft: "auto",
    fontSize: 12,
    color: "#8a8a8a",
    whiteSpace: "nowrap"
  },
  iconButton: {
    background: "transparent",
    border: "1px solid #2e2e2e",
    borderRadius: 6,
    color: "#9a9a9a",
    cursor: "pointer",
    padding: "4px 8px",
    fontSize: 13
  },
  addButton: {
    background: "#1b1b1b",
    border: "1px dashed #3a3a3a",
    borderRadius: 6,
    color: "#9ad0ff",
    cursor: "pointer",
    padding: "6px 10px",
    fontSize: 12
  },
  total: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
    padding: "10px 14px",
    borderRadius: 8,
    background: "#12233a",
    border: "1px solid #1d3b5f"
  },
  totalValue: { fontSize: 20, fontWeight: 700, color: "#8ecbff" },
  totalMeta: { fontSize: 12, color: "#9fb8d0" },
  previewRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 0",
    borderBottom: "1px solid #212121",
    fontSize: 13
  },
  chip: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.06em",
    borderRadius: 4,
    padding: "2px 6px"
  },
  actions: { display: "flex", gap: 10, marginTop: 4 },
  primary: {
    background: "#1d4ed8",
    border: "none",
    borderRadius: 6,
    color: "#fff",
    cursor: "pointer",
    padding: "9px 16px",
    fontSize: 14
  },
  secondary: {
    background: "transparent",
    border: "1px solid #2e2e2e",
    borderRadius: 6,
    color: "#c8c8c8",
    cursor: "pointer",
    padding: "9px 16px",
    fontSize: 14
  },
  error: {
    background: "#3a1a1a",
    border: "1px solid #5e2626",
    borderRadius: 6,
    color: "#ffb4b4",
    padding: "8px 10px",
    fontSize: 13
  },
  muted: { color: "#7a7a7a", fontSize: 13 }
};

function emptyClause(kind) {
  if (kind === "group") return { kind, group_id: null };
  if (kind === "tag") return { kind, tag: "" };
  if (kind === "type") return { kind, type_q: "text" };

  return { kind, gte: 7 };
}

function typeCountLabel(typeCounts) {
  return Object.entries(typeCounts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${getQuestionTypeChipStyle(type).label} ${count}`)
    .join(" · ");
}

export default function PlaylistBuilder({
  playlist = null,
  groups = [],
  availableTags = [],
  onSaved,
  onCancel,
  onDelete
}) {
  const editing = Boolean(playlist?.id);

  const [name, setName] = useState(playlist?.name || "");
  const [matchAll, setMatchAll] = useState(
    (playlist?.rules?.match || "any") === "all"
  );
  const [clauses, setClauses] = useState(playlist?.rules?.clauses || []);
  const [pinnedIds, setPinnedIds] = useState(
    playlist?.pinned_question_ids || []
  );
  const [excludedIds, setExcludedIds] = useState(
    playlist?.excluded_question_ids || []
  );

  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const rules = useMemo(
    () => ({ match: matchAll ? "all" : "any", clauses }),
    [matchAll, clauses]
  );

  const previewSeq = useRef(0);

  const runPreview = useCallback(async () => {
    // Sequence guard rather than AbortController: an aborted preview and a
    // stale one need the same handling, and only the newest result may win.
    const seq = previewSeq.current + 1;
    previewSeq.current = seq;

    setPreviewing(true);

    try {
      const result = await previewCollection({
        rules,
        question_ids: pinnedIds,
        excluded_question_ids: excludedIds
      });

      if (previewSeq.current === seq) {
        setPreview(result);
        setError("");
      }
    } catch (previewError) {
      console.error(previewError);

      if (previewSeq.current === seq) {
        setError(previewError.message || "Aperçu impossible.");
      }
    } finally {
      if (previewSeq.current === seq) {
        setPreviewing(false);
      }
    }
  }, [rules, pinnedIds, excludedIds]);

  useEffect(() => {
    const timer = window.setTimeout(runPreview, 250);

    return () => window.clearTimeout(timer);
  }, [runPreview]);

  function patchClause(index, patch) {
    setClauses((current) => current.map(
      (clause, position) => (
        position === index ? { ...clause, ...patch } : clause
      )
    ));
  }

  function removeClause(index) {
    setClauses((current) => current.filter(
      (_, position) => position !== index
    ));
  }

  function excludeQuestion(questionId) {
    setPinnedIds((current) => current.filter((id) => id !== questionId));
    setExcludedIds((current) => (
      current.includes(questionId) ? current : [...current, questionId]
    ));
  }

  async function handleSave() {
    const cleanName = name.trim();

    if (!cleanName) {
      setError("Le nom est obligatoire.");
      return;
    }

    setSaving(true);
    setError("");

    const payload = {
      name: cleanName,
      rules,
      question_ids: pinnedIds,
      excluded_question_ids: excludedIds
    };

    try {
      const saved = editing
        ? await updateCollection(playlist.id, payload)
        : await createCollection(payload);

      if (onSaved) {
        await onSaved(saved);
      }
    } catch (saveError) {
      console.error(saveError);
      setError(saveError.message || "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const total = preview?.total ?? 0;
  const clauseCounts = preview?.clause_counts || [];

  return (
    <div className="app-scrollbar" style={styles.root}>
      {/* One shared datalist: ids must be unique, so it cannot live per row. */}
      <datalist id="playlist-builder-tags">
        {availableTags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>

      <div>
        <span style={styles.label}>Nom de la playlist</span>
        <input
          aria-label="Nom de la playlist"
          type="text"
          style={styles.input}
          value={name}
          placeholder="Drapeaux mix"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionHead}>
          <span style={{ ...styles.label, margin: 0 }}>Règles</span>

          <select
            aria-label="Combinaison des règles"
            style={styles.select}
            value={matchAll ? "all" : "any"}
            onChange={(event) => setMatchAll(event.target.value === "all")}
          >
            <option value="any">au moins une</option>
            <option value="all">toutes</option>
          </select>
        </div>

        {clauses.length === 0 && (
          <p style={styles.muted}>
            Sans règle, la playlist ne contient que les questions ajoutées à
            la main.
          </p>
        )}

        {clauses.map((clause, index) => (
          <div key={index} style={styles.clauseRow}>
            <select
              aria-label={`Type de règle ${index + 1}`}
              style={styles.select}
              value={clause.kind}
              onChange={(event) => setClauses((current) => current.map(
                (item, position) => (
                  position === index ? emptyClause(event.target.value) : item
                )
              ))}
            >
              {CLAUSE_KINDS.map((option) => (
                <option key={option.kind} value={option.kind}>
                  {option.label}
                </option>
              ))}
            </select>

            {clause.kind === "group" && (
              <select
                aria-label={`Groupe de la règle ${index + 1}`}
                style={styles.select}
                value={clause.group_id ?? ""}
                onChange={(event) => patchClause(index, {
                  group_id: event.target.value
                    ? Number(event.target.value)
                    : null
                })}
              >
                <option value="">Choisir…</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            )}

            {clause.kind === "tag" && (
              <input
                aria-label={`Tag de la règle ${index + 1}`}
                type="text"
                list="playlist-builder-tags"
                style={{ ...styles.input, width: 200 }}
                value={clause.tag || ""}
                onChange={(event) => patchClause(index, {
                  tag: event.target.value
                })}
              />
            )}

            {clause.kind === "type" && (
              <select
                aria-label={`Type de question de la règle ${index + 1}`}
                style={styles.select}
                value={clause.type_q || "text"}
                onChange={(event) => patchClause(index, {
                  type_q: event.target.value
                })}
              >
                {QUESTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {getQuestionTypeChipStyle(type).label}
                  </option>
                ))}
              </select>
            )}

            {clause.kind === "difficulty" && (
              <input
                aria-label={`Difficulté minimale de la règle ${index + 1}`}
                type="number"
                min="0"
                max="10"
                step="0.5"
                style={{ ...styles.input, width: 90 }}
                value={clause.gte ?? 7}
                onChange={(event) => patchClause(index, {
                  gte: Number(event.target.value)
                })}
              />
            )}

            <span style={styles.count}>
              {clauseCounts[index] ?? "—"} question
              {(clauseCounts[index] ?? 0) > 1 ? "s" : ""}
            </span>

            <button
              type="button"
              style={styles.iconButton}
              aria-label={`Supprimer la règle ${index + 1}`}
              onClick={() => removeClause(index)}
            >
              ✕
            </button>
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {CLAUSE_KINDS.map((option) => (
            <button
              key={option.kind}
              type="button"
              style={styles.addButton}
              onClick={() => setClauses((current) => [
                ...current,
                emptyClause(option.kind)
              ])}
            >
              + {option.label.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.total} role="status">
        <span style={styles.totalValue}>
          {previewing && !preview ? "…" : total}
        </span>
        <span style={styles.totalMeta}>
          question{total > 1 ? "s" : ""}
          {preview?.group_count
            ? ` · ${preview.group_count} groupe${preview.group_count > 1 ? "s" : ""}`
            : ""}
          {typeCountLabel(preview?.type_counts)
            ? ` · ${typeCountLabel(preview.type_counts)}`
            : ""}
        </span>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionHead}>
          <span style={{ ...styles.label, margin: 0 }}>Aperçu</span>
          {excludedIds.length > 0 && (
            <button
              type="button"
              style={styles.iconButton}
              onClick={() => setExcludedIds([])}
            >
              Rétablir {excludedIds.length} exclue
              {excludedIds.length > 1 ? "s" : ""}
            </button>
          )}
        </div>

        {(preview?.items || []).map((item) => {
          const chip = getQuestionTypeChipStyle(item.type_q);

          return (
            <div key={item.id} style={styles.previewRow}>
              <span
                style={{
                  ...styles.chip,
                  background: chip.background,
                  color: chip.color
                }}
              >
                {chip.label}
              </span>
              <span>{item.title}</span>
              <span style={{ ...styles.muted, marginLeft: "auto" }}>
                {item.group?.name || "Sans groupe"}
              </span>
              <button
                type="button"
                style={styles.iconButton}
                aria-label={`Exclure ${item.title}`}
                onClick={() => excludeQuestion(item.id)}
              >
                exclure
              </button>
            </div>
          );
        })}

        {total === 0 && !previewing && (
          <p style={styles.muted}>Aucune question ne correspond.</p>
        )}

        {total > (preview?.items || []).length && (
          <p style={{ ...styles.muted, marginTop: 8 }}>
            + {total - preview.items.length} autre
            {total - preview.items.length > 1 ? "s" : ""}
          </p>
        )}
      </div>

      {error && <div style={styles.error} role="alert">{error}</div>}

      <div style={styles.actions}>
        <button
          type="button"
          style={styles.primary}
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? "Enregistrement…" : editing ? "Enregistrer" : "Créer"}
        </button>

        <button
          type="button"
          style={styles.secondary}
          disabled={saving}
          onClick={onCancel}
        >
          Annuler
        </button>

        {editing && !playlist.generated && onDelete && (
          <button
            type="button"
            style={{ ...styles.secondary, marginLeft: "auto", color: "#ff9c9c" }}
            disabled={saving}
            onClick={() => {
              if (window.confirm(`Supprimer la playlist « ${playlist.name} » ?`)) {
                onDelete(playlist);
              }
            }}
          >
            Supprimer
          </button>
        )}
      </div>
    </div>
  );
}
