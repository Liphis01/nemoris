function normalizeString(value) {
  return String(value || "").trim().toLowerCase();
}


function normalizeSearchText(value) {
  return normalizeString(value).replace(/[-\s]+/g, " ");
}


function matchesSearch(group, search) {
  if (!search) return true;

  const normalizedSearch = normalizeSearchText(search);

  return (
    normalizeSearchText(group.name).includes(normalizedSearch) ||
    normalizeSearchText(group.type_group).includes(normalizedSearch)
  );
}


function matchesType(group, typeFilter) {
  if (!typeFilter) return true;

  return normalizeString(group.type_group) === normalizeString(typeFilter);
}


function matchesMedia(group, hasMediaOnly) {
  if (!hasMediaOnly) return true;

  return Boolean(String(group.media || "").trim());
}


function getSortValues(group, sortField) {
  const id = Number(group?.id || 0);
  const name = normalizeString(group?.name);
  const type = normalizeString(group?.type_group);
  const questionCount = Number(group?.question_count || 0);
  const hasMediaRank = String(group?.media || "").trim() ? 0 : 1;

  switch (sortField) {
    case "name":
      return [name, id];
    case "type":
      return [type, name, id];
    case "question_count":
      return [questionCount, name, id];
    case "media":
      return [hasMediaRank, name, id];
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


function compareGroups(a, b, sortField, sortOrder) {
  const valuesA = getSortValues(a, sortField);
  const valuesB = getSortValues(b, sortField);

  for (let index = 0; index < valuesA.length; index += 1) {
    const compared = compareValues(valuesA[index], valuesB[index]);

    if (compared !== 0) {
      if (sortField === "media" && index === 0) {
        return compared;
      }

      return sortOrder === "asc" ? compared : -compared;
    }
  }

  return 0;
}


export function filterAndSortGroups({
  groups,
  groupSearch,
  groupTypeFilter,
  groupHasMediaOnly,
  groupSortField,
  groupSortOrder
}) {
  return groups
    .filter(group =>
      matchesSearch(group, groupSearch) &&
      matchesType(group, groupTypeFilter) &&
      matchesMedia(group, groupHasMediaOnly)
    )
    .slice()
    .sort((a, b) => compareGroups(a, b, groupSortField, groupSortOrder));
}
