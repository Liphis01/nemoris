import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGridGroup, patchGridGroup } from "../../../api/gridGroups";
import {
  looksLikeTable,
  parseTable,
  spillTableIntoGrid,
  tableShape,
  tableToGrid
} from "../gridPaste";
import { blankGrid, cardCount, toSavePayload } from "../gridSource";
import {
  buttonStyle,
  cancelButtonStyle,
  disabledCancelButtonStyle,
  disabledSaveButtonStyle,
  inputStyle,
  pendingSaveButtonStyle,
  pendingSaveDotStyle
} from "./QuestionEditorStyles";
import { QuestionEditorField, TagEditor } from "./QuestionEditorPrimitives";
import AnswerPolicyControl from "./AnswerPolicyControl";
import { answerPolicyFromGroup } from "./answerPolicyControlUtils";
import GridMatrix from "./GridMatrix";

const compactInputStyle = {
  ...inputStyle,
  borderRadius: "8px",
  fontSize: "13px",
  padding: "8px 10px"
};

const compactButtonStyle = { padding: "8px 12px" };

const gridTagChipStyle = {
  background: "#123a3a",
  border: "1px solid #2f6f6f",
  color: "#5eead4",
  fontSize: "12px",
  fontWeight: 700
};

// Only the saved shape counts as a change: a cell typed and cleared again is
// back where it started, and the grid should not claim otherwise.
function signature(group, grid) {
  return JSON.stringify({
    name: group?.name || "",
    tags: group?.tags || [],
    policy: answerPolicyFromGroup(group),
    grid: toSavePayload(grid)
  });
}

export default function GridGroupEditor({
  group,
  availableTags = [],
  ensurePersistedGroup,
  onSave,
  registerPendingSaveHandler,
  headerAction
}) {
  const [editableGroup, setEditableGroup] = useState(group);
  const [grid, setGrid] = useState(blankGrid);
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true);
  const [firstColumnIsHeader, setFirstColumnIsHeader] = useState(true);
  const [editPolicy, setEditPolicy] = useState("replace_progress");
  const savedStateRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    setEditableGroup(group);
    setError("");
    setStatus("");
    setTagInput("");
    setPasteOpen(false);
    setPasteText("");
    setEditPolicy("replace_progress");

    if (!group?.id) {
      const next = blankGrid();

      setGrid(next);
      setSaved(signature(group, next));
      savedStateRef.current = { group, grid: next };

      return undefined;
    }

    setLoading(true);
    getGridGroup(group.id)
      .then((result) => {
        if (cancelled) return;

        const nextGroup = { ...group, ...result.group };
        const nextGrid = result.group?.grid?.rows?.length ? result.group.grid : blankGrid();

        setEditableGroup(nextGroup);
        setGrid(nextGrid);
        setSaved(signature(nextGroup, nextGrid));
        savedStateRef.current = { group: nextGroup, grid: nextGrid };
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message || "Chargement impossible");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [group]);

  const dirty = useMemo(
    () => signature(editableGroup, grid) !== saved,
    [editableGroup, grid, saved]
  );
  const count = cardCount(grid);

  const addTag = (value) => {
    const next = String(value ?? tagInput).trim();

    if (!next || editableGroup?.tags?.includes(next)) return;

    setEditableGroup(current => ({ ...current, tags: [...(current?.tags || []), next] }));
    setTagInput("");
  };

  const cancelChanges = () => {
    const snapshot = savedStateRef.current;

    if (!snapshot) return;

    setEditableGroup(snapshot.group);
    setGrid(snapshot.grid);
    setTagInput("");
    setStatus("");
    setError("");
  };

  // Pasting straight onto a cell spills the block from that corner. It returns
  // whether it took the paste, so ordinary multi-line text still lands in the
  // cell the user aimed at.
  const handlePasteTable = useCallback((text, rowIndex, columnIndex) => {
    if (!looksLikeTable(text)) return false;

    const table = parseTable(text);

    if (!table.length) return false;

    setGrid(current => spillTableIntoGrid(current, table, rowIndex, columnIndex));

    return true;
  }, []);

  const pastedTable = useMemo(() => parseTable(pasteText), [pasteText]);
  const pastedShape = tableShape(pastedTable, { firstColumnIsHeader, firstRowIsHeader });

  function applyPastedTable() {
    const next = tableToGrid(pastedTable, { firstColumnIsHeader, firstRowIsHeader });

    if (!next) {
      setError("Ce tableau ne contient aucune ligne à importer.");
      return;
    }

    setGrid(next);
    setPasteText("");
    setPasteOpen(false);
    setError("");
  }

  const save = useCallback(async () => {
    if (!String(editableGroup?.name || "").trim()) {
      setError("Donne un nom à cette grille.");
      return null;
    }

    const payload = toSavePayload(grid);

    if (!payload.cells.length) {
      setError("Ajoute au moins une cellule non vide.");
      return null;
    }

    setStatus("Enregistrement...");
    setError("");

    try {
      const target = group?.id
        ? group
        : await ensurePersistedGroup?.({ name: editableGroup.name, itemCount: payload.cells.length });

      if (!target?.id) return null;

      const result = await patchGridGroup(target.id, {
        name: editableGroup.name,
        tags: editableGroup.tags || [],
        answer_policy: answerPolicyFromGroup(editableGroup),
        grid: payload,
        edit_policy: editPolicy
      });
      const nextGroup = { ...editableGroup, ...result.group };
      const nextGrid = result.group.grid;

      setEditableGroup(nextGroup);
      setGrid(nextGrid);
      setSaved(signature(nextGroup, nextGrid));
      savedStateRef.current = { group: nextGroup, grid: nextGrid };
      setStatus("Enregistré ✔");

      await onSave?.({
        ...result,
        group: { ...target, ...result.group },
        items: result.items || result.cards || []
      });

      return result;
    } catch (saveError) {
      setStatus("");
      setError(saveError.message || "Enregistrement impossible");

      return null;
    }
  }, [editPolicy, editableGroup, ensurePersistedGroup, grid, group, onSave]);

  useEffect(
    () => registerPendingSaveHandler?.(() => (dirty ? save() : null)),
    [dirty, registerPendingSaveHandler, save]
  );

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
          display: "grid",
          gap: "9px",
          padding: "12px 14px"
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
            <div style={{ color: "#777", fontSize: "11px", marginBottom: "3px" }}>Grille</div>
            <div style={{ color: "#eee", fontSize: "17px", fontWeight: 800 }}>
              {editableGroup?.name || "Sans titre"}
            </div>
          </div>

          <div style={{ alignItems: "center", display: "flex", gap: "10px" }}>
            {headerAction}

            <button
              disabled={!dirty}
              onClick={cancelChanges}
              style={dirty
                ? { ...cancelButtonStyle, ...compactButtonStyle }
                : { ...disabledCancelButtonStyle, ...compactButtonStyle }}
              title={dirty ? undefined : "Aucune modification à annuler"}
              type="button"
            >
              Annuler
            </button>

            <button
              disabled={!dirty}
              onClick={save}
              style={dirty
                ? { ...pendingSaveButtonStyle, ...compactButtonStyle }
                : { ...disabledSaveButtonStyle, ...compactButtonStyle }}
              type="button"
            >
              {dirty && <span aria-hidden="true" style={pendingSaveDotStyle} />}
              Enregistrer
            </button>
          </div>
        </div>

        <QuestionEditorField compact label="Nom de la grille">
          <input
            onChange={event => setEditableGroup(current => ({ ...current, name: event.target.value }))}
            style={compactInputStyle}
            value={editableGroup?.name || ""}
          />
        </QuestionEditorField>

        <TagEditor
          availableTags={availableTags}
          chipStyle={gridTagChipStyle}
          compact
          inputOverrideStyle={compactInputStyle}
          labelOverrideStyle={{ fontSize: "12px" }}
          onAddTag={addTag}
          onRemoveTag={tag => setEditableGroup(current => ({
            ...current,
            tags: (current?.tags || []).filter(value => value !== tag)
          }))}
          onTagInputChange={setTagInput}
          tagInput={tagInput}
          tags={editableGroup?.tags || []}
        />

        <AnswerPolicyControl
          onChange={answer_policy => setEditableGroup(current => ({
            ...current,
            data: { ...(current?.data || {}), answer_policy }
          }))}
          policy={answerPolicyFromGroup(editableGroup)}
        />

        {group?.id && (
          <QuestionEditorField compact label="Type de modification">
            <select
              aria-label="Type de modification"
              onChange={event => setEditPolicy(event.target.value)}
              style={compactInputStyle}
              value={editPolicy}
            >
              <option value="replace_progress">Changer le fait appris</option>
              <option value="preserve_progress">Corriger une faute</option>
            </select>
          </QuestionEditorField>
        )}

        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button
            onClick={() => setPasteOpen(current => !current)}
            style={{ ...buttonStyle, ...compactButtonStyle }}
            type="button"
          >
            Coller un tableau
          </button>

          <span style={{ color: count ? "#5eead4" : "#888", fontSize: "13px" }}>
            {count
              ? `${count} carte${count > 1 ? "s seront générées" : " sera générée"}`
              : "Aucune carte — remplis au moins une cellule"}
          </span>

          {status && <span style={{ color: "#888", fontSize: "13px" }}>{status}</span>}
          {error && <span style={{ color: "#ff9494", fontSize: "13px" }}>{error}</span>}
        </div>

        {pasteOpen && (
          <div style={{ display: "grid", gap: "7px" }}>
            <textarea
              aria-label="Coller un tableau séparé par des tabulations"
              onChange={event => setPasteText(event.target.value)}
              placeholder={"\tprésent\timparfait\nje\tparle\tparlais\nnous\tparlons\tparlions"}
              rows={5}
              style={{ ...compactInputStyle, resize: "vertical" }}
              value={pasteText}
            />

            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "12px" }}>
              <label style={{ alignItems: "center", color: "#bbb", display: "flex", fontSize: "12px", gap: "6px" }}>
                <input
                  checked={firstRowIsHeader}
                  onChange={event => setFirstRowIsHeader(event.target.checked)}
                  type="checkbox"
                />
                Première ligne = colonnes
              </label>

              <label style={{ alignItems: "center", color: "#bbb", display: "flex", fontSize: "12px", gap: "6px" }}>
                <input
                  checked={firstColumnIsHeader}
                  onChange={event => setFirstColumnIsHeader(event.target.checked)}
                  type="checkbox"
                />
                Première colonne = lignes
              </label>

              <span style={{ color: "#888", fontSize: "12px" }}>
                {pastedTable.length
                  ? `${pastedShape.rows} ligne${pastedShape.rows > 1 ? "s" : ""} × ${pastedShape.columns} colonne${pastedShape.columns > 1 ? "s" : ""}`
                  : "Colle un tableau depuis un tableur"}
              </span>
            </div>

            <div>
              <button
                disabled={!pastedTable.length}
                onClick={applyPastedTable}
                style={pastedTable.length
                  ? { ...buttonStyle, ...compactButtonStyle }
                  : { ...buttonStyle, ...compactButtonStyle, cursor: "not-allowed", opacity: 0.5 }}
                type="button"
              >
                Remplacer la grille
              </button>
            </div>
          </div>
        )}
      </div>

      <div
        className="app-scrollbar"
        style={{
          alignContent: "start",
          display: "grid",
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "14px",
          scrollbarGutter: "stable"
        }}
      >
        {loading
          ? <div style={{ color: "#888", padding: "18px" }}>Chargement...</div>
          : <GridMatrix grid={grid} onChange={setGrid} onPasteTable={handlePasteTable} />}
      </div>
    </div>
  );
}
