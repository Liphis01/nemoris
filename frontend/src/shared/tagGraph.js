// Pure tag-graph helpers shared by the network editor. Mirrors the backend
// (app/services/tag_hierarchy.py) so links can be validated without a round-trip.
// Kept free of React / React Flow so it is unit-testable under jsdom.

export function normalizeKey(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, " ");
}

// parents: { childKey: [parentKey, ...] }
export function ancestors(key, parents) {
  const result = new Set();
  const stack = [key];

  while (stack.length) {
    const current = stack.pop();
    if (result.has(current)) continue;
    result.add(current);
    (parents[current] || []).forEach((parent) => stack.push(parent));
  }

  return result;
}

export function descendants(key, parents) {
  const children = {};
  Object.entries(parents).forEach(([child, parentList]) => {
    (parentList || []).forEach((parent) => {
      if (!children[parent]) children[parent] = [];
      children[parent].push(child);
    });
  });

  const result = new Set();
  const stack = [key];

  while (stack.length) {
    const current = stack.pop();
    if (result.has(current)) continue;
    result.add(current);
    (children[current] || []).forEach((child) => stack.push(child));
  }

  return result;
}

// Would adding the edge parent → child introduce a cycle? True when the child is
// already an ancestor of the prospective parent (or they are the same node).
export function wouldCreateCycle(parents, childKey, parentKey) {
  if (childKey === parentKey) return true;
  return ancestors(parentKey, parents).has(childKey);
}
