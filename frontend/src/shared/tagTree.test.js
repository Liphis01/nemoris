import { beforeEach, describe, expect, it } from "vitest";

import { primeTags, resetTags } from "./tagLabels";
import {
  allTagKeys,
  ancestorPath,
  breadcrumbLabel,
  browseLevel,
  childrenMap,
  hasChildren,
  isBrowseRoot,
  rootKeys,
  searchTags
} from "./tagTree";


const HIERARCHY = {
  parents: {
    computing: ["technology"],
    technology: ["science"],
    linux: ["computing"],
    biology: ["science"],
    europe: ["geography"],
    "united-states": ["geography"]
  },
  labels: {
    science: "Sciences",
    technology: "Technologie",
    computing: "Informatique",
    linux: "Linux",
    biology: "Biologie",
    geography: "Géographie",
    europe: "Europe",
    "united-states": "États-Unis",
    shrek: "Shrek",
    cuisine: "Cuisine",
    hidden: "Masqué"
  },
  nodes: {
    science: { id: "science", kind: "core", classification: "root", hidden: false },
    technology: { id: "technology", kind: "custom", classification: "placed", hidden: false },
    computing: { id: "computing", kind: "custom", classification: "placed", hidden: false },
    linux: { id: "linux", kind: "custom", classification: "placed", hidden: false },
    biology: { id: "biology", kind: "custom", classification: "placed", hidden: false },
    geography: { id: "geography", kind: "core", classification: "root", hidden: false },
    europe: { id: "europe", kind: "custom", classification: "placed", hidden: false },
    "united-states": { id: "united-states", kind: "custom", classification: "placed", hidden: false },
    shrek: { id: "shrek", kind: "custom", classification: "unplaced", hidden: false },
    cuisine: { id: "cuisine", kind: "custom", classification: "root", hidden: false },
    hidden: { id: "hidden", kind: "core", classification: "root", hidden: true }
  }
};

const CONTEXT = {
  keys: allTagKeys(HIERARCHY),
  parents: HIERARCHY.parents,
  labels: HIERARCHY.labels,
  nodes: HIERARCHY.nodes
};


describe("childrenMap", () => {
  it("inverts the parent map", () => {
    expect(childrenMap(HIERARCHY.parents).science.sort())
      .toEqual(["biology", "technology"]);
  });

  it("is empty for an empty hierarchy", () => {
    expect(childrenMap({})).toEqual({});
    expect(childrenMap(undefined)).toEqual({});
  });
});


describe("allTagKeys", () => {
  it("includes parents that are nobody's child", () => {
    expect(allTagKeys(HIERARCHY).has("geography")).toBe(true);
  });

  it("folds in tags that were never filed", () => {
    const keys = allTagKeys(HIERARCHY, ["Shrek", "  "]);

    expect(keys.has("Shrek")).toBe(true);
    expect(keys.has("")).toBe(false);
  });
});


describe("rootKeys", () => {
  it("returns only intentional browse roots when node metadata is available", () => {
    expect(rootKeys(CONTEXT.keys, HIERARCHY.parents, HIERARCHY.nodes).sort())
      .toEqual(["cuisine", "geography", "science"]);
  });

  it("does not treat hidden roots or unplaced custom tags as browse roots", () => {
    expect(isBrowseRoot("science", HIERARCHY.nodes)).toBe(true);
    expect(isBrowseRoot("cuisine", HIERARCHY.nodes)).toBe(true);
    expect(isBrowseRoot("shrek", HIERARCHY.nodes)).toBe(false);
    expect(isBrowseRoot("hidden", HIERARCHY.nodes)).toBe(false);
  });
});


describe("ancestorPath", () => {
  it("walks from the root down to the immediate parent", () => {
    expect(ancestorPath("linux", HIERARCHY.parents))
      .toEqual(["science", "technology", "computing"]);
  });

  it("is empty for a root", () => {
    expect(ancestorPath("science", HIERARCHY.parents)).toEqual([]);
  });

  it("does not loop on a cyclic map", () => {
    // Cycles are rejected on save, but a hand-edited or synced document must
    // not be able to hang the picker.
    expect(ancestorPath("a", { a: ["b"], b: ["a"] })).toEqual(["b"]);
  });

  it("renders a readable breadcrumb", () => {
    expect(breadcrumbLabel("linux", HIERARCHY.parents, HIERARCHY.labels))
      .toBe("Sciences › Technologie › Informatique");
  });
});


describe("browseLevel", () => {
  it("shows the roots when nothing is drilled into", () => {
    expect(browseLevel(null, CONTEXT)).toEqual(["cuisine", "geography", "science"]);
  });

  it("shows the children of the drilled node, sorted by label", () => {
    expect(browseLevel("science", CONTEXT)).toEqual(["biology", "technology"]);
  });

  it("is empty for a leaf", () => {
    expect(browseLevel("linux", CONTEXT)).toEqual([]);
  });

  it("reports whether a node can be drilled into", () => {
    expect(hasChildren("science", HIERARCHY.parents)).toBe(true);
    expect(hasChildren("linux", HIERARCHY.parents)).toBe(false);
  });
});


describe("searchTags", () => {
  beforeEach(() => {
    resetTags();
  });

  it("is empty for an empty query", () => {
    expect(searchTags("", CONTEXT)).toEqual([]);
    expect(searchTags("   ", CONTEXT)).toEqual([]);
  });

  it("matches on the displayed label", () => {
    expect(searchTags("linu", CONTEXT)).toEqual(["linux"]);
  });

  it("matches on the label, since stored tags are opaque keys", () => {
    // "united-states" contains none of the letters someone would type.
    expect(searchTags("États", CONTEXT)).toEqual(["united-states"]);
  });

  it("still finds unplaced custom tags by label", () => {
    expect(searchTags("shr", CONTEXT)).toEqual(["shrek"]);
  });

  it("puts an exact match first", () => {
    const results = searchTags("science", CONTEXT);

    expect(results[0]).toBe("science");
  });

  it("ranks shallower nodes above the leaves beneath them", () => {
    primeTags({
      hierarchy: {
        parents: { "web-dev": ["dev"] },
        labels: { dev: "Dev", "web-dev": "Web dev" }
      },
      usage: {}
    });

    const context = {
      keys: allTagKeys({
        parents: { "web-dev": ["dev"] },
        labels: { dev: "Dev", "web-dev": "Web dev" }
      }),
      parents: { "web-dev": ["dev"] },
      labels: { dev: "Dev", "web-dev": "Web dev" }
    };

    expect(searchTags("dev", context)).toEqual(["dev", "web-dev"]);
  });
});
