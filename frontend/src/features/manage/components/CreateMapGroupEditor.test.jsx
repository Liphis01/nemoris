import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMapImportFromFile,
  createMapImportFromUrl,
  getMapImport,
  listMapImports
} from "../../../api/maps";
import CreateMapGroupEditor from "./CreateMapGroupEditor";

vi.mock("../../../api/maps", () => ({
  cancelMapImport: vi.fn().mockResolvedValue({ status: "cancelled" }),
  createMapImportFromFile: vi.fn(),
  createMapImportFromUrl: vi.fn(),
  getMapImport: vi.fn(),
  listMapImports: vi.fn()
}));

function svgFile(name = "carte.svg") {
  return new File(["<svg/>"], name, { type: "image/svg+xml" });
}

function analyzedDraft(overrides = {}) {
  return { draft_id: "draft-1", route: "automatic", can_commit: true, ...overrides };
}

function renderPanel(props = {}) {
  return render(
    <CreateMapGroupEditor
      groupDraft={{ name: "", type_group: "map" }}
      setGroupDraft={vi.fn()}
      onCancel={vi.fn()}
      onAnalyzed={vi.fn()}
      onOpenRepair={vi.fn()}
      {...props}
    />
  );
}

describe("CreateMapGroupEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMapImports.mockResolvedValue({ drafts: [] });
  });

  afterEach(cleanup);

  it("analyses a chosen file immediately with an inferred name", async () => {
    createMapImportFromFile.mockResolvedValue(analyzedDraft());
    const onAnalyzed = vi.fn();
    const setGroupDraft = vi.fn();
    renderPanel({ onAnalyzed, setGroupDraft });

    fireEvent.change(screen.getByLabelText("Fichier SVG"), {
      target: { files: [svgFile("departements_francais-2024.svg")] }
    });

    await waitFor(() => {
      expect(createMapImportFromFile).toHaveBeenCalledWith(
        expect.any(File),
        {
          expectedZoneCount: null,
          ontology: "auto",
          name: "Departements francais 2024"
        }
      );
    });
    expect(setGroupDraft).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Departements francais 2024" })
    );
    expect(onAnalyzed).toHaveBeenCalledWith(
      expect.objectContaining({ draft_id: "draft-1" }),
      "Departements francais 2024"
    );
  });

  it("does not ask for a name and hides detection options by default", async () => {
    renderPanel();
    await waitFor(() => expect(listMapImports).toHaveBeenCalled());

    expect(screen.queryByText("Nom du groupe")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Type de carte")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Nombre de zones attendu")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Options de détection" }));
    expect(screen.getByLabelText("Type de carte")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre de zones attendu")).toBeInTheDocument();
  });

  it("analyses a dropped file", async () => {
    createMapImportFromFile.mockResolvedValue(analyzedDraft());
    const onAnalyzed = vi.fn();
    renderPanel({ onAnalyzed });

    fireEvent.drop(
      screen.getByRole("button", { name: /Déposez un fichier SVG ici/ }),
      { dataTransfer: { files: [svgFile("espagne.svg")] } }
    );

    await waitFor(() => {
      expect(createMapImportFromFile).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({ name: "Espagne" })
      );
      expect(onAnalyzed).toHaveBeenCalled();
    });
  });

  it("imports from a link behind an explicit action", async () => {
    createMapImportFromUrl.mockResolvedValue(analyzedDraft());
    const onAnalyzed = vi.fn();
    renderPanel({ onAnalyzed });

    fireEvent.click(screen.getByRole("button", { name: "Importer depuis un lien" }));
    fireEvent.change(screen.getByLabelText("Lien vers un fichier SVG"), {
      target: { value: "https://example.test/maps/colombia-departments.svg" }
    });
    expect(createMapImportFromUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Importer ce lien" }));
    await waitFor(() => {
      expect(createMapImportFromUrl).toHaveBeenCalledWith(
        "https://example.test/maps/colombia-departments.svg",
        expect.objectContaining({ name: "Colombia departments" })
      );
      expect(onAnalyzed).toHaveBeenCalled();
    });
  });

  it("passes advanced detection settings to the analysis", async () => {
    createMapImportFromFile.mockResolvedValue(analyzedDraft());
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Options de détection" }));
    fireEvent.change(screen.getByLabelText("Type de carte"), {
      target: { value: "generic" }
    });
    fireEvent.change(screen.getByLabelText("Nombre de zones attendu"), {
      target: { value: "42" }
    });
    fireEvent.change(screen.getByLabelText("Fichier SVG"), {
      target: { files: [svgFile("capitales.svg")] }
    });

    await waitFor(() => {
      expect(createMapImportFromFile).toHaveBeenCalledWith(
        expect.any(File),
        { expectedZoneCount: 42, ontology: "generic", name: "Capitales" }
      );
    });
  });

  it("offers only the two structural detection modes", async () => {
    renderPanel();
    await waitFor(() => expect(listMapImports).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Options de détection" }));
    expect(
      [...screen.getByLabelText("Type de carte").options].map(item => item.value)
    ).toEqual(["auto", "generic"]);
  });

  it("keeps drafts behind a compact resume entry and reopens repair state", async () => {
    listMapImports.mockResolvedValue({
      drafts: [{
        draft_id: "draft-9",
        name: "Colombie",
        updated_at: new Date().toISOString(),
        repair_available: true,
        repair_summary: { zone_count: 34 },
        readiness_blockers: ["repair.required_unresolved"],
        can_commit: false
      }]
    });
    getMapImport.mockResolvedValue(analyzedDraft({ draft_id: "draft-9" }));
    const onOpenRepair = vi.fn();
    renderPanel({ onOpenRepair });

    const resume = await screen.findByRole("button", {
      name: "Reprendre un import (1)"
    });
    expect(screen.queryByText("Colombie")).not.toBeInTheDocument();

    fireEvent.click(resume);
    expect(screen.getByText("Colombie")).toBeInTheDocument();
    expect(
      screen.getByText(/correction en cours · 34 zones/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Colombie/ })[0]);
    await waitFor(() => {
      expect(getMapImport).toHaveBeenCalledWith("draft-9");
      expect(onOpenRepair).toHaveBeenCalledWith(
        expect.objectContaining({ draft_id: "draft-9" }),
        "Colombie"
      );
    });
  });

  it("reports an analysis failure without leaving the panel", async () => {
    createMapImportFromFile.mockRejectedValue(new Error("SVG illisible"));
    const onAnalyzed = vi.fn();
    renderPanel({ onAnalyzed });

    fireEvent.change(screen.getByLabelText("Fichier SVG"), {
      target: { files: [svgFile()] }
    });

    expect(await screen.findByText("SVG illisible")).toBeInTheDocument();
    expect(onAnalyzed).not.toHaveBeenCalled();
  });
});
