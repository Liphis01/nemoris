import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GridGroupEditor from "./GridGroupEditor";
import { getGridGroup, patchGridGroup } from "../../../api/gridGroups";

vi.mock("../../../api/gridGroups", () => ({
  getGridGroup: vi.fn(),
  patchGridGroup: vi.fn()
}));

const pendingGroup = { id: null, type_group: "grid", name: "", tags: [], data: {} };

function renderEditor(props = {}) {
  return render(
    <GridGroupEditor
      availableTags={[]}
      ensurePersistedGroup={vi.fn()}
      group={pendingGroup}
      onSave={vi.fn()}
      {...props}
    />
  );
}

function cell(rowLabel, columnLabel) {
  return screen.getByLabelText(`${rowLabel} × ${columnLabel}`);
}

function rowLabelInput(index) {
  return screen.getByLabelText(`Libellé de la ligne ${index}`);
}

function columnLabelInput(index) {
  return screen.getByLabelText(`Libellé de la colonne ${index}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  patchGridGroup.mockResolvedValue({ group: { grid: { format: 1, rows: [], columns: [], cells: [] } }, cards: [] });
});

afterEach(cleanup);

describe("GridGroupEditor — structure lives in the table", () => {
  it("does not fetch a grid for a group that has no id", () => {
    renderEditor();

    expect(getGridGroup).not.toHaveBeenCalled();
  });

  it("edits axis labels in the table headers themselves", () => {
    renderEditor();

    fireEvent.change(columnLabelInput(1), { target: { value: "présent" } });
    fireEvent.change(rowLabelInput(1), { target: { value: "je" } });

    // The label edit and the cell it names are the same surface now, so the
    // cell's accessible name follows immediately.
    expect(cell("je", "présent")).toBeInTheDocument();
  });

  it("adds rows and columns without leaving the grid", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "+ Colonne" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Ligne" }));

    expect(columnLabelInput(2)).toBeInTheDocument();
    expect(rowLabelInput(2)).toBeInTheDocument();
  });

  it("inserts an axis in the middle rather than only appending", () => {
    renderEditor();

    fireEvent.change(rowLabelInput(1), { target: { value: "je" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Ligne" }));
    fireEvent.change(rowLabelInput(2), { target: { value: "nous" } });
    fireEvent.click(screen.getByRole("button", { name: "Insérer une ligne après la ligne 1" }));

    expect(rowLabelInput(1)).toHaveValue("je");
    expect(rowLabelInput(3)).toHaveValue("nous");
  });

  it("reorders rows without touching their cells", () => {
    renderEditor();

    fireEvent.change(rowLabelInput(1), { target: { value: "je" } });
    fireEvent.change(columnLabelInput(1), { target: { value: "présent" } });
    fireEvent.change(cell("je", "présent"), { target: { value: "parle" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Ligne" }));
    fireEvent.change(rowLabelInput(2), { target: { value: "nous" } });
    fireEvent.click(screen.getByRole("button", { name: "Déplacer la ligne 2 vers l'amont" }));

    expect(rowLabelInput(1)).toHaveValue("nous");
    expect(cell("je", "présent")).toHaveValue("parle");
  });

  it("refuses to delete the last row and says why", () => {
    renderEditor();

    expect(screen.getByRole("button", { name: "Supprimer la ligne 1" })).toBeDisabled();
  });

  it("confirms before deleting an axis that holds filled cells", () => {
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(false);

    renderEditor();

    fireEvent.change(cell("Ligne 1", "Colonne 1"), { target: { value: "parle" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Ligne" }));
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la ligne 1" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("« Ligne 1 »")
    );
    // Declining leaves the grid exactly as it was.
    expect(cell("Ligne 1", "Colonne 1")).toHaveValue("parle");

    confirmSpy.mockRestore();
  });

  it("deletes an empty axis without asking", () => {
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);

    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "+ Ligne" }));
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la ligne 2" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Libellé de la ligne 2")).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });
});

describe("GridGroupEditor — card counter", () => {
  it("counts only filled cells", () => {
    renderEditor();

    expect(screen.getByText("Aucune carte — remplis au moins une cellule")).toBeInTheDocument();

    fireEvent.change(cell("Ligne 1", "Colonne 1"), { target: { value: "parle" } });

    expect(screen.getByText("1 carte sera générée")).toBeInTheDocument();

    // Whitespace is not an answer, so it must not inflate the count.
    fireEvent.change(cell("Ligne 1", "Colonne 1"), { target: { value: "   " } });

    expect(screen.getByText("Aucune carte — remplis au moins une cellule")).toBeInTheDocument();
  });
});

describe("GridGroupEditor — paste a table", () => {
  it("builds the whole grid from a tab-separated block", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Coller un tableau" }));
    fireEvent.change(screen.getByLabelText("Coller un tableau séparé par des tabulations"), {
      target: { value: "\tprésent\timparfait\nje\tparle\tparlais\nnous\tparlons\tparlions" }
    });

    expect(screen.getByText("2 lignes × 2 colonnes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remplacer la grille" }));

    expect(cell("je", "présent")).toHaveValue("parle");
    expect(cell("nous", "imparfait")).toHaveValue("parlions");
    expect(screen.getByText("4 cartes seront générées")).toBeInTheDocument();
  });

  it("spills a block pasted directly onto a cell, growing the axes", () => {
    renderEditor();

    fireEvent.paste(cell("Ligne 1", "Colonne 1"), {
      clipboardData: { getData: () => "parle\tparlais\nparlons\tparlions" }
    });

    expect(cell("Ligne 1", "Colonne 1")).toHaveValue("parle");
    expect(cell("Ligne 2", "Colonne 2")).toHaveValue("parlions");
    expect(screen.getByText("4 cartes seront générées")).toBeInTheDocument();
  });

  it("leaves ordinary multi-line text in the cell it was aimed at", () => {
    renderEditor();

    fireEvent.paste(cell("Ligne 1", "Colonne 1"), {
      clipboardData: { getData: () => "deux\nlignes" }
    });

    // No tab means no table: the paste is left to the browser.
    expect(screen.queryByLabelText("Libellé de la ligne 2")).not.toBeInTheDocument();
  });
});

describe("GridGroupEditor — keyboard", () => {
  function buildTwoByTwo() {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "+ Ligne" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Colonne" }));
  }

  it("moves down on Enter", () => {
    buildTwoByTwo();

    const first = cell("Ligne 1", "Colonne 1");

    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });

    expect(document.activeElement).toBe(cell("Ligne 2", "Colonne 1"));
  });

  it("adds a row when Enter is pressed on the last one", async () => {
    buildTwoByTwo();

    const last = cell("Ligne 2", "Colonne 1");

    last.focus();
    fireEvent.keyDown(last, { key: "Enter" });

    await waitFor(() => expect(document.activeElement).toBe(cell("Ligne 3", "Colonne 1")));
  });

  it("moves right with the arrow key only once the caret is at the end", () => {
    buildTwoByTwo();

    const first = cell("Ligne 1", "Colonne 1");

    fireEvent.change(first, { target: { value: "parle" } });
    first.focus();

    // Mid-text the arrow belongs to the caret, not to the grid.
    first.setSelectionRange(2, 2);
    fireEvent.keyDown(first, { key: "ArrowRight" });

    expect(document.activeElement).toBe(first);

    first.setSelectionRange(5, 5);
    fireEvent.keyDown(first, { key: "ArrowRight" });

    expect(document.activeElement).toBe(cell("Ligne 1", "Colonne 2"));
  });

  it("reverts the cell on Escape", () => {
    renderEditor();

    const target = cell("Ligne 1", "Colonne 1");

    fireEvent.change(target, { target: { value: "parle" } });
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: "parlait" } });
    fireEvent.keyDown(target, { key: "Escape" });

    expect(cell("Ligne 1", "Colonne 1")).toHaveValue("parle");
  });
});

describe("GridGroupEditor — saving", () => {
  it("keeps Enregistrer disabled until something actually changes", () => {
    renderEditor();

    expect(screen.getByRole("button", { name: /Enregistrer/ })).toBeDisabled();

    fireEvent.change(cell("Ligne 1", "Colonne 1"), { target: { value: "parle" } });

    expect(screen.getByRole("button", { name: /Enregistrer/ })).toBeEnabled();
  });

  it("treats a cell typed and cleared again as no change at all", () => {
    renderEditor();

    const target = cell("Ligne 1", "Colonne 1");

    fireEvent.change(target, { target: { value: "parle" } });
    fireEvent.change(target, { target: { value: "" } });

    expect(screen.getByRole("button", { name: /Enregistrer/ })).toBeDisabled();
  });

  it("reports a missing name next to the save button, not below the table", async () => {
    renderEditor();

    fireEvent.change(cell("Ligne 1", "Colonne 1"), { target: { value: "parle" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => expect(screen.getByText("Donne un nom à cette grille.")).toBeInTheDocument());
    expect(patchGridGroup).not.toHaveBeenCalled();
  });

  it("strips blank cells from the payload", async () => {
    const ensurePersistedGroup = vi.fn().mockResolvedValue({ id: 7, name: "Parler" });

    renderEditor({ ensurePersistedGroup });

    fireEvent.change(screen.getByLabelText("Nom de la grille"), { target: { value: "Parler" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Colonne" }));
    fireEvent.change(cell("Ligne 1", "Colonne 1"), { target: { value: "parle" } });
    fireEvent.change(cell("Ligne 1", "Colonne 2"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => expect(patchGridGroup).toHaveBeenCalled());

    const [, payload] = patchGridGroup.mock.calls[0];

    expect(payload.grid.cells).toHaveLength(1);
    expect(payload.grid.cells[0].value).toBe("parle");
  });

  it("restores the loaded grid when Annuler is pressed", async () => {
    getGridGroup.mockResolvedValue({
      group: {
        id: 4,
        name: "Parler",
        grid: {
          format: 1,
          rows: [{ key: "r1", label: "je" }],
          columns: [{ key: "c1", label: "présent" }],
          cells: [{ key: "k1", row_key: "r1", column_key: "c1", value: "parle" }]
        }
      }
    });

    renderEditor({ group: { id: 4, type_group: "grid", name: "Parler", tags: [], data: {} } });

    await waitFor(() => expect(cell("je", "présent")).toHaveValue("parle"));

    fireEvent.change(cell("je", "présent"), { target: { value: "parlais" } });
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));

    expect(cell("je", "présent")).toHaveValue("parle");
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDisabled();
  });
});
