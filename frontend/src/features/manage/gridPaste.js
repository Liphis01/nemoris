// Spreadsheet paste. A grid is the one editor where the source material almost
// always already exists as a table somewhere else, so tab-separated text is a
// first-class input rather than a convenience.

import { appendAxis, axisLabelFor, gridKey, setCellValue } from "./gridSource";

const TAB = "\t";

// Only a tab proves the clipboard holds a table. Newlines alone do not: a
// multi-line answer pasted into one cell is a legitimate thing to want.
export function looksLikeTable(text) {
  return String(text ?? "").includes(TAB);
}

export function parseTable(text) {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");

  if (!normalized) return [];

  const rows = normalized.split("\n").map(line => line.split(TAB).map(cell => cell.trim()));
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const padded = rows.map(row => (
    Array.from({ length: width }, (_, index) => row[index] ?? "")
  ));

  // Spreadsheet copies routinely carry trailing empty columns; keeping them
  // would create axes the user never selected.
  while (padded[0]?.length > 1 && padded.every(row => !row[row.length - 1])) {
    padded.forEach(row => row.pop());
  }

  return padded.filter(row => row.some(Boolean));
}

export function tableShape(table, { firstRowIsHeader = true, firstColumnIsHeader = true } = {}) {
  const width = table.reduce((max, row) => Math.max(max, row.length), 0);

  return {
    rows: Math.max(table.length - (firstRowIsHeader ? 1 : 0), 0),
    columns: Math.max(width - (firstColumnIsHeader ? 1 : 0), 0)
  };
}

// Replace the whole grid: the pasted block defines the axes as well as the cells.
export function tableToGrid(table, options = {}) {
  const { firstRowIsHeader = true, firstColumnIsHeader = true } = options;
  const body = firstRowIsHeader ? table.slice(1) : table;
  const width = table.reduce((max, row) => Math.max(max, row.length), 0);
  const offset = firstColumnIsHeader ? 1 : 0;
  const columnCount = Math.max(width - offset, 1);

  if (!body.length) return null;

  const columns = Array.from({ length: columnCount }, (_, index) => ({
    key: gridKey(),
    label: (firstRowIsHeader ? table[0]?.[index + offset] : "") || axisLabelFor("columns", index)
  }));
  const rows = body.map((row, index) => ({
    key: gridKey(),
    label: (firstColumnIsHeader ? row[0] : "") || axisLabelFor("rows", index)
  }));
  const cells = [];

  body.forEach((row, rowIndex) => {
    columns.forEach((column, columnIndex) => {
      const value = row[columnIndex + offset] || "";

      if (!value) return;

      cells.push({
        key: gridKey(),
        row_key: rows[rowIndex].key,
        column_key: column.key,
        value
      });
    });
  });

  return { format: 1, rows, columns, cells };
}

// Spill a block into the existing grid starting at one cell, growing the axes
// only as far as the block actually reaches.
export function spillTableIntoGrid(grid, table, rowIndex, columnIndex) {
  const width = table.reduce((max, row) => Math.max(max, row.length), 0);
  let next = grid;

  for (let index = next.rows.length; index < rowIndex + table.length; index += 1) {
    next = appendAxis(next, "rows");
  }

  for (let index = next.columns.length; index < columnIndex + width; index += 1) {
    next = appendAxis(next, "columns");
  }

  table.forEach((row, rowOffset) => {
    row.forEach((value, columnOffset) => {
      const targetRow = next.rows[rowIndex + rowOffset];
      const targetColumn = next.columns[columnIndex + columnOffset];

      if (!targetRow || !targetColumn || !value) return;

      next = setCellValue(next, targetRow.key, targetColumn.key, value);
    });
  });

  return next;
}
