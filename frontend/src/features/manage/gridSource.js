// Pure operations on the grid source shape the backend validates (format 1).
// Keeping them out of the component is what lets the editor stay a thin shell
// and lets the paste helpers reuse the exact same axis and cell rules.

export function gridKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16);

    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export function axisNoun(kind) {
  return kind === "rows" ? "Ligne" : "Colonne";
}

export function axisLabelFor(kind, index) {
  return `${axisNoun(kind)} ${index + 1}`;
}

export function blankGrid() {
  return {
    format: 1,
    rows: [{ key: gridKey(), label: axisLabelFor("rows", 0) }],
    columns: [{ key: gridKey(), label: axisLabelFor("columns", 0) }],
    cells: []
  };
}

export function cellAt(grid, rowKey, columnKey) {
  return (grid?.cells || []).find(
    cell => cell.row_key === rowKey && cell.column_key === columnKey
  );
}

export function cellIndex(grid) {
  return new Map(
    (grid?.cells || []).map(cell => [`${cell.row_key}:${cell.column_key}`, cell])
  );
}

export function isFilled(cell) {
  return Boolean(String(cell?.value || "").trim());
}

export function cardCount(grid) {
  return (grid?.cells || []).filter(isFilled).length;
}

export function filledCountOnAxis(grid, kind, axisKey) {
  const field = kind === "rows" ? "row_key" : "column_key";

  return (grid?.cells || []).filter(cell => cell[field] === axisKey && isFilled(cell)).length;
}

export function renameAxis(grid, kind, axisKey, label) {
  return {
    ...grid,
    [kind]: grid[kind].map(item => (item.key === axisKey ? { ...item, label } : item))
  };
}

export function insertAxis(grid, kind, index) {
  const next = [...grid[kind]];

  next.splice(index, 0, { key: gridKey(), label: axisLabelFor(kind, grid[kind].length) });

  return { ...grid, [kind]: next };
}

export function appendAxis(grid, kind) {
  return insertAxis(grid, kind, grid[kind].length);
}

export function moveAxis(grid, kind, from, to) {
  if (from === to || to < 0 || to >= grid[kind].length) return grid;

  const next = [...grid[kind]];
  const [moved] = next.splice(from, 1);

  next.splice(to, 0, moved);

  return { ...grid, [kind]: next };
}

export function removeAxis(grid, kind, axisKey) {
  // The last axis has nowhere to put the cells that would survive it, so the
  // matrix disables the control rather than relying on this guard alone.
  if (grid[kind].length <= 1) return grid;

  const field = kind === "rows" ? "row_key" : "column_key";

  return {
    ...grid,
    [kind]: grid[kind].filter(item => item.key !== axisKey),
    cells: grid.cells.filter(cell => cell[field] !== axisKey)
  };
}

export function setCellValue(grid, rowKey, columnKey, value) {
  const existing = cellAt(grid, rowKey, columnKey);

  // An emptied cell keeps its key while the editor is open: clearing a value and
  // retyping it is an edit, and the backend now ties scheduling to that key, so
  // dropping it here would quietly cost the card its history. Blank cells are
  // filtered out at save time instead.
  const cells = existing
    ? grid.cells.map(cell => (cell.key === existing.key ? { ...cell, value } : cell))
    : [...grid.cells, { key: gridKey(), row_key: rowKey, column_key: columnKey, value }];

  return { ...grid, cells };
}

export function clearCell(grid, rowKey, columnKey) {
  return {
    ...grid,
    cells: grid.cells.filter(
      cell => cell.row_key !== rowKey || cell.column_key !== columnKey
    )
  };
}

// The backend refuses blank cells, and a blank cell is not a card anyway.
export function toSavePayload(grid) {
  return { ...grid, cells: (grid?.cells || []).filter(isFilled) };
}
