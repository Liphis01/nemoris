import { requestJson, requestOk } from "./http";


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


export function publishPackDraft(packGuid) {
  return requestJson(`/packs/catalog/publish/${packGuid}`, {
    method: "POST"
  });
}


function filenameFromDisposition(header) {
  if (!header) {
    return null;
  }

  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function safeFilenameSlug(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "pack";
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

export async function exportPackGroup(groupId, payload) {
  const response = await requestOk(`/packs/${groupId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const blob = await response.blob();
  const fallback = `${safeFilenameSlug(payload?.name)}-v${payload?.version || 1}.zip`;
  const filename =
    filenameFromDisposition(response.headers.get("Content-Disposition")) ||
    fallback;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return filename;
}
