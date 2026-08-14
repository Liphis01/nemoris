import { describe, expect, it } from "vitest";
import { buildVisibleRows, getQuestionGroupId } from "./manageRows";

describe("manageRows", () => {
  const group = {
    id: 7,
    name: "Carte Europe",
    type_group: "map",
    tags: ["geo"]
  };
  const mapQuestion = {
    id: 20,
    type_q: "map",
    question: "France",
    answer: "France",
    tags: ["fr"],
    group
  };
  const textQuestion = {
    id: 21,
    type_q: "text",
    question: "Capital",
    answer: "Paris",
    group_id: 7
  };
  const imageQuestion = {
    id: 23,
    type_q: "media",
    question: "Flags - France",
    answer: "France",
    tags: ["flag"],
    group_id: 7
  };
  const ungroupedQuestion = {
    id: 22,
    type_q: "text",
    question: "Loose",
    answer: "Item"
  };

  it("normalizes group ids from direct and nested shapes", () => {
    expect(getQuestionGroupId(mapQuestion)).toBe("7");
    expect(getQuestionGroupId(textQuestion)).toBe("7");
    expect(getQuestionGroupId(ungroupedQuestion)).toBeNull();
  });

  it("renders collapsed groups as headers and expanded groups with atomic questions", () => {
    const collapsedRows = buildVisibleRows(
      [mapQuestion, textQuestion, imageQuestion, ungroupedQuestion],
      [group],
      new Set(),
      "id"
    );

    expect(collapsedRows.map(row => row.key)).toEqual([
      "group:7",
      "question:22"
    ]);

    const expandedRows = buildVisibleRows(
      [mapQuestion, textQuestion, imageQuestion, ungroupedQuestion],
      [group],
      new Set(["7"]),
      "id"
    );

    expect(expandedRows.map(row => row.key)).toEqual([
      "group:7",
      "question:20",
      "question:23",
      "question:21",
      "question:22"
    ]);
    expect(expandedRows[0].groupInfo).toMatchObject({
      imageCount: 1,
      mapCount: 1,
      textCount: 1
    });
    expect(expandedRows[0].groupInfo.tags).toEqual(["geo", "fr", "flag"]);
    expect(expandedRows[1]).toMatchObject({
      nested: true,
      groupId: "7"
    });
  });

  it("keeps generated cloze grid and set cards behind their group source row", () => {
    const generatedGroup = {
      id: 8,
      name: "Note générée",
      type_group: "cloze",
      tags: ["langue"]
    };
    const generatedRows = buildVisibleRows(
      [
        { id: 30, type_q: "cloze", question: "Texte à trous", answer: "mot", group_id: 8 },
        { id: 31, type_q: "grid", question: "Ligne × colonne", answer: "valeur", group_id: 8 },
        { id: 32, type_q: "set", question: "Membre", answer: "Hélium", group_id: 8 }
      ],
      [generatedGroup],
      new Set(["8"]),
      "id"
    );

    expect(generatedRows.map(row => row.key)).toEqual(["group:8"]);
    expect(generatedRows[0].groupInfo.typeCounts).toMatchObject({
      cloze: 1,
      grid: 1,
      set: 1
    });
  });
});
