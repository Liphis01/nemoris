import { requestJson } from "./http";


export function listInstalledBlueprints() {
  return requestJson("/blueprints");
}

export function getBlueprintCatalogSettings() {
  return requestJson("/blueprints/catalog-settings");
}

export function saveBlueprintCatalogSettings(url) {
  return requestJson("/blueprints/catalog-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
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
