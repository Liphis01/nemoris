import { requestJson } from "./http";


export function getSyncStatus() {
  return requestJson("/sync/status");
}

export function setSyncServerUrl(url, key) {
  return requestJson("/sync/server-url", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, key })
  });
}

export function setSyncPreferences(payload) {
  return requestJson("/sync/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function requestSyncCode(email) {
  return requestJson("/sync/request-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
}

export function verifySyncCode(email, code) {
  return requestJson("/sync/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code })
  });
}

export function syncPush({ force = false } = {}) {
  return requestJson(`/sync/push?force=${force}`, { method: "POST" });
}

export function syncPull() {
  return requestJson("/sync/pull", { method: "POST" });
}

export function syncAuto() {
  return requestJson("/sync/auto", { method: "POST" });
}

export function syncSignOut() {
  return requestJson("/sync/sign-out", { method: "POST" });
}

export function deleteAccountData() {
  return requestJson("/sync/account-data", { method: "DELETE" });
}
