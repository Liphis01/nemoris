import { describe, expect, it } from "vitest";
import { buildTagMatcher, filterAndSortQuestions } from "./questionFilters";

describe("questionFilters", () => {
  const questions = [
    {
      id: 1,
      type_q: "text",
      question: "Capital of France",
      answer: "Paris",
      tags: ["Geo"],
      data: { favorite: true },
      progress: { next_review: "2099-01-01", reps: 4 }
    },
    {
      id: 2,
      type_q: "timeline",
      question: "D-Day",
      answer: "06/06/1944",
      tags: ["history"],
      progress: { next_review: "2000-01-01", reps: 1 }
    },
    {
      id: 3,
      type_q: "map",
      question: "ile de france",
      answer: "Ile-de-France",
      tags: ["geo", "map"],
      data: { aliases: ["Region parisienne"] },
      progress: null
    },
    {
      id: 4,
      type_q: "media",
      question: "Flags - Cote d Ivoire",
      answer: "Cote-d Ivoire",
      tags: ["flags"],
      aliases: ["Orange white green"],
      progress: { next_review: "2000-01-01", reps: 2 }
    }
  ];

  it("filters by search, tag, type, and due status", () => {
    expect(filterAndSortQuestions({
      questions,
      search: "d day",
      tagFilter: "history",
      tagParents: {},
      tagLabels: { history: "Histoire" },
      questionTypeFilter: "timeline",
      dueOnly: true,
      sortField: "id",
      sortOrder: "asc"
    }).map(question => question.id)).toEqual([2]);
  });

  it("treats missing progress as due and normalizes hyphenated text", () => {
    expect(filterAndSortQuestions({
      questions,
      search: "ile de france",
      tagFilter: "",
      questionTypeFilter: "map",
      dueOnly: true,
      sortField: "id",
      sortOrder: "asc"
    }).map(question => question.id)).toEqual([3]);
  });

  it("keeps only favorites when favoritesOnly is set", () => {
    expect(filterAndSortQuestions({
      questions,
      search: "",
      tagFilter: "",
      questionTypeFilter: "",
      dueOnly: false,
      favoritesOnly: true,
      sortField: "id",
      sortOrder: "asc"
    }).map(question => question.id)).toEqual([1]);
  });

  it("sorts by review count and next review for review-focused browsing", () => {
    expect(filterAndSortQuestions({
      questions,
      search: "",
      tagFilter: "",
      questionTypeFilter: "",
      dueOnly: false,
      sortField: "reps",
      sortOrder: "asc"
    }).map(question => question.id)).toEqual([3, 2, 4, 1]);
  });

  it("filters image questions by type and normalized answer", () => {
    expect(filterAndSortQuestions({
      questions,
      search: "cote d ivoire",
      tagFilter: "",
      questionTypeFilter: "media",
      dueOnly: true,
      sortField: "id",
      sortOrder: "asc"
    }).map(question => question.id)).toEqual([4]);
  });

  it("matches aliases from question data and direct question fields", () => {
    expect(filterAndSortQuestions({
      questions,
      search: "region parisienne",
      tagFilter: "",
      questionTypeFilter: "",
      dueOnly: false,
      sortField: "id",
      sortOrder: "asc"
    }).map(question => question.id)).toEqual([3]);

    expect(filterAndSortQuestions({
      questions,
      search: "orange white",
      tagFilter: "",
      questionTypeFilter: "",
      dueOnly: false,
      sortField: "id",
      sortOrder: "asc"
    }).map(question => question.id)).toEqual([4]);
  });
});


describe("hierarchy-aware tag filtering", () => {
  // Mirrors the stored hierarchy shape: { child: [parent, ...] }.
  const parents = {
    informatique: ["technologie"],
    technologie: ["sciences"],
    linux: ["informatique"],
    biologie: ["sciences"],
    europe: ["géographie"]
  };

  const questions = [
    { id: 1, question: "a", tags: ["linux"] },
    { id: 2, question: "b", tags: ["sciences"] },
    { id: 3, question: "c", tags: ["biologie"] },
    { id: 4, question: "d", tags: ["europe"] },
    { id: 5, question: "e", tags: [] },
    { id: 6, question: "f", tags: ["Géographie"] }
  ];

  const labels = {
    geography: "Géographie",
    "united-states": "États-Unis"
  };

  function filterByTag(tagFilter, tagParents = parents, tagLabels = labels) {
    return filterAndSortQuestions({
      questions,
      search: "",
      tagFilter,
      tagParents,
      tagLabels,
      questionTypeFilter: "",
      dueOnly: false,
      favoritesOnly: false,
      sortField: "id",
      sortOrder: "asc"
    }).map(question => question.id);
  }

  it("has no matcher when nothing is being filtered", () => {
    expect(buildTagMatcher("", parents)).toBe(null);
    expect(buildTagMatcher("   ", parents)).toBe(null);
  });

  it("recognizes a node that only ever appears as a parent", () => {
    // "géographie" is nobody's child, so it exists only in the parent lists.
    expect(buildTagMatcher("géographie", parents)("europe")).toBe(true);
  });

  it("surfaces descendants when filtering on a theme", () => {
    // The point of the hierarchy: looking up "sciences" must reach a question
    // only ever tagged "linux", three levels down.
    expect(filterByTag("sciences")).toEqual([1, 2, 3]);
  });

  it("scopes to the branch rather than the whole tree", () => {
    expect(filterByTag("informatique")).toEqual([1]);
  });

  it("uses the selected identity rather than a localized spelling", () => {
    expect(filterByTag("géographie")).toEqual([4]);
    expect(filterByTag("GÉOGRAPHIE")).toEqual([]);
  });

  it("does not treat a partial label as identity", () => {
    expect(filterByTag("bio")).toEqual([]);
  });

  it("returns everything when the filter is empty", () => {
    expect(filterByTag("")).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps exact identity matching available before the hierarchy loads", () => {
    expect(filterByTag("linux", {}, {})).toEqual([1]);
    expect(filterByTag("sciences", {}, {})).toEqual([2]);
  });

  it("never treats a localized label as a stored identity", () => {
    const byLabel = filterAndSortQuestions({
      questions: [{ id: 9, question: "x", tags: ["united-states"] }],
      search: "",
      tagFilter: "États",
      tagParents: {},
      tagLabels: labels,
      questionTypeFilter: "",
      dueOnly: false,
      favoritesOnly: false,
      sortField: "id",
      sortOrder: "asc"
    });

    expect(byLabel.map(question => question.id)).toEqual([]);
  });
});
