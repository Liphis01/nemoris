import { describe, expect, it } from "vitest";
import { filterAndSortQuestions } from "./questionFilters";

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
      tagFilter: "hist",
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
