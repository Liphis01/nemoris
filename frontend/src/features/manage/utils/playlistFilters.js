function normalizeString(value) {
  return String(value || "").trim().toLowerCase();
}


function getRuleCount(playlist) {
  return (playlist?.rules?.clauses || []).length;
}


function getSortValues(playlist, sortField) {
  const id = Number(playlist?.id || 0);
  const name = normalizeString(playlist?.name);
  const questionCount = Number(playlist?.question_count || 0);
  const ruleCount = getRuleCount(playlist);
  const generatedRank = playlist?.generated ? 0 : 1;

  switch (sortField) {
    case "name":
      return [name, id];
    case "question_count":
      return [questionCount, name, id];
    case "rules":
      return [ruleCount, name, id];
    case "generated":
      return [generatedRank, name, id];
    case "id":
    default:
      return [id];
  }
}


function compareValues(valueA, valueB) {
  if (typeof valueA === "string" || typeof valueB === "string") {
    return String(valueA).localeCompare(String(valueB));
  }

  if (valueA < valueB) return -1;
  if (valueA > valueB) return 1;
  return 0;
}


function comparePlaylists(a, b, sortField, sortOrder) {
  const valuesA = getSortValues(a, sortField);
  const valuesB = getSortValues(b, sortField);

  for (let index = 0; index < valuesA.length; index += 1) {
    const compared = compareValues(valuesA[index], valuesB[index]);

    if (compared !== 0) {
      if (sortField === "generated" && index === 0) {
        return compared;
      }

      return sortOrder === "asc" ? compared : -compared;
    }
  }

  return 0;
}


export function filterAndSortPlaylists({
  playlists,
  playlistSortField,
  playlistSortOrder
}) {
  return (playlists || [])
    .slice()
    .sort((a, b) => comparePlaylists(
      a,
      b,
      playlistSortField,
      playlistSortOrder
    ));
}
