import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatPercent,
  formatRecordPercent
} from "./trainingRecordUtils";


describe("training record formatting", () => {
  it("formats elapsed durations compactly", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(900)).toBe("1s");
    expect(formatDuration(90000)).toBe("1:30");
    expect(formatDuration(3661000)).toBe("1:01:01");
  });

  it("formats attempt and stored percentages", () => {
    expect(formatPercent(7, 8)).toBe("88%");
    expect(formatPercent(0, 0)).toBe("—");
    expect(formatRecordPercent({ best_found_percent: 87.5 })).toBe("88%");
    expect(formatRecordPercent(null)).toBe("—");
  });
});
