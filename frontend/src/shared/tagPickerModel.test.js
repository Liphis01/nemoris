import { describe, expect, it } from "vitest";

import { buildTagPickerModel } from "./tagPickerModel";


const PARENTS = {
  technology: ["science"],
  computing: ["technology"],
  linux: ["computing"],
  biology: ["science"]
};

const LABELS = {
  science: "Sciences",
  technology: "Technologie",
  computing: "Informatique",
  linux: "Linux",
  biology: "Biologie",
  shrek: "Shrek",
  cuisine: "Cuisine",
  debian: "Debian"
};

const NODES = {
  science: { id: "science", kind: "core", classification: "root", hidden: false },
  technology: { id: "technology", kind: "custom", classification: "placed", hidden: false },
  computing: { id: "computing", kind: "custom", classification: "placed", hidden: false },
  linux: { id: "linux", kind: "custom", classification: "placed", hidden: false },
  biology: { id: "biology", kind: "custom", classification: "placed", hidden: false },
  shrek: { id: "shrek", kind: "custom", classification: "unplaced", hidden: false },
  cuisine: { id: "cuisine", kind: "custom", classification: "root", hidden: false },
  debian: { id: "debian", kind: "custom", classification: "placed", hidden: false, suggestion_key: "seed:debian" }
};


function model(overrides = {}) {
  return buildTagPickerModel({
    query: "",
    branch: null,
    appliedTags: [],
    parents: PARENTS,
    labels: LABELS,
    nodes: NODES,
    usage: { linux: 4 },
    suggestions: [
      { key: "seed:linux", label: "Linux", suggested_parent_id: "computing" },
      { key: "seed:debian", label: "Debian", suggested_parent_id: "computing" }
    ],
    allowCreate: true,
    ...overrides
  });
}


describe("buildTagPickerModel", () => {
  it("shows only intentional browse roots when empty", () => {
    expect(model().rows.map(row => row.tagId)).toEqual(["cuisine", "science"]);
    expect(model().rows.map(row => row.tagId)).not.toContain("shrek");
  });

  it("groups search results, seed suggestions and creation commands", () => {
    const result = model({ query: "lin" });

    expect(result.groups.map(group => group.id)).toEqual(["existing", "suggestions", "create"]);
    expect(result.groups[0].rows[0]).toEqual(expect.objectContaining({
      type: "existing",
      tagId: "linux",
      breadcrumb: "Sciences › Technologie › Informatique"
    }));
    expect(result.groups[1].rows[0]).toEqual(expect.objectContaining({
      type: "suggestion",
      suggestionKey: "seed:linux",
      parentId: "computing"
    }));
    expect(result.groups[2].rows[0]).toEqual(expect.objectContaining({
      type: "create",
      label: "lin"
    }));
  });

  it("finds unplaced custom tags by label only while searching", () => {
    expect(model({ query: "shr" }).rows.map(row => row.tagId)).toContain("shrek");
  });

  it("suppresses free creation for exact existing labels", () => {
    expect(model({ query: "Linux" }).groups.map(group => group.id)).not.toContain("create");
  });

  it("omits materialized seed suggestions", () => {
    const suggestions = model({ query: "Debian" }).groups.find(group => group.id === "suggestions");

    expect(suggestions).toBeUndefined();
  });

  it("does not offer applied tags again", () => {
    expect(model({ query: "lin", appliedTags: ["linux"] }).rows.map(row => row.tagId))
      .not.toContain("linux");
  });

  it("adds a back command and branch children while browsing a branch", () => {
    const result = model({ branch: "science" });

    expect(result.rows[0]).toEqual(expect.objectContaining({ type: "back" }));
    expect(result.rows.map(row => row.tagId)).toEqual([undefined, "biology", "technology"]);
  });
});
