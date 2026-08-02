import { useEffect, useSyncExternalStore } from "react";

import { getTags } from "../api/tags";


const EMPTY_SNAPSHOT = {
  version: 3,
  revision: 0,
  locale: "fr",
  nodes: {},
  entries: [],
  parents: {},
  labels: {},
  labelMaps: {},
  usage: {},
  totalUsage: {},
  suggestions: [],
  inbox: { pending: [], conflicts: [], count: 0 },
  loaded: false
};

let snapshot = EMPTY_SNAPSHOT;
let loadPromise = null;
let loadGeneration = 0;
const listeners = new Set();


function emit() {
  listeners.forEach(listener => listener());
}


function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}


function getSnapshot() {
  return snapshot;
}


function legacyEntries(data) {
  const hierarchy = data?.hierarchy || {};
  const parents = hierarchy.parents || {};
  const labels = { ...(data?.displays || {}), ...(hierarchy.labels || {}) };
  const keys = new Set(Object.keys(labels));
  Object.entries(parents).forEach(([child, parentIds]) => {
    keys.add(child);
    (parentIds || []).forEach(parent => keys.add(parent));
  });
  return [...keys].map(id => ({
    id,
    label: labels[id] || prettifyTagId(id),
    labels: { fr: labels[id] || prettifyTagId(id) },
    default_locale: "fr",
    parents: parents[id] || [],
    direct_count: data?.usage?.[id] || 0,
    total_count: data?.total_usage?.[id] ?? data?.usage?.[id] ?? 0,
    kind: id.startsWith("core:") ? "core" : "custom",
    origin: "local",
    pack_ids: [],
    source_packs: [],
    representative_questions: [],
    classification: (parents[id] || []).length ? "placed" : "root",
    hidden: false
  }));
}


function commitTags(data = {}) {
  const entries = Array.isArray(data.nodes) ? data.nodes : legacyEntries(data);
  const nodes = Object.fromEntries(entries.map(entry => [entry.id, entry]));
  const parents = Object.fromEntries(
    entries.filter(entry => (entry.parents || []).length)
      .map(entry => [entry.id, [...entry.parents]])
  );
  const labels = Object.fromEntries(entries.map(entry => [entry.id, entry.label]));
  const labelMaps = Object.fromEntries(
    entries.map(entry => [entry.id, { ...(entry.labels || {}) }])
  );

  snapshot = {
    version: data.version || data.hierarchy?.version || 3,
    revision: data.revision ?? data.hierarchy?.revision ?? 0,
    locale: data.locale || "fr",
    nodes,
    entries,
    parents,
    labels,
    labelMaps,
    usage: data.usage || Object.fromEntries(entries.map(entry => [entry.id, entry.direct_count || 0])),
    totalUsage: data.total_usage || Object.fromEntries(entries.map(entry => [entry.id, entry.total_count || 0])),
    suggestions: data.suggestions || [],
    inbox: data.inbox || { pending: [], conflicts: [], count: 0 },
    loaded: true
  };
  emit();
  return snapshot;
}


export function primeTags(data = {}) {
  // An action/import response is authoritative. Any older GET still in flight
  // must not be allowed to overwrite it when it eventually resolves.
  loadGeneration += 1;
  loadPromise = null;
  return commitTags(data);
}


export function resetTags() {
  loadGeneration += 1;
  snapshot = EMPTY_SNAPSHOT;
  loadPromise = null;
  emit();
}


export function loadTags({ force = false } = {}) {
  if (snapshot.loaded && !force) return Promise.resolve(snapshot);
  if (loadPromise && !force) return loadPromise;

  const generation = ++loadGeneration;
  const request = getTags()
    .then(data => generation === loadGeneration ? commitTags(data) : snapshot)
    .finally(() => {
      // A completed request is not a permanent cache lock. Later question,
      // tag, or pack mutations can force a fresh authoritative snapshot.
      if (loadPromise === request) loadPromise = null;
    });
  loadPromise = request;
  return loadPromise;
}


export function invalidateTags({ reload = true } = {}) {
  loadGeneration += 1;
  loadPromise = null;
  snapshot = { ...snapshot, loaded: false };
  emit();
  return reload ? loadTags({ force: true }) : Promise.resolve(snapshot);
}


export function prettifyTagId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text)) return "Tag sans nom";
  const clean = text.replace(/^core:/, "").replace(/-/g, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}


export const prettifySlug = prettifyTagId;


export function labelForTag(tagId, labels = snapshot.labels) {
  const id = String(tagId || "").trim();
  return (labels || {})[id] || prettifyTagId(id);
}


export function useTagHierarchy() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    loadTags().catch(() => {});
  }, []);
  return state;
}


export function useTagLabels() {
  const { labels } = useTagHierarchy();
  return tagId => labelForTag(tagId, labels);
}
