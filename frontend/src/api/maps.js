import { requestJson } from "./http";


export function getMapZones(groupId) {
  return requestJson(`/maps/${groupId}/zones`);
}


export function patchMapZones(groupId, payload) {
  // Payload contains changed SVG zones; the backend upserts them as individual
  // map questions linked by group_id.
  return requestJson(`/maps/${groupId}/zones`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}


export function createMapImportFromFile(file, {
  expectedZoneCount = null,
  name = "",
  ontology = "auto"
} = {}) {
  const body = new FormData();
  body.append("file", file);
  if (expectedZoneCount) body.append("expected_zone_count", expectedZoneCount);
  if (name) body.append("name", name);
  body.append("ontology", ontology);
  return requestJson("/map-imports", { method: "POST", body });
}


export function createMapImportFromUrl(url, {
  expectedZoneCount = null,
  name = "",
  ontology = "auto"
} = {}) {
  return requestJson("/map-imports/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      expected_zone_count: expectedZoneCount || null,
      name: name || null,
      ontology
    })
  });
}


export function patchMapImport(draftId, payload) {
  return requestJson(`/map-imports/${draftId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}


export function getMapImport(draftId) {
  return requestJson(`/map-imports/${draftId}`);
}


export function listMapImports() {
  return requestJson("/map-imports");
}


export function startMapImportRepair(draftId, interpretationId) {
  return requestJson(`/map-imports/${draftId}/repair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interpretation_id: interpretationId })
  });
}


export function getMapImportRepair(draftId) {
  return requestJson(`/map-imports/${draftId}/repair`);
}


export function applyMapImportRepairAction(draftId, baseRevision, action) {
  return requestJson(`/map-imports/${draftId}/repair/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      base_revision: baseRevision,
      action
    })
  });
}


export function cancelMapImport(draftId) {
  return requestJson(`/map-imports/${draftId}`, { method: "DELETE" });
}


export function commitMapImport(draftId, name = "") {
  return requestJson(`/map-imports/${draftId}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
}


export function createMapUpgradeDraft(groupId) {
  return requestJson(`/maps/${groupId}/upgrade-draft`, { method: "POST" });
}
