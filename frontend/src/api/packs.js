import { requestJson } from "./http";


export function listInstalledPacks() {
  return requestJson("/packs");
}

export function getPackCatalogSettings() {
  return requestJson("/packs/catalog-settings");
}

export function savePackCatalogSettings(settings) {
  const payload = typeof settings === "string" ? { url: settings } : settings;

  return requestJson("/packs/catalog-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: payload?.url || "",
      key: payload?.key || ""
    })
  });
}

export function searchPackCatalog(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  });

  const suffix = query.toString();
  return requestJson(`/packs/catalog/search${suffix ? `?${suffix}` : ""}`);
}


export function getPackCatalogDiagnostics() {
  return requestJson("/packs/catalog/diagnostics");
}


export function getPackPublishStatus() {
  return requestJson("/packs/catalog/publish/status");
}


export function requestPackPublishCode(email) {
  return requestJson("/packs/catalog/publish/request-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
}


export function verifyPackPublishCode(email, code) {
  return requestJson("/packs/catalog/publish/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code })
  });
}


export function signOutPackPublisher() {
  return requestJson("/packs/catalog/publish/sign-out", { method: "POST" });
}


export function listPackPublications() {
  return requestJson("/packs/catalog/publish/drafts");
}


export function savePackDraft(groupId, payload) {
  return requestJson(`/packs/${groupId}/publish/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}


export function savePlaylistDraft(collectionId, payload) {
  return requestJson(`/packs/playlists/${collectionId}/publish/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}


export function publishPackDraft(packGuid) {
  return requestJson(`/packs/catalog/publish/${packGuid}`, {
    method: "POST"
  });
}


/**
 * Upload the pack and make it public in one step.
 *
 * There is no user-facing draft state: nothing happens between saving and
 * publishing (no review, no moderation), and unpublishing is already a
 * one-click reversible undo, so a separate "brouillon" step bought nothing.
 */
export async function publishPack(source, payload) {
  const draft = source.collectionId
    ? await savePlaylistDraft(source.collectionId, payload)
    : await savePackDraft(source.groupId, payload);

  return publishPackDraft(draft.publication.pack_guid);
}


// Plain fetch, not requestJson: these hit an external catalog URL, not this
// app's own backend, so apiUrl()'s base-URL prefixing must not apply.
export async function fetchCatalog(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Impossible de charger le catalogue.");
  }

  return response.json();
}

async function fetchPackZipBlob(downloadUrl) {
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error("Téléchargement impossible.");
  }

  return response.blob();
}

export async function installPackFromCatalog(entry) {
  const blob = await fetchPackZipBlob(entry.download_url);
  const formData = new FormData();
  formData.append("file", blob, `${entry.pack_guid}.zip`);

  return requestJson("/packs/import", { method: "POST", body: formData });
}

export async function updatePackFromCatalog(entry, { deleteRemoved = false } = {}) {
  const blob = await fetchPackZipBlob(entry.download_url);
  const formData = new FormData();
  formData.append("file", blob, `${entry.pack_guid}.zip`);

  return requestJson(
    `/packs/update?delete_removed=${deleteRemoved}`,
    { method: "POST", body: formData }
  );
}

export function unsubscribePack(packGuid, { deleteContent = false } = {}) {
  return requestJson(
    `/packs/${packGuid}/unsubscribe?delete_content=${deleteContent}`,
    { method: "POST" }
  );
}


export function unpublishPack(packGuid) {
  return requestJson(`/packs/catalog/publish/${packGuid}/unpublish`, {
    method: "POST"
  });
}


export function recordPackInstall(packGuid, installedVersion) {
  return requestJson(`/packs/catalog/${packGuid}/record-install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ installed_version: installedVersion })
  });
}


export function backfillPackInstalls() {
  return requestJson("/packs/catalog/backfill-installs", { method: "POST" });
}


export function getMyPackStatus(packGuid) {
  return requestJson(`/packs/catalog/${packGuid}/my-status`);
}


export function listPackComments(packGuid) {
  return requestJson(`/packs/catalog/${packGuid}/comments`);
}


export function addPackComment(packGuid, body) {
  return requestJson(`/packs/catalog/${packGuid}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body })
  });
}


export function ratePack(packGuid, rating) {
  return requestJson(`/packs/catalog/${packGuid}/rating`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating })
  });
}

