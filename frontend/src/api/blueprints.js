import { requestJson, requestOk } from "./http";


export function listInstalledBlueprints() {
  return requestJson("/blueprints");
}

export function getBlueprintCatalogSettings() {
  return requestJson("/blueprints/catalog-settings");
}

export function saveBlueprintCatalogSettings(settings) {
  const payload = typeof settings === "string" ? { url: settings } : settings;

  return requestJson("/blueprints/catalog-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: payload?.url || "",
      key: payload?.key || ""
    })
  });
}

export function searchBlueprintCatalog(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  });

  const suffix = query.toString();
  return requestJson(`/blueprints/catalog/search${suffix ? `?${suffix}` : ""}`);
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

  return slug || "blueprint";
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

async function fetchBlueprintZipBlob(downloadUrl) {
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error("Téléchargement impossible.");
  }

  return response.blob();
}

export async function installBlueprintFromCatalog(entry) {
  const blob = await fetchBlueprintZipBlob(entry.download_url);
  const formData = new FormData();
  formData.append("file", blob, `${entry.blueprint_guid}.zip`);

  return requestJson("/blueprints/import", { method: "POST", body: formData });
}

export async function updateBlueprintFromCatalog(entry, { deleteRemoved = false } = {}) {
  const blob = await fetchBlueprintZipBlob(entry.download_url);
  const formData = new FormData();
  formData.append("file", blob, `${entry.blueprint_guid}.zip`);

  return requestJson(
    `/blueprints/update?delete_removed=${deleteRemoved}`,
    { method: "POST", body: formData }
  );
}

export function unsubscribeBlueprint(blueprintGuid, { deleteContent = false } = {}) {
  return requestJson(
    `/blueprints/${blueprintGuid}/unsubscribe?delete_content=${deleteContent}`,
    { method: "POST" }
  );
}

export async function exportBlueprintGroup(groupId, payload) {
  const response = await requestOk(`/blueprints/${groupId}/export`, {
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
