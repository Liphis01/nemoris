import { describe, expect, it } from "vitest";
import {
  creationIntentOptions,
  groupTypeFilterOptions,
  questionTypeFilterOptions
} from "./questionTypes";

describe("question type metadata", () => {
  it("offers every current type through filters", () => {
    expect(questionTypeFilterOptions.map(option => option.value)).toEqual([
      "",
      "text",
      "numeric",
      "enumeration",
      "timeline",
      "map",
      "media",
      "cloze",
      "grid",
      "set",
      "sequence"
    ]);
    expect(groupTypeFilterOptions.map(option => option.value)).toEqual([
      "",
      "map",
      "media",
      "text",
      "cloze",
      "grid",
      "set",
      "sequence"
    ]);
  });

  it("maps creation intents to the correct internal question or group type", () => {
    expect(creationIntentOptions.map(intent => `${intent.kind}:${intent.value}`)).toEqual([
      "question:text",
      "question:numeric",
      "question:enumeration",
      "question:timeline",
      "group:map",
      "group:media",
      "group:text",
      "group:cloze",
      "group:grid",
      "group:set",
      "group:sequence"
    ]);
  });
});
