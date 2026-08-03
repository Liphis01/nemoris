import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyMapImportRepairAction,
  commitMapImport,
  getMapImportRepair,
  patchMapImport,
  startMapImportRepair
} from "../../../api/maps";
import MapRepairWorkspace from "./MapRepairWorkspace";


vi.mock("../../../api/maps", () => ({
  applyMapImportRepairAction: vi.fn(),
  cancelMapImport: vi.fn(),
  commitMapImport: vi.fn(),
  getMapImport: vi.fn(),
  getMapImportRepair: vi.fn(),
  patchMapImport: vi.fn(),
  startMapImportRepair: vi.fn()
}));

vi.mock("./SvgRepairCanvas", () => ({
  default: ({ onSelectionChange }) => (
    <button type="button" onClick={() => onSelectionChange(["p000001"])}>
      Canevas d’inspection
    </button>
  )
}));

vi.mock("../../map/components/SvgMap", () => ({
  default: () => <div>Résultat SVG</div>
}));


const draft = {
  draft_id: "draft-1",
  repair_available: true,
  selected_interpretation_id: "i-main",
  interpretations: [
    {
      id: "i-main",
      title: "Provinces",
      selectable: true,
      zone_count: 2
    },
    {
      id: "i-other",
      title: "Autre couche",
      selectable: true,
      zone_count: 3
    }
  ]
};


function repair(overrides = {}) {
  return {
    draft_id: "draft-1",
    repair_version: 1,
    revision: 1,
    active_interpretation_id: "i-main",
    branch_interpretation_ids: ["i-main"],
    inspection_url: "/map-imports/draft-1/inspection.svg",
    preview_url: "/map-imports/draft-1/preview.svg",
    preview_manifest: {
      schema_version: 2,
      zones: [
        {
          code: "A",
          shape_ids: ["s000001"],
          hit_shape_ids: [],
          source_keys: ["id:A"]
        },
        {
          code: "B",
          shape_ids: ["s000002"],
          hit_shape_ids: [],
          source_keys: ["id:B"]
        }
      ]
    },
    summary: {
      zone_count: 2,
      assigned_shape_count: 2,
      required_unresolved_count: 0,
      optional_unresolved_count: 0,
      decoration_count: 0,
      label_count: 0,
      excluded_count: 0,
      multipart_zone_count: 0
    },
    readiness_blockers: [],
    can_commit: true,
    can_undo: false,
    can_redo: false,
    zones: [
      {
        zone_id: "d000001",
        code: "A",
        shape_refs: ["p000001"],
        proposed_answer: "",
        source_keys: ["id:A"]
      },
      {
        zone_id: "d000002",
        code: "B",
        shape_refs: ["p000002"],
        proposed_answer: "",
        source_keys: ["id:B"]
      }
    ],
    shapes: [
      {
        ref: "p000001",
        role: "zone",
        zone_id: "d000001",
        risk: null,
        evidence: [{ kind: "id", value: "A" }],
        selection_set_ids: ["style:a"]
      },
      {
        ref: "p000002",
        role: "zone",
        zone_id: "d000002",
        risk: null,
        evidence: [{ kind: "id", value: "B" }],
        selection_set_ids: ["style:a"]
      }
    ],
    selection_sets: [
      {
        id: "style:a",
        kind: "style",
        label: "Même style de peinture",
        shape_refs: ["p000001", "p000002"]
      }
    ],
    diagnostics: [],
    acknowledgements: [],
    expected_zone_count: 2,
    ...overrides
  };
}


describe("MapRepairWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMapImportRepair.mockResolvedValue(repair());
    patchMapImport.mockResolvedValue({});
    startMapImportRepair.mockResolvedValue(repair());
  });

  afterEach(cleanup);

  it("selects shapes, applies a role, and persists keyboard undo", async () => {
    applyMapImportRepairAction
      .mockResolvedValueOnce(repair({
        revision: 2,
        can_undo: true,
        shapes: [
          {
            ref: "p000001",
            role: "decoration",
            zone_id: null,
            risk: null,
            evidence: [{ kind: "id", value: "A" }],
            selection_set_ids: ["style:a"]
          },
          repair().shapes[1]
        ]
      }))
      .mockResolvedValueOnce(repair({ revision: 3 }));

    render(
      <MapRepairWorkspace
        initialDraft={draft}
        groupName="Carte test"
        onExit={vi.fn()}
        onImported={vi.fn()}
      />
    );
    expect(await screen.findByText("Réparer la structure")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /p000001 · A/ }));
    fireEvent.click(screen.getByRole("button", { name: "Décoration" }));
    await waitFor(() => {
      expect(applyMapImportRepairAction).toHaveBeenCalledWith(
        "draft-1",
        1,
        {
          type: "set_role",
          shape_refs: ["p000001"],
          role: "decoration"
        }
      );
      expect(screen.getByText(/Enregistré · révision 2/)).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => {
      expect(applyMapImportRepairAction).toHaveBeenLastCalledWith(
        "draft-1", 2, { type: "undo" }
      );
    });
  });

  it("keeps interpretation branches and exposes bulk selection", async () => {
    startMapImportRepair.mockResolvedValue(repair({
      revision: 2,
      active_interpretation_id: "i-other",
      branch_interpretation_ids: ["i-main", "i-other"]
    }));
    render(
      <MapRepairWorkspace
        initialDraft={draft}
        groupName="Carte test"
        onExit={vi.fn()}
        onImported={vi.fn()}
      />
    );
    await screen.findByText("Réparer la structure");

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "i-other" }
    });
    await waitFor(() => {
      expect(startMapImportRepair).toHaveBeenCalledWith(
        "draft-1", "i-other"
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /p000001 · A/ }));
    fireEvent.click(screen.getByRole("button", {
      name: /Même style de peinture · 2/
    }));
    expect(screen.getByText("2 forme(s) · 2 zone(s)")).toBeInTheDocument();
  });

  it("commits only a ready repair and returns the atomic group payload", async () => {
    const result = {
      group: { id: 12, name: "Carte test" },
      zones: [{ id: 90, data: { code: "A" } }]
    };
    commitMapImport.mockResolvedValue(result);
    const onImported = vi.fn();
    render(
      <MapRepairWorkspace
        initialDraft={draft}
        groupName="Carte test"
        onExit={vi.fn()}
        onImported={onImported}
      />
    );
    await screen.findByText("Réparer la structure");

    fireEvent.click(screen.getByRole("button", {
      name: "Importer 2 zones"
    }));
    await waitFor(() => {
      expect(commitMapImport).toHaveBeenCalledWith("draft-1", "Carte test");
      expect(onImported).toHaveBeenCalledWith(result);
    });
  });

  it("serializes structural mutations and reloads the confirmed revision on failure", async () => {
    let resolveFirst;
    applyMapImportRepairAction
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveFirst = resolve;
      }))
      .mockRejectedValueOnce(new Error("Révision périmée"));
    getMapImportRepair
      .mockResolvedValueOnce(repair())
      .mockResolvedValueOnce(repair({ revision: 7 }));

    render(
      <MapRepairWorkspace
        initialDraft={draft}
        groupName="Carte test"
        onExit={vi.fn()}
        onImported={vi.fn()}
      />
    );
    await screen.findByText("Réparer la structure");
    fireEvent.click(screen.getByRole("button", { name: /p000001 · A/ }));
    fireEvent.click(screen.getByRole("button", { name: "Décoration" }));
    await waitFor(() => {
      expect(applyMapImportRepairAction).toHaveBeenCalledTimes(1);
    });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    expect(applyMapImportRepairAction).toHaveBeenCalledTimes(1);
    resolveFirst(repair({ revision: 2, can_undo: true }));
    await waitFor(() => {
      expect(applyMapImportRepairAction).toHaveBeenLastCalledWith(
        "draft-1", 2, { type: "undo" }
      );
      expect(screen.getByText("Révision périmée")).toBeInTheDocument();
      expect(screen.getByText(/révision 7/)).toBeInTheDocument();
    });
  });
});
