// Near-duplicate detection for the tag manager.
//
// Tags used to be free text, so the same idea could be typed several ways
// ("usa" / "etats-unis", "elephants" / "éléphants"). Slugs stop new duplicates
// appearing but cannot undo the ones already there. This only ever *suggests*:
// merging two tags is destructive, so it stays a human decision.
//
// Plain Levenshtein, no dependency — the app has to keep working offline.

function editDistance(a, b) {
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];

    for (let j = 1; j < cols; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }

    previous = current;
  }

  return previous[cols - 1];
}


function comparisonText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


export function findSimilarPairs(keys, labelFor, limit = 8) {
  const list = [...keys];
  const pairs = [];

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const labelA = labelFor(a);
      const labelB = labelFor(b);
      const comparableA = comparisonText(labelA);
      const comparableB = comparisonText(labelB);
      const shortest = Math.min(comparableA.length, comparableB.length);

      // Below four characters a single edit is usually a different word
      // entirely ("bd" vs "bo"), so the signal is worthless.
      if (shortest < 4) continue;

      const distance = editDistance(comparableA, comparableB);

      if (distance > 0 && distance <= Math.max(1, Math.floor(shortest / 5))) {
        pairs.push({ a, b, distance, labelA, labelB });
      }
    }
  }

  return pairs
    .sort((x, y) => x.distance - y.distance)
    .slice(0, limit)
    .map(pair => ({ ...pair }));
}
