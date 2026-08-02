import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTags } from "../api/tags";
import {
  invalidateTags,
  labelForTag,
  loadTags,
  prettifySlug,
  primeTags,
  resetTags
} from "./tagLabels";

vi.mock("../api/tags", () => ({
  getTags: vi.fn()
}));


const TAG_ID = "11111111-1111-4111-8111-111111111111";

function snapshot(label, revision) {
  return {
    revision,
    nodes: [{
      id: TAG_ID,
      label,
      labels: { fr: label },
      default_locale: "fr",
      parents: [],
      direct_count: 0,
      total_count: 0,
      kind: "custom",
      origin: "local",
      pack_ids: [],
      classification: "root",
      hidden: false
    }]
  };
}


describe("prettifySlug", () => {
  beforeEach(() => {
    resetTags();
  });

  it("turns a hyphenated key into readable text", () => {
    expect(prettifySlug("south-america")).toBe("South america");
  });

  it("leaves text that already has spaces alone apart from casing", () => {
    expect(prettifySlug("guerre de cent ans")).toBe("Guerre de cent ans");
  });

  it("keeps accents and existing capitals", () => {
    expect(prettifySlug("Géographie")).toBe("Géographie");
  });

  it("is empty for empty input", () => {
    expect(prettifySlug("")).toBe("");
    expect(prettifySlug(null)).toBe("");
  });
});


describe("labelForTag", () => {
  beforeEach(() => {
    resetTags();
  });

  it("prefers the hierarchy label", () => {
    expect(labelForTag("geography", { geography: "Géographie" }))
      .toBe("Géographie");
  });

  it("looks the label up case-insensitively", () => {
    // Tags carry their own casing until the slug migration lands, so a lookup
    // must not depend on how the tag happened to be typed.
    expect(labelForTag("Géographie", { "géographie": "Géographie" }))
      .toBe("Géographie");
  });

  it("falls back to readable text when no label is known", () => {
    expect(labelForTag("etats-unis", {})).toBe("Etats unis");
  });

  it("falls back when the hierarchy has not loaded yet", () => {
    expect(labelForTag("sciences", undefined)).toBe("Sciences");
  });
});


describe("primeTags", () => {
  beforeEach(() => {
    resetTags();
    vi.clearAllMocks();
  });

  it("lets in-use tags without a hierarchy label keep their own casing", () => {
    primeTags({
      hierarchy: { parents: {}, labels: { sciences: "Sciences" } },
      usage: { sciences: 3, pride: 15 },
      displays: { pride: "Pride" }
    });

    // Exercised through labelForTag with the snapshot the store just built.
    expect(labelForTag("pride", { pride: "Pride" })).toBe("Pride");
  });

  it("never lets a display override a real hierarchy label", () => {
    primeTags({
      hierarchy: { parents: {}, labels: { usa: "États-Unis" } },
      usage: {},
      displays: { usa: "usa" }
    });

    expect(labelForTag("usa", { usa: "États-Unis" })).toBe("États-Unis");
  });

  it("reloads after invalidation instead of keeping a permanent promise cache", async () => {
    getTags
      .mockResolvedValueOnce(snapshot("Premier", 1))
      .mockResolvedValueOnce(snapshot("Deuxième", 2));

    await loadTags();
    expect(labelForTag(TAG_ID)).toBe("Premier");
    await invalidateTags();

    expect(getTags).toHaveBeenCalledTimes(2);
    expect(labelForTag(TAG_ID)).toBe("Deuxième");
  });

  it("does not let an old request overwrite an authoritative action response", async () => {
    let resolveOld;
    getTags.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));

    const oldRequest = loadTags();
    primeTags(snapshot("Action récente", 7));
    resolveOld(snapshot("Réponse périmée", 6));
    await oldRequest;

    expect(labelForTag(TAG_ID)).toBe("Action récente");
  });
});
