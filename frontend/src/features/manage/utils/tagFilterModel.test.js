import { describe, expect, it } from "vitest";

import { buildTagFilterModel } from "./tagFilterModel";


const PARENTS = {
  technology: ["science"],
  computing: ["technology"],
  linux: ["computing"],
  biology: ["science"],
  europe: ["geography"]
};

const LABELS = {
  science: "Sciences",
  technology: "Technologie",
  computing: "Informatique",
  linux: "Linux",
  biology: "Biologie",
  geography: "Géographie",
  europe: "Europe",
  shrek: "Shrek",
  cuisine: "Cuisine",
  hidden: "Masqué"
};

const NODES = {
  science: { id: "science", kind: "core", classification: "root", hidden: false },
  technology: { id: "technology", kind: "custom", classification: "placed", hidden: false },
  computing: { id: "computing", kind: "custom", classification: "placed", hidden: false },
  linux: { id: "linux", kind: "custom", classification: "placed", hidden: false },
  biology: { id: "biology", kind: "custom", classification: "placed", hidden: false },
  geography: { id: "geography", kind: "core", classification: "root", hidden: false },
  europe: { id: "europe", kind: "custom", classification: "placed", hidden: false },
  shrek: { id: "shrek", kind: "custom", classification: "unplaced", hidden: false },
  cuisine: { id: "cuisine", kind: "custom", classification: "root", hidden: false },
  hidden: { id: "hidden", kind: "core", classification: "root", hidden: true }
};


function model(overrides = {}) {
  return buildTagFilterModel({
    query: "",
    branch: null,
    selectedTag: "",
    availableTags: ["linux", "shrek"],
    parents: PARENTS,
    labels: LABELS,
    nodes: NODES,
    usage: { linux: 4, shrek: 1 },
    totalUsage: { science: 4, technology: 4, computing: 4, linux: 4, shrek: 1 },
    ...overrides
  });
}


describe("buildTagFilterModel", () => {
  it("excludes unplaced tags from empty browse mode", () => {
    expect(model().rows.map(row => row.tagId)).not.toContain("shrek");
  });

  it("shows used roots and ancestors of used descendants while browsing", () => {
    expect(model().rows.map(row => row.tagId)).toEqual(["science"]);
    expect(model({ branch: "science" }).rows.map(row => row.tagId)).toEqual([undefined, "technology"]);
    expect(model({ branch: "technology" }).rows.map(row => row.tagId)).toEqual([undefined, "computing"]);
  });

  it("search includes unplaced used tags", () => {
    expect(model({ query: "shr" }).rows.map(row => row.tagId)).toEqual(["shrek"]);
  });

  it("keeps hidden roots hidden", () => {
    expect(model({ availableTags: ["hidden"] }).rows.map(row => row.tagId)).not.toContain("hidden");
  });

  it("uses rolled-up counts for parent rows", () => {
    expect(model().rows[0]).toEqual(expect.objectContaining({
      tagId: "science",
      count: 4
    }));
  });

  it("search can find unused visible tags even though browse hides them", () => {
    expect(model({ query: "cuisine" }).rows.map(row => row.tagId)).toEqual(["cuisine"]);
  });
});
