import { useEffect, useState } from "react";
import {
  getSyncStatus,
  requestSyncCode,
  setSyncServerUrl,
  syncPull,
  syncPush,
  syncSignOut,
  verifySyncCode
} from "../../../api/sync";

const DEFAULT_SERVER = "http://127.0.0.1:9000";

export default function SyncAccountSection() {
  const [status, setStatus] = useState(null);
  const [serverDraft, setServerDraft] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [step, setStep] = useState("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(null);

  async function refresh() {
    try {
      const next = await getSyncStatus();
      setStatus(next);
      setServerDraft(next.server_url || DEFAULT_SERVER);
    } catch (statusError) {
      setError(statusError.message || "Statut indisponible.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

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
      await setSyncServerUrl(serverDraft.trim());
      await refresh();
    }, "Serveur enregistré.");
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

  const signedIn = status?.signed_in;
  const serverVersion = status?.server_meta?.version ?? 0;

  return (
    <section className="settings-panel">
      <div className="settings-section-head">
        <span className="settings-section-icon" aria-hidden="true">
          ☁
        </span>
        <div>
          <div className="settings-overline">Compte</div>
          <h2>Synchronisation</h2>
        </div>
      </div>

      <label className="settings-field">
        <span className="settings-label">Serveur de sync</span>
        <span className="settings-control">
          <input
            aria-label="Serveur de sync"
            type="text"
            value={serverDraft}
            disabled={busy}
            onChange={(event) => setServerDraft(event.target.value)}
            onBlur={saveServer}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveServer();
            }}
            className="settings-input"
          />
        </span>
      </label>

      {!signedIn && (
        <>
          {step === "email" ? (
            <>
              <label className="settings-field">
                <span className="settings-label">E-mail du compte</span>
                <span className="settings-control">
                  <input
                    aria-label="E-mail du compte"
                    type="email"
                    value={email}
                    disabled={busy}
                    placeholder="vous@exemple.com"
                    onChange={(event) => setEmail(event.target.value)}
                    className="settings-input"
                  />
                </span>
              </label>
              <div className="settings-actions">
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={busy || !email.trim()}
                  className="settings-save"
                >
                  {busy ? "..." : "Recevoir un code"}
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="settings-field">
                <span className="settings-label">Code de connexion</span>
                <span className="settings-control">
                  <input
                    aria-label="Code de connexion"
                    type="text"
                    value={code}
                    disabled={busy}
                    onChange={(event) => setCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") signIn();
                    }}
                    className="settings-input"
                  />
                </span>
              </label>
              {devCode && (
                <p className="settings-help">Code (dev) : {devCode}</p>
              )}
              <div className="settings-actions">
                <button
                  type="button"
                  onClick={signIn}
                  disabled={busy || !code.trim()}
                  className="settings-save"
                >
                  {busy ? "..." : "Se connecter"}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {signedIn && (
        <>
          <p className="settings-help">
            Connecté en tant que <strong>{status.account_email}</strong>.
            Dernière version synchronisée : v{status.last_server_version}
            {serverVersion ? ` — cloud : v${serverVersion}` : ""}.
          </p>

          {conflict != null && (
            <div role="alert" className="settings-alert">
              La copie cloud est plus récente (v{conflict}). Téléchargez-la
              (écrase cet appareil) ou envoyez quand même (écrase le cloud).
              <div className="settings-actions" style={{ marginTop: "10px" }}>
                <button
                  type="button"
                  onClick={doPull}
                  disabled={busy}
                  className="settings-secondary"
                >
                  Télécharger
                </button>
                <button
                  type="button"
                  onClick={() => doPush(true)}
                  disabled={busy}
                  className="settings-secondary"
                >
                  Envoyer quand même
                </button>
              </div>
            </div>
          )}

          <div className="settings-actions">
            <button
              type="button"
              onClick={() => doPush(false)}
              disabled={busy}
              className="settings-save"
            >
              {busy ? "..." : "Envoyer vers le cloud"}
            </button>
            <button
              type="button"
              onClick={doPull}
              disabled={busy}
              className="settings-secondary"
            >
              Télécharger
            </button>
            <button
              type="button"
              onClick={signOut}
              disabled={busy}
              className="settings-secondary"
            >
              Se déconnecter
            </button>
          </div>
        </>
      )}

      {message && (
        <div className="settings-status" role="status">
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="settings-alert">
          {error}
        </div>
      )}
    </section>
  );
}
