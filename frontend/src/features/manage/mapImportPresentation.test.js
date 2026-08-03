import { describe, expect, it } from "vitest";
import {
  deriveImportState,
  describeDraftListItem,
  describeImport,
  inferMapName,
  simplifyInterpretationTitle
} from "./mapImportPresentation";

function draft(overrides = {}) {
  return {
    draft_id: "draft-1",
    route: "automatic",
    selection_required: false,
    selected_interpretation_id: "i-1",
    can_commit: true,
    interpretations: [{ id: "i-1", title: "Pays et territoires", selectable: true }],
    zones: [],
    diagnostics: [],
    acknowledgements: [],
    readiness_blockers: [],
    summary: { zone_count: 0 },
    ...overrides
  };
}

function zones(count, verified = count) {
  return Array.from({ length: count }, (unused, index) => ({
    code: `z${index}`,
    proposed_answer: `Zone ${index}`,
    proposal_verified: index < verified
  }));
}

describe("inferMapName", () => {
  it("drops the extension and normalises separators", () => {
    expect(inferMapName("fr-departements_2024.svg")).toBe("Fr departements 2024");
  });

  it("uses the last URL segment", () => {
    expect(inferMapName("https://example.test/a/b/spain-provinces.svg"))
      .toBe("Spain provinces");
  });

  it("returns an empty name for an empty source", () => {
    expect(inferMapName("")).toBe("");
  });
});

describe("simplifyInterpretationTitle", () => {
  it("keeps the layer name from a structured title", () => {
    expect(simplifyInterpretationTitle({
      title: "Couche structurée « provinces »",
      ontology: "generic"
    })).toBe("Provinces");
  });

  it("uses a plain ontology label when there is one", () => {
    expect(simplifyInterpretationTitle({
      title: "Capitales — un marqueur par identifiant",
      ontology: "country-capitals"
    })).toBe("Capitales");
  });

  it("falls back to the head of the title", () => {
    expect(simplifyInterpretationTitle({
      title: "Objets géométriques",
      ontology: "generic"
    })).toBe("Objets géométriques");
  });
});

describe("deriveImportState", () => {
  it("maps a committable draft to ready", () => {
    expect(deriveImportState(draft())).toBe("ready");
  });

  it("maps a pending selection to choice", () => {
    expect(deriveImportState(draft({
      route: "assisted",
      selection_required: true,
      selected_interpretation_id: null,
      can_commit: false
    }))).toBe("choice");
  });

  it("maps a raster map to unsupported", () => {
    expect(deriveImportState(draft({ route: "manual", can_commit: false })))
      .toBe("unsupported");
  });

  it("maps a blocking error to correction", () => {
    expect(deriveImportState(draft({
      route: "assisted",
      can_commit: false,
      diagnostics: [{ code: "svg.incomplete_semantic_layer", severity: "error" }]
    }))).toBe("correction");
  });

  it("keeps an unacknowledged warning in the ready state", () => {
    expect(deriveImportState(draft({
      can_commit: false,
      diagnostics: [{
        code: "svg.labels_removed",
        severity: "warning",
        requires_acknowledgement: true
      }]
    }))).toBe("ready");
  });

  it("maps a draft without any usable layer to unsupported", () => {
    expect(deriveImportState(draft({
      route: "assisted",
      can_commit: false,
      interpretations: []
    }))).toBe("unsupported");
  });
});

describe("describeImport", () => {
  it("announces the zone count when ready", () => {
    const result = describeImport(draft({ zones: zones(52) }));
    expect(result.headline).toBe("52 zones détectées — la carte est prête.");
    expect(result.primaryLabel).toBe("Créer la carte");
    expect(result.nameProgress).toBe("");
  });

  it("reports partial name recognition", () => {
    expect(describeImport(draft({ zones: zones(52, 48) })).nameProgress)
      .toBe("48 noms reconnus sur 52");
  });

  it("asks for a layer choice", () => {
    const result = describeImport(draft({
      route: "assisted",
      selection_required: true,
      selected_interpretation_id: null,
      can_commit: false
    }));
    expect(result.headline).toBe("Nous avons trouvé plusieurs cartes possibles.");
    expect(result.primaryAction).toBe("select");
  });

  it("translates blockers into a plain checklist", () => {
    const result = describeImport(draft({
      route: "assisted",
      can_commit: false,
      diagnostics: [{ code: "svg.incomplete_semantic_layer", severity: "error" }],
      readiness_blockers: ["repair.required_unresolved"]
    }));
    expect(result.primaryLabel).toBe("Corriger les zones");
    expect(result.checklist.map(item => item.label)).toEqual([
      "Les zones reconnues ne couvrent qu’une partie de la carte.",
      "Des formes importantes ne sont pas encore attribuées à une zone."
    ]);
  });

  it("explains a raster map without mentioning XML", () => {
    const result = describeImport(draft({
      route: "manual",
      can_commit: false,
      diagnostics: [{
        code: "svg.embedded_raster_requires_manual",
        severity: "warning"
      }]
    }));
    expect(result.primaryLabel).toBe("Choisir un autre SVG");
    expect(result.detail).toContain("image bitmap");
  });
});

describe("describeDraftListItem", () => {
  it("names each saved state", () => {
    expect(describeDraftListItem({ can_commit: true })).toBe("prête");
    expect(describeDraftListItem({ route: "manual" })).toBe("non prise en charge");
    expect(describeDraftListItem({ repair_available: true }))
      .toBe("correction en cours");
    expect(describeDraftListItem({ readiness_blockers: ["repair.no_zones"] }))
      .toBe("correction nécessaire");
    expect(describeDraftListItem({})).toBe("couche à choisir");
  });
});
