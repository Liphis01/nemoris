import { normalizeKey } from "../../../shared/tagGraph";
import { labelForTag } from "../../../shared/tagLabels";
import {
  allTagKeys,
  breadcrumbLabel,
  browseLevel,
  childrenMap,
  searchTags
} from "../../../shared/tagTree";


function cleanTagId(value) {
  return String(value || "").trim();
}


function relevantBrowseKeys(availableTags = [], parents = {}) {
  const relevant = new Set();

  function includeWithAncestors(tagId) {
    const id = cleanTagId(tagId);
    if (!id || relevant.has(id)) return;

    relevant.add(id);
    (parents[id] || []).forEach(includeWithAncestors);
  }

  (availableTags || []).forEach(includeWithAncestors);

  return relevant;
}


function visibleChildren(tagId, context, relevant) {
  const children = childrenMap(context.parents)[tagId] || [];

  return children.filter(childId => relevant.has(childId) && !context.nodes?.[childId]?.hidden);
}


function countForTag(tagId, usage = {}, totalUsage = {}) {
  return Number(totalUsage?.[tagId] ?? usage?.[tagId] ?? 0);
}


function tagRows(tagIds, { parents, labels, nodes, usage, totalUsage, relevant, searching, selectedTag }) {
  const context = { parents, nodes };

  return tagIds.map(tagId => {
    const childRows = visibleChildren(tagId, context, relevant);
    const count = countForTag(tagId, usage, totalUsage);

    return {
      id: `tag:${tagId}`,
      type: "tag",
      tagId,
      label: labelForTag(tagId, labels),
      breadcrumb: searching ? breadcrumbLabel(tagId, parents, labels) : "",
      count,
      openable: childRows.length > 0,
      selected: tagId === selectedTag
    };
  });
}


export function buildTagFilterModel({
  query = "",
  branch = null,
  selectedTag = "",
  availableTags = [],
  parents = {},
  labels = {},
  nodes = {},
  usage = {},
  totalUsage = {}
} = {}) {
  const text = String(query || "").trim();
  const searching = Boolean(normalizeKey(text));
  const keys = new Set(
    [...allTagKeys({ parents, labels }, availableTags)]
      .filter(key => !nodes?.[key]?.hidden)
  );
  const relevant = relevantBrowseKeys(availableTags, parents);
  const context = { keys, parents, labels, nodes };
  const tagIds = searching
    ? searchTags(text, context)
    : browseLevel(branch, context).filter(tagId =>
      relevant.has(tagId) && !nodes?.[tagId]?.hidden
    );
  const rows = [];

  if (!searching && branch) {
    const trail = [breadcrumbLabel(branch, parents, labels), labelForTag(branch, labels)]
      .filter(Boolean)
      .join(" › ");

    rows.push({
      id: `back:${branch}`,
      type: "back",
      branch,
      label: trail || "Retour"
    });
  }

  rows.push(...tagRows(tagIds, {
    parents,
    labels,
    nodes,
    usage,
    totalUsage,
    relevant,
    searching,
    selectedTag: cleanTagId(selectedTag)
  }));

  return {
    branch,
    query: text,
    rows,
    searching
  };
}
