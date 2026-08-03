import { describe, expect, it } from "vitest";

import { findSimilarPairs } from "./tagDuplicates";


const identity = (key) => key;


describe("findSimilarPairs", () => {
  it("surfaces near-duplicates without merging anything", () => {
    const pairs = findSimilarPairs(
      ["etats-unis", "etats-uni", "linux"],
      identity
    );

    expect(pairs).toHaveLength(1);
    expect([pairs[0].a, pairs[0].b].sort()).toEqual(["etats-uni", "etats-unis"]);
  });

  it("ignores short keys where one edit means a different word", () => {
    // "bd" and "bo" are one edit apart and completely unrelated.
    expect(findSimilarPairs(["bd", "bo"], identity)).toEqual([]);
  });

  it("does not pair a tag with itself", () => {
    expect(findSimilarPairs(["geography"], identity)).toEqual([]);
  });

  it("leaves genuinely different tags alone", () => {
    expect(findSimilarPairs(["geography", "chemistry", "linux"], identity))
      .toEqual([]);
  });

  it("attaches display labels for the UI", () => {
    const pairs = findSimilarPairs(
      ["elephants", "elephant"],
      (key) => (key === "elephants" ? "Éléphants" : "Elephant")
    );

    expect(pairs[0].labelA).toBeTruthy();
    expect(pairs[0].labelB).toBeTruthy();
  });

  it("caps how many suggestions it returns", () => {
    const keys = ["tag-aaa", "tag-aab", "tag-aac", "tag-aad", "tag-aae"];

    expect(findSimilarPairs(keys, identity, 2)).toHaveLength(2);
  });
});
