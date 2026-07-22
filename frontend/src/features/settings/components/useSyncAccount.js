import { useCallback, useEffect, useState } from "react";
import {
  deleteAccountData,
  getSyncStatus,
  requestSyncCode,
  setSyncPreferences,
  setSyncServerUrl,
  syncPull,
  syncPush,
  syncSignOut,
  verifySyncCode
} from "../../../api/sync";

const DEFAULT_SERVER = "http://127.0.0.1:9000";

export function useSyncAccount() {
  const [status, setStatus] = useState(null);
  const [serverDraft, setServerDraft] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [step, setStep] = useState("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getSyncStatus();
      setStatus(next);
      setServerDraft(next.server_url || DEFAULT_SERVER);
      setKeyDraft(next.server_key || "");
    } catch (statusError) {
      setError(statusError.message || "Statut indisponible.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run(action, successMessage) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await action();
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (actionError) {
      setError(actionError.message || "Action impossible.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveServer() {
    await run(async () => {
      await setSyncServerUrl(serverDraft.trim(), keyDraft.trim());
      await refresh();
    }, "Serveur enregistré.");
  }

  async function setAutoSyncEnabled(enabled) {
    await run(async () => {
      const next = await setSyncPreferences({
        auto_sync_enabled: Boolean(enabled)
      });
      setStatus(next);
      setServerDraft(next.server_url || DEFAULT_SERVER);
      setKeyDraft(next.server_key || "");
    }, enabled
      ? "Synchronisation automatique activée."
      : "Synchronisation automatique désactivée.");
  }

  async function sendCode() {
    const result = await run(
      () => requestSyncCode(email.trim()),
      "Code envoyé."
    );

    if (result) {
      setStep("code");
      // The fake/dev server returns the code so local testing is frictionless;
      // a real server emails it and returns nothing here.
      setDevCode(result.code || "");
    }
  }

  async function signIn() {
    const ok = await run(async () => {
      await verifySyncCode(email.trim(), code.trim());
      await refresh();
      return true;
    }, "Connecté.");

    if (ok) {
      setStep("email");
      setCode("");
      setDevCode("");
    }
  }

  async function doPush(force = false) {
    setConflict(null);
    const result = await run(() => syncPush({ force }), null);
    if (!result) return;

    if (result.status === "conflict") {
      setConflict(result.server_version);
    } else {
      setMessage(`Envoyé (v${result.version}).`);
      await refresh();
    }
  }

  async function doPull() {
    const confirmed = window.confirm(
      "Télécharger remplacera les données de cet appareil par la copie du " +
        "cloud. Continuer ?"
    );

    if (!confirmed) return;

    const result = await run(() => syncPull(), null);
    if (!result) return;

    if (result.status === "empty") {
      setMessage("Aucune collection sur le cloud pour l'instant.");
      return;
    }

    // The whole local DB was replaced; reload so every view refetches.
    setMessage("Téléchargé. Rechargement...");
    window.location.reload();
  }

  async function signOut() {
    await run(async () => {
      await syncSignOut();
      await refresh();
    }, null);
    setConflict(null);
  }

  async function deleteCloudData() {
    const confirmed = window.confirm(
      "Supprime définitivement ta collection, ses versions et ses médias du " +
        "cloud. Cette action est irréversible — pense à exporter une " +
        "sauvegarde d'abord (section Données) si tu veux garder une " +
        "copie. Ton adresse e-mail de connexion n'est pas supprimée : tu " +
        "pourras te reconnecter, mais il n'y aura plus rien à synchroniser. " +
        "Continuer ?"
    );

    if (!confirmed) return;

    await run(async () => {
      await deleteAccountData();
      await refresh();
    }, "Données cloud supprimées.");
    setConflict(null);
  }

  const signedIn = Boolean(status?.signed_in);
  const serverVersion = status?.server_meta?.version ?? 0;

  return {
    status,
    serverDraft,
    setServerDraft,
    keyDraft,
    setKeyDraft,
    email,
    setEmail,
    code,
    setCode,
    devCode,
    step,
    busy,
    message,
    error,
    conflict,
    signedIn,
    serverVersion,
    saveServer,
    setAutoSyncEnabled,
    sendCode,
    signIn,
    doPush,
    doPull,
    signOut,
    deleteCloudData
  };
}
