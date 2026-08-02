import { normalizeKey } from "./tagGraph";
import { labelForTag } from "./tagLabels";
import {
  allTagKeys,
  breadcrumbLabel,
  browseLevel,
  hasChildren,
  searchTags
} from "./tagTree";


function cleanQuery(value) {
  return String(value || "").trim();
}


function materializedSuggestionKeys(nodes = {}) {
  return new Set(
    Object.values(nodes || {})
      .map(node => node?.suggestion_key)
      .filter(Boolean)
  );
}


function sortedSuggestionRows({ query, suggestions = [], branch, labels, nodes }) {
  const needle = normalizeKey(query);
  const materialized = materializedSuggestionKeys(nodes);

  if (!needle) return [];

  return suggestions
    .filter(suggestion => suggestion?.key && !materialized.has(suggestion.key))
    .filter(suggestion => normalizeKey(suggestion.label).includes(needle))
    .slice(0, 5)
    .map(suggestion => ({
      id: `suggestion:${suggestion.key}`,
      type: "suggestion",
      suggestionKey: suggestion.key,
      label: suggestion.label,
      parentId: branch || suggestion.suggested_parent_id || null,
      pathLabel: branch
        ? labelForTag(branch, labels)
        : suggestion.suggested_parent_id
          ? labelForTag(suggestion.suggested_parent_id, labels)
          : ""
    }));
}


function tagRows(tagIds, { parents, labels, usage, searching }) {
  return tagIds.map(tagId => {
    const openable = hasChildren(tagId, parents);
    return {
      id: `tag:${tagId}`,
      type: openable ? "branch" : "existing",
      tagId,
      label: labelForTag(tagId, labels),
      count: usage?.[tagId] || 0,
      breadcrumb: searching ? breadcrumbLabel(tagId, parents, labels) : "",
      openable
    };
  });
}


export function flattenTagPickerGroups(groups = []) {
  return groups.flatMap(group => group.rows || []);
}


export function buildTagPickerModel({
  query,
  branch = null,
  appliedTags = [],
  parents = {},
  labels = {},
  nodes = {},
  usage = {},
  suggestions = [],
  extraKeys = [],
  allowCreate = true
} = {}) {
  const text = cleanQuery(query);
  const searching = Boolean(normalizeKey(text));
  const applied = new Set((appliedTags || []).map(tag => String(tag || "").trim()));
  const keys = new Set(
    [...allTagKeys({ parents, labels }, extraKeys)]
      .filter(key => !nodes[key]?.hidden)
  );
  const context = { keys, parents, labels, nodes };
  const tagIds = (searching ? searchTags(text, context) : browseLevel(branch, context))
    .filter(tagId => !applied.has(tagId));
  const existingRows = tagRows(tagIds, { parents, labels, usage, searching });
  const groups = [];

  if (!searching && branch) {
    const trail = [breadcrumbLabel(branch, parents, labels), labelForTag(branch, labels)]
      .filter(Boolean)
      .join(" › ");
    groups.push({
      id: "navigation",
      label: "",
      rows: [{
        id: `back:${branch}`,
        type: "back",
        branch,
        label: trail
      }]
    });
  }

  if (existingRows.length) {
    groups.push({
      id: searching ? "existing" : "browse",
      label: searching ? "Tags existants" : "",
      rows: existingRows
    });
  }

  if (searching) {
    const suggestionRows = sortedSuggestionRows({
      query: text,
      suggestions,
      branch,
      labels,
      nodes
    });
    if (suggestionRows.length) {
      groups.push({ id: "suggestions", label: "Suggestions", rows: suggestionRows });
    }

    const exactExistingLabel = [...keys].some(key =>
      normalizeKey(labelForTag(key, labels)) === normalizeKey(text)
    );
    if (allowCreate && !exactExistingLabel) {
      groups.push({
        id: "create",
        label: "Créer",
        rows: [{
          id: "create",
          type: "create",
          label: text,
          parentId: branch || null,
          pathLabel: branch ? labelForTag(branch, labels) : ""
        }]
      });
    }
  }

  return {
    groups,
    rows: flattenTagPickerGroups(groups),
    searching,
    query: text,
    branch
  };
}
