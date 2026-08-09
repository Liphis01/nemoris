export function mapZoneGeometry(zoneElements, svgElement) {
  const zones = {};
  const viewBox = svgElement?.viewBox?.baseVal;
  const diagonal = viewBox && viewBox.width > 0 && viewBox.height > 0
    ? Math.hypot(viewBox.width, viewBox.height)
    : 0;

  for (const { code, el } of zoneElements || []) {
    if (!code || typeof el?.getBBox !== "function") continue;

    let box;
    try {
      box = el.getBBox();
    } catch {
      continue;
    }

    if (
      !box ||
      ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      box.width < 0 ||
      box.height < 0
    ) continue;

    const next = {
      minX: box.x,
      minY: box.y,
      maxX: box.x + box.width,
      maxY: box.y + box.height
    };
    const existing = zones[code];
    zones[code] = existing
      ? {
          minX: Math.min(existing.minX, next.minX),
          minY: Math.min(existing.minY, next.minY),
          maxX: Math.max(existing.maxX, next.maxX),
          maxY: Math.max(existing.maxY, next.maxY)
        }
      : next;
  }

  return {
    diagonal,
    zones: Object.fromEntries(Object.entries(zones).map(([code, box]) => {
      const width = box.maxX - box.minX;
      const height = box.maxY - box.minY;

      return [code, {
        bbox: { x: box.minX, y: box.minY, width, height },
        centroid: { x: box.minX + (width / 2), y: box.minY + (height / 2) }
      }];
    }))
  };
}
