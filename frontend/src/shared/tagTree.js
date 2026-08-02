// Derivations the tag picker and tag manager both need: what is a root, what
// hangs under a node, and where a node sits. Kept pure and React-free so the
// browse/search behaviour is unit-testable without rendering anything.

import { normalizeKey } from "./tagGraph";
import { labelForTag } from "./tagLabels";


export function childrenMap(parents) {
  const children = {};

  Object.entries(parents || {}).forEach(([child, parentList]) => {
    (parentList || []).forEach((parent) => {
      if (!children[parent]) children[parent] = [];
      if (!children[parent].includes(child)) children[parent].push(child);
    });
  });

  return children;
}


// Every key the picker should know about: the hierarchy plus any tag that is
// only ever used on a question and was never filed.
export function allTagKeys({ parents = {}, labels = {} } = {}, extraKeys = []) {
  const keys = new Set();

  Object.keys(labels).forEach((key) => keys.add(key));
  Object.entries(parents).forEach(([child, parentList]) => {
    keys.add(child);
    (parentList || []).forEach((parent) => keys.add(parent));
  });
  (extraKeys || []).forEach((key) => {
    const id = String(key || "").trim();
    if (id) keys.add(id);
  });

  return keys;
}


export function isBrowseRoot(key, nodes = {}) {
  const node = nodes?.[key];
  if (!node) return false;
  if (node.hidden) return false;
  return node.kind === "core" || node.classification === "root";
}


export function rootKeys(keys, parents = {}, nodes = {}) {
  const hasNodes = Object.keys(nodes || {}).length > 0;
  return [...keys].filter((key) =>
    hasNodes ? isBrowseRoot(key, nodes) : !(parents[key] || []).length
  );
}


// One path from a root down to (but excluding) `key`, for the "Informatique ›
// Technologie › Sciences" breadcrumb. A tag can have several parents; showing
// every path would be noise, so the first is used consistently.
export function ancestorPath(key, parents = {}) {
  const path = [];
  const seen = new Set([key]);
  let current = (parents[key] || [])[0];

  while (current && !seen.has(current)) {
    seen.add(current);
    path.unshift(current);
    current = (parents[current] || [])[0];
  }

  return path;
}


export function ancestorPaths(key, parents = {}) {
  const paths = [];

  function walk(current, path, seen) {
    const parentIds = parents[current] || [];
    if (!parentIds.length) {
      paths.push(path);
      return;
    }
    parentIds.forEach(parentId => {
      if (!seen.has(parentId)) {
        walk(parentId, [parentId, ...path], new Set([...seen, parentId]));
      }
    });
  }

  walk(key, [], new Set([key]));
  return paths.length ? paths : [[]];
}


export function breadcrumbLabel(key, parents, labels) {
  return ancestorPath(key, parents)
    .map((ancestor) => labelForTag(ancestor, labels))
    .join(" › ");
}


function sortByLabel(keys, labels) {
  return [...keys].sort((a, b) =>
    labelForTag(a, labels).localeCompare(labelForTag(b, labels))
  );
}


export function browseLevel(parentKey, { keys, parents = {}, labels = {}, nodes = {} }) {
  const level = parentKey
    ? childrenMap(parents)[parentKey] || []
    : rootKeys(keys, parents, nodes);

  return sortByLabel(level, labels);
}


// Search localized labels; the returned values are the corresponding opaque
// IDs. A technical ID is never treated as the user's tag name.
export function searchTags(query, { keys, parents = {}, labels = {} }) {
  const needle = normalizeKey(query);

  if (!needle) return [];

  const matches = [...keys].filter((key) =>
    normalizeKey(labelForTag(key, labels)).includes(needle)
  );

  // Exact hits first, then shallower nodes: a category is a likelier target
  // than a leaf buried under it.
  return matches.sort((a, b) => {
    const exactA = a === needle || normalizeKey(labelForTag(a, labels)) === needle;
    const exactB = b === needle || normalizeKey(labelForTag(b, labels)) === needle;

    if (exactA !== exactB) return exactA ? -1 : 1;

    const depth = ancestorPath(a, parents).length - ancestorPath(b, parents).length;

    if (depth !== 0) return depth;

    return labelForTag(a, labels).localeCompare(labelForTag(b, labels));
  });
}


export function hasChildren(key, parents) {
  return (childrenMap(parents)[key] || []).length > 0;
}
