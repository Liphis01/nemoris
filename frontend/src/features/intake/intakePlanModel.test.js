import { describe, expect, it } from "vitest";

import {
  deckMeta,
  dropIndex,
  menuIntakeLabel,
  moveDeckInSnapshot,
  plural,
  quotaExplanation
} from "./intakePlanModel";


function deck(key, overrides = {}) {
  return {
    key,
    name: key.toUpperCase(),
    type_group: "text",
    paused: false,
    section: "next",
    position: null,
    counts: { unseen: 5, suspended: 0 },
    today_count: 0,
    eta: { starts: null, finishes: null },
    ...overrides
  };
}


function breakdown(overrides = {}) {
  return {
    pace_tier: "intensif",
    daily_target: 80,
    new_min: 5,
    new_max: 40,
    review_load: 20,
    saturation: 0.25,
    new_fill: 34,
    new_budget_tuned: 34,
    ramp_ceiling: null,
    new_budget: 34,
    introduced_today: 0,
    introduced_yesterday: 0,
    wip_count: 10,
    wip_cap: 2000,
    wip_factor: 1,
    quota: 34,
    ...overrides
  };
}


describe("dropIndex", () => {
  const keys = ["a", "b", "c", "d"];

  it("drops before or after the hovered row", () => {
    expect(dropIndex(keys, "a", "c", "before")).toBe(1);
    expect(dropIndex(keys, "a", "c", "after")).toBe(2);
  });

  it("can reach the very last position", () => {
    // The old queue only ever dropped "before", so the end was unreachable.
    expect(dropIndex(keys, "a", "d", "after")).toBe(3);
  });

  it("returns null for an unknown target", () => {
    expect(dropIndex(keys, "a", "z", "before")).toBeNull();
  });
});


describe("moveDeckInSnapshot", () => {
  it("reorders active decks and recomputes the focus window", () => {
    const snapshot = {
      settings: { focus: 2 },
      decks: [
        deck("a", { section: "focus", position: 1 }),
        deck("b", { section: "focus", position: 2 }),
        deck("c", { section: "next", position: 3 }),
        deck("p", { paused: true, section: "paused" })
      ]
    };

    const moved = moveDeckInSnapshot(snapshot, "c", 0);

    expect(moved.decks.map(item => item.key)).toEqual(["c", "a", "b", "p"]);
    expect(moved.decks.map(item => item.section)).toEqual(
      ["focus", "focus", "next", "paused"]
    );
    expect(moved.decks.map(item => item.position)).toEqual([1, 2, 3, null]);
  });

  it("does not give a window slot to a deck with nothing left to feed", () => {
    const snapshot = {
      settings: { focus: 1 },
      decks: [
        deck("a", { section: "focus", position: 1 }),
        deck("empty", { counts: { unseen: 0, suspended: 3 }, position: 2 })
      ]
    };

    const moved = moveDeckInSnapshot(snapshot, "empty", 0);

    expect(moved.decks.map(item => [item.key, item.section])).toEqual([
      ["empty", "next"],
      ["a", "focus"]
    ]);
  });
});


describe("menuIntakeLabel", () => {
  it("offers to manage today's new questions", () => {
    expect(menuIntakeLabel({ new_count: 5, new_waiting: 500 })).toBe("5 nouvelles · Gérer");
  });

  it("explains a day without new questions", () => {
    expect(menuIntakeLabel({ new_count: 0, new_waiting: 12 })).toBe(
      "0 nouvelle aujourd'hui · Pourquoi ?"
    );
  });

  it("points at paused decks when nothing else is left", () => {
    expect(menuIntakeLabel({ new_count: 0, new_waiting: 0, new_paused: 8 })).toBe(
      "Nouvelles en pause · Gérer"
    );
  });

  it("hides when there is nothing new at all", () => {
    expect(menuIntakeLabel({ new_count: 0, new_waiting: 0, new_paused: 0 })).toBeNull();
    expect(menuIntakeLabel(null)).toBeNull();
  });
});


describe("quotaExplanation", () => {
  it("names the tier and explains a busy day's minimum", () => {
    const lines = quotaExplanation(
      {
        quota: 5,
        count: 5,
        breakdown: breakdown({ review_load: 89, saturation: 1.11, new_fill: 5, new_budget_tuned: 5, new_budget: 5, quota: 5 })
      },
      { waiting: 570 }
    );

    expect(lines[0]).toBe("Rythme Intensif : entre 5 et 40 nouvelles par jour.");
    expect(lines).toContain(
      "89 révisions déjà prévues aujourd'hui (objectif 80) : seulement le minimum du rythme."
    );
  });

  it("explains the saturation breaker", () => {
    const lines = quotaExplanation(
      { quota: 0, count: 0, breakdown: breakdown({ review_load: 130, saturation: 1.62, quota: 0 }) },
      { waiting: 570 }
    );

    expect(lines[1]).toMatch(/^Journée saturée : 130 révisions/);
  });

  it("mentions the ramp limit and today's introductions", () => {
    const lines = quotaExplanation(
      {
        quota: 8,
        count: 8,
        breakdown: breakdown({
          new_budget_tuned: 34,
          ramp_ceiling: 13,
          new_budget: 13,
          introduced_yesterday: 10,
          introduced_today: 5
        })
      },
      { waiting: 570 }
    );

    expect(lines).toContain("Hausse limitée à +25 % par rapport à hier (10 introduites) : 13.");
    expect(lines).toContain("5 déjà introduites aujourd'hui.");
  });

  it("says when paused decks are all that is left", () => {
    const lines = quotaExplanation(
      { quota: 5, count: 0, breakdown: breakdown({ quota: 5 }) },
      { waiting: 0, paused: 40 }
    );

    expect(lines.at(-1)).toBe("Tous les paquets restants sont en pause.");
  });
});


describe("deckMeta", () => {
  it("summarizes a deck in the focus window", () => {
    expect(deckMeta(deck("a", {
      type_group: "media",
      section: "focus",
      counts: { unseen: 151, suspended: 2 },
      today_count: 3,
      eta: { starts: "today", finishes: "month" }
    }))).toBe("151 images · 3 aujourd'hui · fini ce mois-ci · 2 suspendues");
  });

  it("says when a waiting deck starts", () => {
    expect(deckMeta(deck("b", {
      type_group: "map",
      eta: { starts: "months", finishes: "later" }
    }))).toBe("5 zones · démarre dans quelques mois");
  });

  it("marks paused decks", () => {
    expect(deckMeta(deck("c", { paused: true, section: "paused" }))).toBe(
      "En pause · 5 questions en attente"
    );
  });
});


describe("plural", () => {
  it("keeps zero singular, as French does", () => {
    expect(plural(0, "nouvelle")).toBe("0 nouvelle");
    expect(plural(1, "nouvelle")).toBe("1 nouvelle");
    expect(plural(2, "nouvelle")).toBe("2 nouvelles");
  });
});
