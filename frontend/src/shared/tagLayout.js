// Geometry helpers for placing a freshly-created child node in the tag network
// without overlapping the rest. Kept free of React / React Flow so it can be
// unit-tested under jsdom.

export const GAP = 28; // minimum empty space kept between node boxes
export const ROW_GAP = 70; // vertical gap from a parent's bottom to its child's top

export function approxNodeSize(label) {
  // A pill is "#label" with ~14px horizontal padding each side; estimate before
  // React Flow has measured the real DOM node.
  const text = String(label || "");
  return { width: Math.max(60, text.length * 8 + 44), height: 36 };
}

export function nodeBox(node) {
  const measured = node.measured || {};
  const size = approxNodeSize(node.data?.label ?? node.id);
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    w: measured.width || size.width,
    h: measured.height || size.height
  };
}

export function boxesOverlap(a, b, gap = 0) {
  return (
    a.x - gap < b.x + b.w &&
    a.x + a.w + gap > b.x &&
    a.y - gap < b.y + b.h &&
    a.y + a.h + gap > b.y
  );
}

// Pick a spot below `parentBox` for a `childSize` box that avoids `otherBoxes`.
// Prefers the slot centered directly under the parent, fanning out horizontally
// then down. Returns the preferred spot if nothing free is found in the window.
export function findChildSlot(parentBox, childSize, otherBoxes, opts = {}) {
  const gap = opts.gap ?? GAP;
  const rowGap = opts.rowGap ?? ROW_GAP;
  const step = childSize.width + gap;
  const baseX = parentBox.x + parentBox.w / 2 - childSize.width / 2;
  const baseY = parentBox.y + parentBox.h + rowGap;

  for (let row = 0; row <= 4; row += 1) {
    const y = baseY + row * (childSize.height + 50);

    for (let i = 0; i <= 5; i += 1) {
      const offsets = i === 0 ? [0] : [i * step, -i * step];

      for (const dx of offsets) {
        const candidate = {
          x: baseX + dx,
          y,
          w: childSize.width,
          h: childSize.height
        };
        const collides = otherBoxes.some((box) =>
          boxesOverlap(candidate, box, gap)
        );
        if (!collides) {
          return { x: candidate.x, y: candidate.y };
        }
      }
    }
  }

  return { x: baseX, y: baseY };
}

// Iteratively separate overlapping boxes. `pinned` ids never move (the other box
// absorbs the full push). Returns the updated positions keyed by id.
export function resolveOverlaps(boxes, opts = {}) {
  const gap = opts.gap ?? GAP;
  const pinned = opts.pinned instanceof Set ? opts.pinned : new Set(opts.pinned || []);
  const iterations = opts.iterations ?? 120;
  const EPS = 0.5; // push slightly past contact so pairs reliably clear
  const working = boxes.map((box) => ({ ...box }));

  for (let pass = 0; pass < iterations; pass += 1) {
    let moved = false;

    for (let i = 0; i < working.length; i += 1) {
      for (let j = i + 1; j < working.length; j += 1) {
        const a = working[i];
        const b = working[j];
        if (!boxesOverlap(a, b, gap)) continue;

        // Minimal translation to separate along the smaller-penetration axis.
        const ax = a.x + a.w / 2;
        const ay = a.y + a.h / 2;
        const bx = b.x + b.w / 2;
        const by = b.y + b.h / 2;
        const overlapX = (a.w + b.w) / 2 + gap - Math.abs(ax - bx);
        const overlapY = (a.h + b.h) / 2 + gap - Math.abs(ay - by);

        let pushX = 0;
        let pushY = 0;
        if (overlapX < overlapY) {
          pushX = (ax <= bx ? -1 : 1) * (overlapX + EPS);
        } else {
          pushY = (ay <= by ? -1 : 1) * (overlapY + EPS);
        }

        const aPinned = pinned.has(a.id);
        const bPinned = pinned.has(b.id);

        if (aPinned && bPinned) continue;

        if (aPinned) {
          b.x -= pushX;
          b.y -= pushY;
        } else if (bPinned) {
          a.x += pushX;
          a.y += pushY;
        } else {
          a.x += pushX / 2;
          a.y += pushY / 2;
          b.x -= pushX / 2;
          b.y -= pushY / 2;
        }

        moved = true;
      }
    }

    if (!moved) break;
  }

  const positions = {};
  working.forEach((box) => {
    positions[box.id] = { x: box.x, y: box.y };
  });
  return positions;
}
