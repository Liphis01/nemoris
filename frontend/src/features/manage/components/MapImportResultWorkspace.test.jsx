import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitMapImport, patchMapImport } from "../../../api/maps";
import MapImportResultWorkspace from "./MapImportResultWorkspace";

vi.mock("../../../api/maps", () => ({
  cancelMapImport: vi.fn().mockResolvedValue({ status: "cancelled" }),
  commitMapImport: vi.fn(),
  patchMapImport: vi.fn()
}));

vi.mock("../../map/components/SvgMap", () => ({
  default: ({ svgPath }) => <div data-testid="preview">{svgPath}</div>
}));

function zones(count) {
  return Array.from({ length: count }, (unused, index) => ({
    code: `z${index}`,
    shape_ids: [`s00000${index}`],
    hit_shape_ids: [],
    source_keys: [`id:z${index}`],
    proposed_answer: `Zone ${index}`,
    proposal_verified: true,
    evidence: [{ kind: "id", value: `z${index}`, strength: "strong" }]
  }));
}

function draft(overrides = {}) {
  return {
    draft_id: "draft-1",
    route: "automatic",
    ontology: "auto",
    expected_zone_count: null,
    preview_url: "/map-imports/draft-1/preview.svg",
    asset_sha256: "abc",
    preview_manifest: { schema_version: 2, zones: [] },
    summary: {
      zone_count: 3,
      multipart_zone_count: 0,
      hit_shape_count: 0,
      removed_text_count: 0
    },
    selection_required: false,
    selected_interpretation_id: "i-1",
    interpretations: [{
      id: "i-1",
      title: "Pays et territoires",
      ontology: "iso3166-alpha2",
      selectable: true,
      zone_count: 3
    }],
    zones: zones(3),
    diagnostics: [],
    acknowledgements: [],
    readiness_blockers: [],
    can_commit: true,
    ...overrides
  };
}

function renderWorkspace(props = {}) {
  return render(
    <MapImportResultWorkspace
      initialDraft={draft()}
      initialName="Europe"
      onExit={vi.fn()}
      onImported={vi.fn()}
      onOpenRepair={vi.fn()}
      {...props}
    />
  );
}

describe("MapImportResultWorkspace", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("creates a ready map without any technical interaction", async () => {
    commitMapImport.mockResolvedValue({ group: { id: 7 }, zones: [] });
    const onImported = vi.fn();
    renderWorkspace({ onImported });

    expect(
      screen.getByText("3 zones détectées — la carte est prête.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/s000001/)).not.toBeInTheDocument();
    expect(screen.queryByText(/id:z0/)).not.toBeInTheDocument();
    expect(screen.queryByText("Type de carte")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Créer la carte" }));
    await waitFor(() => {
      expect(commitMapImport).toHaveBeenCalledWith("draft-1", "Europe");
      expect(onImported).toHaveBeenCalledWith({ group: { id: 7 }, zones: [] });
    });
  });

  it("commits the edited map name", async () => {
    commitMapImport.mockResolvedValue({ group: { id: 8 }, zones: [] });
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Nom de la carte"), {
      target: { value: "  Pays d’Europe  " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Créer la carte" }));

    await waitFor(() => {
      expect(commitMapImport).toHaveBeenCalledWith("draft-1", "Pays d’Europe");
    });
  });

  it("offers simplified layer cards and refreshes the preview on selection", async () => {
    const choice = draft({
      route: "assisted",
      can_commit: false,
      selection_required: true,
      selected_interpretation_id: null,
      interpretations: [
        {
          id: "i-provinces",
          title: "Couche structurée « provinces »",
          ontology: "generic",
          selectable: true,
          zone_count: 32
        },
        {
          id: "i-capitals",
          title: "Capitales — un marqueur par identifiant",
          ontology: "country-capitals",
          selectable: true,
          zone_count: 32
        }
      ]
    });
    patchMapImport.mockResolvedValue(draft({
      asset_sha256: "def",
      selected_interpretation_id: "i-capitals"
    }));
    renderWorkspace({ initialDraft: choice });

    expect(
      screen.getByText("Nous avons trouvé plusieurs cartes possibles.")
    ).toBeInTheDocument();
    expect(screen.getByText("Provinces")).toBeInTheDocument();
    expect(screen.getByTestId("preview").textContent).toContain("v=abc");

    fireEvent.click(screen.getByRole("button", { name: /Capitales/ }));
    await waitFor(() => {
      expect(patchMapImport).toHaveBeenCalledWith("draft-1", {
        selected_interpretation_id: "i-capitals"
      });
    });
    expect(await screen.findByText("3 zones détectées — la carte est prête."))
      .toBeInTheDocument();
    expect(screen.getByTestId("preview").textContent).toContain("v=def");
  });

  it("explains a blocked import and opens the repair mode", async () => {
    const onOpenRepair = vi.fn();
    renderWorkspace({
      initialDraft: draft({
        route: "assisted",
        can_commit: false,
        diagnostics: [{
          code: "svg.incomplete_semantic_layer",
          severity: "error",
          stage: "detect"
        }],
        readiness_blockers: ["repair.required_unresolved"]
      }),
      onOpenRepair
    });

    expect(screen.getByText("À vérifier")).toBeInTheDocument();
    expect(screen.getByText(
      "Les zones reconnues ne couvrent qu’une partie de la carte."
    )).toBeInTheDocument();
    expect(screen.queryByText("svg.incomplete_semantic_layer"))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Corriger les zones" }));
    expect(onOpenRepair).toHaveBeenCalledWith(
      expect.objectContaining({ draft_id: "draft-1" }),
      "Europe"
    );
  });

  it("blocks creation until the warning next to it is acknowledged", async () => {
    patchMapImport.mockResolvedValue(draft({
      acknowledgements: ["svg.labels_removed"],
      diagnostics: [{
        code: "svg.labels_removed",
        severity: "warning",
        stage: "sanitize",
        requires_acknowledgement: true
      }]
    }));
    renderWorkspace({
      initialDraft: draft({
        can_commit: false,
        diagnostics: [{
          code: "svg.labels_removed",
          severity: "warning",
          stage: "sanitize",
          requires_acknowledgement: true
        }]
      })
    });

    expect(screen.getByRole("button", { name: "Créer la carte" })).toBeDisabled();
    const checkbox = screen.getByRole("checkbox");
    expect(
      screen.getByText("Les libellés texte visibles ont été retirés de la carte.")
    ).toBeInTheDocument();

    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(patchMapImport).toHaveBeenCalledWith("draft-1", {
        acknowledgements: ["svg.labels_removed"]
      });
    });
    expect(
      await screen.findByRole("button", { name: "Créer la carte" })
    ).toBeEnabled();
  });

  it("keeps an unsupported SVG out of the repair path", () => {
    const onExit = vi.fn();
    renderWorkspace({
      initialDraft: draft({
        route: "manual",
        can_commit: false,
        diagnostics: [{
          code: "svg.embedded_raster_requires_manual",
          severity: "warning",
          stage: "parse"
        }]
      }),
      onExit
    });

    expect(
      screen.getByText("Ce fichier est une image, pas une carte découpée.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Corriger les zones" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choisir un autre SVG" }));
    expect(onExit).toHaveBeenCalled();
  });

  it("reruns the analysis from the collapsed technical details", async () => {
    patchMapImport.mockResolvedValue(draft({ ontology: "generic" }));
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Détails techniques" }));
    fireEvent.change(screen.getByLabelText("Type de carte"), {
      target: { value: "generic" }
    });

    await waitFor(() => {
      expect(patchMapImport).toHaveBeenCalledWith("draft-1", {
        ontology: "generic"
      });
    });
  });

  it("returns to Manage without touching the draft", () => {
    const onExit = vi.fn();
    renderWorkspace({ onExit });

    fireEvent.click(screen.getByRole("button", { name: "Revenir à Manage" }));
    expect(onExit).toHaveBeenCalled();
    expect(commitMapImport).not.toHaveBeenCalled();
  });
});
