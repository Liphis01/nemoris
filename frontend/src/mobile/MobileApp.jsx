import { useCallback, useEffect, useMemo, useState } from "react";
import "./MobileApp.css";
import {
  getMobileReview,
  getMobileStatus,
  sendMobileAnswer
} from "./services/mobileApi";
import { resolveMobileMediaUrl } from "./services/mobileFileStore";
import {
  configureMobileSyncServer,
  pullMobileCollection,
  pushMobileCollection,
  requestMobileSyncCode,
  verifyMobileSyncCode
} from "./services/mobileSyncEngine";

const tabs = [
  { id: "review", label: "Review" },
  { id: "sync", label: "Sync" },
  { id: "status", label: "Status" },
  { id: "settings", label: "Settings" }
];

function QualityButton({ label, value, onGrade }) {
  return (
    <button className="mobile-quality-button" onClick={() => onGrade(value)}>
      {label}
    </button>
  );
}

function ReviewScreen({ onStatusChange }) {
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  const [mediaSrc, setMediaSrc] = useState("");
  const [mediaMissing, setMediaMissing] = useState(false);
  const current = items[index];

  const loadReview = useCallback(async () => {
    setError("");
    try {
      const data = await getMobileReview();
      setItems(data);
      setIndex(0);
      setRevealed(false);
      onStatusChange();
    } catch (loadError) {
      setError(loadError.message || "Review unavailable.");
    }
  }, [onStatusChange]);

  useEffect(() => {
    loadReview();
  }, [loadReview]);

  useEffect(() => {
    let alive = true;
    setMediaSrc("");
    setMediaMissing(false);

    if (current?.type_q !== "media" || !current.media) return () => {
      alive = false;
    };

    resolveMobileMediaUrl(current.media).then((src) => {
      if (!alive) return;
      setMediaSrc(src || "");
      setMediaMissing(!src);
    });

    return () => {
      alive = false;
    };
  }, [current?.id, current?.media, current?.type_q]);

  async function grade(quality) {
    if (!current) return;
    setError("");
    try {
      await sendMobileAnswer(current.id, quality);
      if (quality === 0) {
        setItems((currentItems) => [...currentItems, current]);
      }
      setRevealed(false);
      setIndex((value) => value + 1);
      onStatusChange();
    } catch (gradeError) {
      setError(gradeError.message || "Answer could not be saved.");
    }
  }

  if (error) {
    return (
      <section className="mobile-panel">
        <p className="mobile-error">{error}</p>
        <button className="mobile-primary-button" onClick={loadReview}>Retry</button>
      </section>
    );
  }

  if (!current) {
    return (
      <section className="mobile-panel mobile-empty">
        <h1>Review</h1>
        <p>No due text or media review is loaded on this device.</p>
        <button className="mobile-primary-button" onClick={loadReview}>Refresh</button>
      </section>
    );
  }

  return (
    <section className="mobile-review-screen">
      <div className="mobile-review-count">{index + 1} / {items.length}</div>
      <article className="mobile-card">
        <h1>{current.question}</h1>
        {current.type_q === "media" && current.media && mediaSrc ? (
          <img
            className="mobile-review-media"
            alt=""
            src={mediaSrc}
            onError={() => setMediaMissing(true)}
          />
        ) : null}
        {current.type_q === "media" && current.media && mediaMissing ? (
          <div className="mobile-media-missing">Media unavailable on this device.</div>
        ) : null}
        {revealed ? (
          <div className="mobile-answer">{current.answer || "No answer"}</div>
        ) : (
          <button className="mobile-primary-button" onClick={() => setRevealed(true)}>
            Reveal
          </button>
        )}
      </article>
      {revealed ? (
        <div className="mobile-quality-grid">
          <QualityButton label="Again" value={0} onGrade={grade} />
          <QualityButton label="Hard" value={1} onGrade={grade} />
          <QualityButton label="Good" value={2} onGrade={grade} />
          <QualityButton label="Easy" value={3} onGrade={grade} />
        </div>
      ) : null}
    </section>
  );
}

function formatMediaStatus(status) {
  if (!status) return "Not checked";
  const total = Number(status.total || 0);
  const downloaded = Number(status.downloaded || 0);
  const missing = Number(status.missing || 0);
  const uploaded = Number(status.uploaded || 0);
  if (!total) return "No uploaded media";
  if (missing) return `${total - missing} / ${total} cached`;
  if (downloaded) return `${downloaded} downloaded`;
  if (uploaded) return `${uploaded} uploaded`;
  return `${total} cached`;
}

function SyncScreen({ status, onStatusChange }) {
  const [serverUrl, setServerUrl] = useState("");
  const [serverKey, setServerKey] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setServerUrl(status?.server_url || "");
    setServerKey(status?.server_key || "");
    setEmail(status?.account_email || "");
  }, [status?.account_email, status?.server_key, status?.server_url]);

  async function runAction(label, operation, successMessage) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const result = await operation();
      setMessage(
        typeof successMessage === "function"
          ? successMessage(result)
          : successMessage
      );
      onStatusChange();
    } catch (actionError) {
      setError(actionError.message || "Sync action failed.");
      onStatusChange();
    } finally {
      setBusy("");
    }
  }

  async function saveServerSettings() {
    await configureMobileSyncServer(serverUrl, serverKey);
  }

  return (
    <section className="mobile-panel">
      <h1>Sync</h1>
      <div className="mobile-form-grid">
        <label className="mobile-field">
          <span>Supabase URL</span>
          <input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            autoCapitalize="none"
            inputMode="url"
            spellCheck={false}
          />
        </label>
        <label className="mobile-field">
          <span>Publishable key</span>
          <input
            value={serverKey}
            onChange={(event) => setServerKey(event.target.value)}
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <button
          className="mobile-primary-button"
          disabled={Boolean(busy)}
          onClick={() => runAction("save", saveServerSettings, "Sync server saved.")}
        >
          Save Server
        </button>
      </div>
      <div className="mobile-form-grid">
        <label className="mobile-field">
          <span>Email</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoCapitalize="none"
            inputMode="email"
            spellCheck={false}
          />
        </label>
        <button
          className="mobile-primary-button"
          disabled={Boolean(busy)}
          onClick={() => runAction(
            "code",
            async () => {
              await saveServerSettings();
              return requestMobileSyncCode(email);
            },
            "Verification code sent."
          )}
        >
          Send Code
        </button>
        <label className="mobile-field">
          <span>Code or link</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <button
          className="mobile-primary-button"
          disabled={Boolean(busy)}
          onClick={() => runAction(
            "verify",
            async () => {
              await saveServerSettings();
              await verifyMobileSyncCode(email, code);
              setCode("");
            },
            "Signed in."
          )}
        >
          Verify
        </button>
      </div>
      <div className="mobile-status-grid">
        <span>Account</span>
        <strong>{status?.account_email || "Signed out"}</strong>
        <span>Cloud version</span>
        <strong>{status?.last_server_version || 0}</strong>
        <span>Local changes</span>
        <strong>{status?.collection_dirty ? "Needs push" : "Clean"}</strong>
        <span>Media</span>
        <strong>{formatMediaStatus(status?.last_media_status)}</strong>
      </div>
      <div className="mobile-action-row">
        <button
          className="mobile-primary-button"
          disabled={Boolean(busy)}
          onClick={() => runAction(
            "pull",
            pullMobileCollection,
            (result) => `Pulled version ${result.version || 0}.`
          )}
        >
          Pull
        </button>
        <button
          className="mobile-primary-button"
          disabled={Boolean(busy)}
          onClick={() => runAction(
            "push",
            () => pushMobileCollection(),
            (result) => result.status === "conflict"
              ? `Conflict with cloud version ${result.server_version}.`
              : `Pushed version ${result.version || 0}.`
          )}
        >
          Push
        </button>
      </div>
      {status?.last_sync_status === "conflict" ? (
        <div className="mobile-conflict-box">
          <strong>Sync conflict</strong>
          <div className="mobile-action-row">
            <button
              className="mobile-primary-button"
              disabled={Boolean(busy)}
              onClick={() => runAction(
                "force-push",
                () => pushMobileCollection({ force: true }),
                (result) => `Uploaded phone copy as version ${result.version || 0}.`
              )}
            >
              Upload Phone Copy
            </button>
            <button
              className="mobile-primary-button"
              disabled={Boolean(busy)}
              onClick={() => runAction(
                "conflict-pull",
                pullMobileCollection,
                (result) => `Downloaded cloud copy version ${result.version || 0}.`
              )}
            >
              Download Cloud Copy
            </button>
          </div>
        </div>
      ) : null}
      {busy ? <p className="mobile-note">Working...</p> : null}
      {message ? <p className="mobile-success">{message}</p> : null}
      {error || status?.last_sync_error ? (
        <p className="mobile-error">{error || status.last_sync_error}</p>
      ) : null}
    </section>
  );
}

function StatusScreen({ status }) {
  return (
    <section className="mobile-panel">
      <h1>Status</h1>
      <div className="mobile-status-grid">
        <span>Questions</span>
        <strong>{status?.question_count || 0}</strong>
        <span>Due now</span>
        <strong>{status?.due_count || 0}</strong>
        <span>Signed in</span>
        <strong>{status?.signed_in ? "Yes" : "No"}</strong>
        <span>Last sync</span>
        <strong>{status?.last_sync_status || "Never"}</strong>
        <span>Media cache</span>
        <strong>{formatMediaStatus(status?.last_media_status)}</strong>
      </div>
      {status?.last_sync_error ? (
        <p className="mobile-error">{status.last_sync_error}</p>
      ) : null}
    </section>
  );
}

function SettingsScreen() {
  return (
    <section className="mobile-panel">
      <h1>Settings</h1>
      <p className="mobile-note">
        Mobile v1 is review-only. Content editing and Manage stay on desktop.
      </p>
    </section>
  );
}

export default function MobileApp() {
  const [activeTab, setActiveTab] = useState("review");
  const [status, setStatus] = useState(null);

  const refreshStatus = useCallback(() => {
    getMobileStatus()
      .then(setStatus)
      .catch((error) => {
        setStatus((current) => ({
          ...(current || {}),
          last_sync_error: error.message || "Status unavailable"
        }));
      });
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const screen = useMemo(() => {
    if (activeTab === "sync") return <SyncScreen status={status} onStatusChange={refreshStatus} />;
    if (activeTab === "status") return <StatusScreen status={status} />;
    if (activeTab === "settings") return <SettingsScreen />;
    return <ReviewScreen onStatusChange={refreshStatus} />;
  }, [activeTab, refreshStatus, status]);

  return (
    <main className="mobile-app-shell">
      <header className="mobile-topbar">
        <div>
          <span className="mobile-brand">Nemoris</span>
          <span className="mobile-subtitle">Mobile review</span>
        </div>
        <span className={status?.collection_dirty ? "mobile-dirty" : "mobile-clean"}>
          {status?.collection_dirty ? "Unsynced" : "Clean"}
        </span>
      </header>
      <div className="mobile-screen-slot">{screen}</div>
      <nav className="mobile-tabbar" aria-label="Mobile navigation">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </main>
  );
}
