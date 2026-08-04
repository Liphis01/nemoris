import { requestJson, requestOk } from "./http";


function filenameFromDisposition(header) {
  if (!header) {
    return null;
  }

  // Matches both `filename="x.zip"` and RFC 5987 `filename*=UTF-8''x.zip`.
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


export async function exportDatabase() {
  const response = await requestOk("/backup/export");
  const blob = await response.blob();
  const fallback = `quiz-app-backup-${new Date().toISOString().slice(0, 10)}.zip`;
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


export function resetCollection() {
  // The backend takes a backup before wiping, so this stays recoverable
  // through importDatabase.
  return requestJson("/data/reset", { method: "POST" });
}


export function importDatabase(file) {
  const formData = new FormData();
  formData.append("file", file);

  // Let the browser set the multipart boundary; do not send Content-Type.
  return requestJson("/backup/import", {
    method: "POST",
    body: formData
  });
}
