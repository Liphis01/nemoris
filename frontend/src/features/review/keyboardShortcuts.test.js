import { describe, expect, it } from "vitest";
import { eventDigit } from "./keyboardShortcuts";

describe("eventDigit", () => {
  it("accepts regular digit characters", () => {
    expect(eventDigit({ key: "2", code: "Digit2" })).toBe(2);
    expect(eventDigit({ key: "4", code: "Digit4" })).toBe(4);
  });

  it("accepts physical top-row digit keys on AZERTY layouts", () => {
    expect(eventDigit({ key: "&", code: "Digit1" })).toBe(1);
    expect(eventDigit({ key: "é", code: "Digit2" })).toBe(2);
    expect(eventDigit({ key: "\"", code: "Digit3" })).toBe(3);
    expect(eventDigit({ key: "'", code: "Digit4" })).toBe(4);
  });

  it("accepts numpad digits and rejects digits outside the requested range", () => {
    expect(eventDigit({ key: "End", code: "Numpad1" }, { min: 1, max: 3 }))
      .toBe(1);
    expect(eventDigit({ key: "'", code: "Digit4" }, { min: 1, max: 3 }))
      .toBeNull();
  });
});
