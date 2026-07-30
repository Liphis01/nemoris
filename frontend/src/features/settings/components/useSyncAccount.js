import { useCallback, useEffect, useState } from "react";
import {
  deleteAccountData,
  getSyncStatus,
  requestSyncCode,
  setSyncPreferences,
  syncPull,
  syncPush,
  syncSignOut,
  verifySyncCode
} from "../../../api/sync";

// Supabase's default minimum gap between two OTP requests for the same
// email; matched here so the UI stops the user from hitting the server's
// own rate limit instead of just showing its error after the fact.
const RESEND_COOLDOWN_MS = 60_000;

export function useSyncAccount() {
  const [status, setStatus] = useState(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [step, setStep] = useState("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownSeconds(0);
      return undefined;
    }

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((cooldownUntil - Date.now()) / 1000)
      );
      setCooldownSeconds(remaining);
      if (remaining <= 0) setCooldownUntil(0);
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);

    return () => window.clearInterval(intervalId);
  }, [cooldownUntil]);

  const refresh = useCallback(async () => {
    try {
      const next = await getSyncStatus();
      setStatus(next);
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

  async function setAutoSyncEnabled(enabled) {
    await run(async () => {
      const next = await setSyncPreferences({
        auto_sync_enabled: Boolean(enabled)
      });
      setStatus(next);
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
      setCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
    }
  }

  function changeEmail() {
    setStep("email");
    setCode("");
    setDevCode("");
    setError("");
    setCooldownUntil(0);
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
    cooldownSeconds,
    signedIn,
    serverVersion,
    setAutoSyncEnabled,
    sendCode,
    changeEmail,
    signIn,
    doPush,
    doPull,
    signOut,
    deleteCloudData
  };
}
