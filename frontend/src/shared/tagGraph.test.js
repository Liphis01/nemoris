import { describe, expect, it } from "vitest";

import { ancestors, descendants, normalizeKey, wouldCreateCycle } from "./tagGraph";

// Diamond DAG: paris reachable from geography via two paths.
const parents = {
  paris: ["france", "capitals"],
  france: ["europe"],
  capitals: ["geography"],
  europe: ["geography"]
};

describe("tagGraph", () => {
  it("normalizes keys", () => {
    expect(normalizeKey("  Paris ")).toBe("paris");
  });

  it("descendants include self and everything downstream", () => {
    expect(descendants("geography", parents)).toEqual(
      new Set(["geography", "europe", "capitals", "france", "paris"])
    );
    expect(descendants("capitals", parents)).toEqual(
      new Set(["capitals", "paris"])
    );
    expect(descendants("paris", parents)).toEqual(new Set(["paris"]));
  });

  it("ancestors walk every path and dedupe", () => {
    expect(ancestors("paris", parents)).toEqual(
      new Set(["paris", "france", "capitals", "europe", "geography"])
    );
  });

  it("detects cycles before linking", () => {
    // geography is an ancestor of paris, so paris → geography would loop.
    expect(wouldCreateCycle(parents, "geography", "paris")).toBe(true);
    expect(wouldCreateCycle(parents, "paris", "paris")).toBe(true);
    // A fresh edge into an unrelated node is fine.
    expect(wouldCreateCycle(parents, "berlin", "europe")).toBe(false);
  });
});
