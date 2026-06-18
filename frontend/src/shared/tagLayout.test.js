import { describe, expect, it } from "vitest";

import {
  GAP,
  boxesOverlap,
  findChildSlot,
  resolveOverlaps
} from "./tagLayout";

const childSize = { width: 80, height: 36 };

function box(id, x, y, w = 80, h = 36) {
  return { id, x, y, w, h };
}

describe("findChildSlot", () => {
  it("places the child centered below the parent when there is room", () => {
    const parent = box("p", 100, 100, 100, 36);
    const slot = findChildSlot(parent, childSize, []);

    expect(slot.y).toBe(100 + 36 + 70); // parent bottom + ROW_GAP
    expect(slot.x).toBe(100 + 100 / 2 - 80 / 2); // centered under parent
  });

  it("returns a spot that doesn't overlap crowded neighbours", () => {
    const parent = box("p", 0, 0, 100, 36);
    // Fill the preferred slot and its immediate horizontal neighbours.
    const others = [
      box("a", -90, 106),
      box("b", 10, 106),
      box("c", 110, 106)
    ];

    const slot = findChildSlot(parent, childSize, others);
    const placed = { ...slot, w: childSize.width, h: childSize.height };

    others.forEach((other) => {
      expect(boxesOverlap(placed, other, GAP)).toBe(false);
    });
  });
});

describe("resolveOverlaps", () => {
  it("separates all overlapping boxes", () => {
    const boxes = [box("a", 0, 0), box("b", 10, 5), box("c", 20, 10)];
    const positions = resolveOverlaps(boxes, {});

    const resolved = boxes.map((b) => ({ ...b, ...positions[b.id] }));
    for (let i = 0; i < resolved.length; i += 1) {
      for (let j = i + 1; j < resolved.length; j += 1) {
        expect(boxesOverlap(resolved[i], resolved[j], GAP)).toBe(false);
      }
    }
  });

  it("never moves pinned boxes", () => {
    const boxes = [box("parent", 0, 0), box("child", 5, 5), box("other", 8, 8)];
    const positions = resolveOverlaps(boxes, { pinned: ["parent", "child"] });

    expect(positions.parent).toEqual({ x: 0, y: 0 });
    expect(positions.child).toEqual({ x: 5, y: 5 });
    // The unpinned neighbour absorbed the separation.
    expect(positions.other).not.toEqual({ x: 8, y: 8 });
  });
});
