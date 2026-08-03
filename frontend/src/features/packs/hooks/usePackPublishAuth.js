import { useCallback, useEffect, useState } from "react";
import {
  backfillPackInstalls,
  getPackPublishStatus,
  requestPackPublishCode,
  signOutPackPublisher,
  verifyPackPublishCode
} from "../../../api/packs";

// Shared catalog sign-in flow: used both by the creator/export tab and by
// the reviews UI in the browse/import tab, since leaving a rating or
// comment needs the same Supabase login as publishing a pack.
export function usePackPublishAuth() {
  const [publishStatus, setPublishStatus] = useState(null);
  const [authStep, setAuthStep] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const status = await getPackPublishStatus();
    setPublishStatus(status);

    if (status.account_email) {
      setEmail(status.account_email);
    }

    return status;
  }, []);

  useEffect(() => {
    let cancelled = false;

    refresh().catch((refreshError) => {
      console.error(refreshError);

      if (!cancelled) {
        setError(refreshError.message || "Publication indisponible.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function requestCode() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await requestPackPublishCode(email.trim());
      setAuthStep("code");
      setMessage("Code envoyé par e-mail.");
    } catch (requestError) {
      console.error(requestError);
      setError(requestError.message || "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const status = await verifyPackPublishCode(email.trim(), code.trim());
      setPublishStatus(status);
      setAuthStep("email");
      setCode("");
      setMessage("Connecté au catalogue.");

      // Best-effort, fire-and-forget: claims any packs installed
      // anonymously before this sign-in so they become retroactively
      // eligible to rate/comment. Must never block or fail the sign-in.
      backfillPackInstalls().catch((backfillError) => {
        console.error(backfillError);
      });

      await refresh();
    } catch (verifyError) {
      console.error(verifyError);
      setError(verifyError.message || "Code invalide.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const status = await signOutPackPublisher();
      setPublishStatus(status);
    } catch (signOutError) {
      console.error(signOutError);
      setError(signOutError.message || "Déconnexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  return {
    publishStatus,
    authStep,
    setAuthStep,
    email,
    setEmail,
    code,
    setCode,
    busy,
    message,
    error,
    refresh,
    requestCode,
    verifyCode,
    signOut
  };
}
