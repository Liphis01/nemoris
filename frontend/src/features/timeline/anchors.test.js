import { describe, expect, it } from "vitest";
import {
  anchorCenterValue,
  centuryLabel,
  curatedAnchors,
  decadeLabel,
  describeValue,
  eraForYear,
  getCuratedAnchors,
  getEraBands,
  selectVisibleAnchors,
  todayAnchor
} from "./anchors";
import {
  dateToOrdinal,
  maxTimelineValue,
  minTimelineValue
} from "./timelineUtils";

function yearAnchor(id, year, tier = 0) {
  return {
    id,
    label: id,
    start: { year, month: null, day: null, precision: "year" },
    tier
  };
}

describe("eraForYear", () => {
  it("treats era end years as exclusive so boundaries open the next era", () => {
    expect(eraForYear(475).id).toBe("antiquite");
    expect(eraForYear(476).id).toBe("moyen-age");
    expect(eraForYear(1492).id).toBe("moderne");
    expect(eraForYear(1789).id).toBe("contemporaine");
  });

  it("handles open-ended extremes", () => {
    expect(eraForYear(-10000).id).toBe("prehistoire");
    expect(eraForYear(-3000).id).toBe("antiquite");
    expect(eraForYear(9999).id).toBe("contemporaine");
  });
});

describe("getEraBands", () => {
  it("spans the full timeline range with contiguous bands", () => {
    const bands = getEraBands();

    expect(bands).toHaveLength(5);
    expect(bands[0].startValue).toBe(minTimelineValue);
    expect(bands[bands.length - 1].endValue).toBe(maxTimelineValue);
    expect(bands[1].startValue).toBe(dateToOrdinal(-3000, 1, 1));
    expect(bands[2].startValue).toBe(dateToOrdinal(476, 1, 1));

    bands.slice(1).forEach((band, index) => {
      expect(band.startValue).toBe(bands[index].endValue);
    });
  });
});

describe("centuryLabel", () => {
  it("formats AD centuries with French ordinals", () => {
    expect(centuryLabel(1)).toBe("Ier siècle");
    expect(centuryLabel(100)).toBe("Ier siècle");
    expect(centuryLabel(101)).toBe("IIe siècle");
    expect(centuryLabel(1789)).toBe("XVIIIe siècle");
    expect(centuryLabel(2026)).toBe("XXIe siècle");
  });

  it("formats BC centuries with the av. J.-C. suffix", () => {
    expect(centuryLabel(-52)).toBe("Ier siècle av. J.-C.");
    expect(centuryLabel(-200)).toBe("IIe siècle av. J.-C.");
  });
});

describe("decadeLabel", () => {
  it("rounds down to the decade start", () => {
    expect(decadeLabel(1945)).toBe("années 1940");
    expect(decadeLabel(2026)).toBe("années 2020");
  });

  it("labels BC decades", () => {
    expect(decadeLabel(-52)).toBe("années 60 av. J.-C.");
  });
});

describe("describeValue", () => {
  it("derives era, century and decade from a viewport value", () => {
    const parts = describeValue(dateToOrdinal(1944, 6, 1));

    expect(parts.eraId).toBe("contemporaine");
    expect(parts.eraLabel).toBe("Époque contemporaine");
    expect(parts.centuryLabel).toBe("XXe siècle");
    expect(parts.decadeLabel).toBe("années 1940");
  });
});

describe("anchorCenterValue", () => {
  it("returns the point value for a single-date anchor", () => {
    const value = anchorCenterValue(yearAnchor("rev", 1789));

    expect(value).toBe(dateToOrdinal(1789, 7, 2));
  });

  it("centers span anchors between their bounds", () => {
    const ww2 = {
      id: "ww2",
      label: "WWII",
      start: { year: 1939, month: null, day: null, precision: "year" },
      end: { year: 1945, month: null, day: null, precision: "year" }
    };
    const low = dateToOrdinal(1939, 1, 1);
    const high = dateToOrdinal(1945, 12, 31);

    expect(anchorCenterValue(ww2)).toBe(Math.round((low + high) / 2));
  });
});

describe("getCuratedAnchors", () => {
  it("includes a computed Today anchor by default", () => {
    const anchors = getCuratedAnchors({ now: new Date("2026-06-19T00:00:00Z") });
    const today = anchors.find(anchor => anchor.id === "today");

    expect(today).toBeTruthy();
    expect(anchors).toHaveLength(curatedAnchors.length + 1);
  });

  it("can omit the Today anchor", () => {
    const anchors = getCuratedAnchors({ includeToday: false });

    expect(anchors.some(anchor => anchor.id === "today")).toBe(false);
  });
});

describe("todayAnchor", () => {
  it("uses day precision for the current date", () => {
    const anchor = todayAnchor(new Date("2026-06-19T12:00:00"));

    expect(anchor.start).toMatchObject({ year: 2026, month: 6, day: 19, precision: "day" });
  });
});

describe("selectVisibleAnchors", () => {
  const viewport = {
    start_value: dateToOrdinal(900, 1, 1),
    end_value: dateToOrdinal(1100, 1, 1)
  };
  const anchors = [
    yearAnchor("a", 1000, 0),
    yearAnchor("b", 1001, 1), // crowds A → culled
    yearAnchor("c", 1080, 1), // far enough from A → kept
    yearAnchor("left", 500, 0),
    yearAnchor("right", 1500, 0)
  ];

  it("keeps tier-0 anchors and culls crowded tier-1 anchors", () => {
    const result = selectVisibleAnchors(anchors, viewport, 300);
    const visibleIds = result.visible.map(entry => entry.anchor.id);

    expect(visibleIds).toEqual(["a", "c"]);
    expect(result.hidden.map(entry => entry.anchor.id)).toEqual(["b"]);
  });

  it("reports off-screen anchors as nearest edge neighbours", () => {
    const result = selectVisibleAnchors(anchors, viewport, 300);

    expect(result.offLeft.map(entry => entry.anchor.id)).toEqual(["left"]);
    expect(result.offRight.map(entry => entry.anchor.id)).toEqual(["right"]);
  });

  it("keeps crowded tier-1 anchors when the gap requirement is relaxed", () => {
    const result = selectVisibleAnchors(anchors, viewport, 300, { minGapPx: 0 });

    expect(result.visible.map(entry => entry.anchor.id)).toEqual(["a", "b", "c"]);
  });
});
