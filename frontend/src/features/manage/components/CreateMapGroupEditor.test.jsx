import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitMapImport,
  createMapImportFromFile,
  getMapImport,
  listMapImports,
  patchMapImport
} from "../../../api/maps";
import CreateMapGroupEditor from "./CreateMapGroupEditor";

vi.mock("../../../api/maps", () => ({
  cancelMapImport: vi.fn().mockResolvedValue({ status: "cancelled" }),
  commitMapImport: vi.fn(),
  createMapImportFromFile: vi.fn(),
  createMapImportFromUrl: vi.fn(),
  getMapImport: vi.fn(),
  listMapImports: vi.fn(),
  patchMapImport: vi.fn()
}));

vi.mock("../../map/components/SvgMap", () => ({
  default: ({ onSelect }) => (
    <button type="button" onClick={() => onSelect("fr-c")}>
      Aperçu interactif
    </button>
  )
}));

const interpretations = [
  {
    id: "i-countries",
    title: "Pays et territoires",
    adapter: "jetpunk-id-class-v1",
    ontology: "iso3166-alpha2",
    strength: "strong",
    automatic_eligible: true,
    selectable: true,
    zone_count: 2,
    shape_count: 2,
    unassigned_shape_count: 2,
    verified_label_count: 2,
    reason_codes: ["jetpunk.country_selectors"]
  },
  {
    id: "i-capitals",
    title: "Capitales — un marqueur par identifiant",
    adapter: "jetpunk-id-class-v1",
    ontology: "country-capitals",
    strength: "strong",
    automatic_eligible: false,
    selectable: true,
    zone_count: 2,
    shape_count: 2,
    unassigned_shape_count: 2,
    verified_label_count: 2,
    reason_codes: ["jetpunk.capital_ids"]
  }
];

function draft(overrides = {}) {
  return {
    draft_id: "draft-1",
    status: "analyzed",
    route: "assisted",
    preview_url: "/map-imports/draft-1/preview.svg",
    preview_manifest: {
      schema_version: 2,
      zones: [
        {
          code: "fr",
          shape_ids: ["s000001"],
          hit_shape_ids: [],
          source_keys: ["id:fr"]
        }
      ]
    },
    summary: {
      zone_count: 2,
      multipart_zone_count: 0,
      hit_shape_count: 0,
      removed_text_count: 0
    },
    interpretations,
    selection_required: true,
    selected_interpretation_id: null,
    zones: [
      {
        code: "fr",
        shape_ids: ["s000001"],
        hit_shape_ids: [],
        source_keys: ["id:fr"],
        proposed_answer: "France",
        proposed_aliases: [],
        proposal_verified: true,
        evidence: [{ kind: "ontology", value: "fr", strength: "strong" }]
      }
    ],
    diagnostics: [],
    acknowledgements: [],
    can_commit: false,
    ...overrides
  };
}

describe("CreateMapGroupEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMapImports.mockResolvedValue({ drafts: [] });
  });

  afterEach(cleanup);

  it("chooses a detected layer, inspects evidence, and commits it", async () => {
    createMapImportFromFile.mockResolvedValue(draft());
    patchMapImport.mockResolvedValue(draft({
      selection_required: false,
      selected_interpretation_id: "i-capitals",
      can_commit: true,
      zones: [
        {
          code: "fr-c",
          shape_ids: ["s000001"],
          hit_shape_ids: [],
          source_keys: ["id:fr-c"],
          proposed_answer: "Paris",
          proposed_aliases: [],
          proposal_verified: true,
          evidence: [
            { kind: "ontology", value: "fr-c", strength: "strong" }
          ]
        },
        {
          code: "de-c",
          shape_ids: ["s000002"],
          hit_shape_ids: [],
          source_keys: ["id:de-c"],
          proposed_answer: "Berlin",
          proposed_aliases: [],
          proposal_verified: true,
          evidence: [
            { kind: "ontology", value: "de-c", strength: "strong" }
          ]
        }
      ]
    }));
    commitMapImport.mockResolvedValue({ group: { id: 7 }, zones: [] });
    const onImported = vi.fn();

    render(
      <CreateMapGroupEditor
        groupDraft={{ name: "Capitales", type_group: "map" }}
        setGroupDraft={vi.fn()}
        onCancel={vi.fn()}
        onImported={onImported}
      />
    );

    fireEvent.change(screen.getByLabelText("Type de carte"), {
      target: { value: "country-capitals" }
    });
    fireEvent.change(screen.getByLabelText("Fichier SVG"), {
      target: {
        files: [new File(["<svg/>"], "map.svg", { type: "image/svg+xml" })]
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyser la carte" }));

    await waitFor(() => {
      expect(createMapImportFromFile).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({ ontology: "country-capitals" })
      );
    });
    expect(await screen.findByText("Pays et territoires")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", {
      name: /Capitales — un marqueur par identifiant/
    }));
    await waitFor(() => {
      expect(patchMapImport).toHaveBeenCalledWith("draft-1", {
        selected_interpretation_id: "i-capitals"
      });
    });
    expect(await screen.findByText("Paris")).toBeInTheDocument();
    expect(screen.getByText("nom vérifié")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {
      name: "Importer et ouvrir l’éditeur"
    }));
    await waitFor(() => {
      expect(commitMapImport).toHaveBeenCalledWith("draft-1", "Capitales");
      expect(onImported).toHaveBeenCalledWith({ group: { id: 7 }, zones: [] });
    });
  });

  it("opens an assisted draft in the structural repair workspace", async () => {
    createMapImportFromFile.mockResolvedValue(draft({
      repair_available: false
    }));
    const onOpenRepair = vi.fn();

    render(
      <CreateMapGroupEditor
        groupDraft={{ name: "Carte à réparer", type_group: "map" }}
        setGroupDraft={vi.fn()}
        onCancel={vi.fn()}
        onImported={vi.fn()}
        onOpenRepair={onOpenRepair}
      />
    );

    fireEvent.change(screen.getByLabelText("Fichier SVG"), {
      target: {
        files: [new File(["<svg/>"], "map.svg", { type: "image/svg+xml" })]
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyser la carte" }));
    await screen.findByRole("button", { name: "Corriger la structure" });

    fireEvent.click(screen.getByRole("button", {
      name: "Corriger la structure"
    }));
    expect(onOpenRepair).toHaveBeenCalledWith(
      expect.objectContaining({ draft_id: "draft-1" }),
      "Carte à réparer"
    );
  });

  it("lists and resumes a device-local repair draft", async () => {
    listMapImports.mockResolvedValue({
      drafts: [{
        draft_id: "draft-1",
        name: "Colombie",
        updated_at: new Date().toISOString(),
        repair_available: true,
        repair_summary: { zone_count: 34 },
        readiness_blockers: ["repair.required_unresolved"],
        can_commit: false
      }]
    });
    getMapImport.mockResolvedValue(draft({ repair_available: true }));
    const onOpenRepair = vi.fn();
    const setGroupDraft = vi.fn();
    render(
      <CreateMapGroupEditor
        groupDraft={{ name: "", type_group: "map" }}
        setGroupDraft={setGroupDraft}
        onCancel={vi.fn()}
        onImported={vi.fn()}
        onOpenRepair={onOpenRepair}
      />
    );

    expect(await screen.findByText("Colombie")).toBeInTheDocument();
    expect(screen.getByText(/34 zones · 1 blocage/)).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", { name: /Colombie/ })[0]
    );
    await waitFor(() => {
      expect(getMapImport).toHaveBeenCalledWith("draft-1");
      expect(setGroupDraft).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Colombie" })
      );
      expect(onOpenRepair).toHaveBeenCalledWith(
        expect.objectContaining({ draft_id: "draft-1" }),
        "Colombie"
      );
    });
  });
});
