import { useEffect, useState } from "react";
import {
  getReviewSettings,
  rebalanceReviewCalendar,
  updateReviewSettings
} from "../../../api/review";

const panelStyle = {
  background: "#181818",
  border: "1px solid #262626",
  borderRadius: "10px",
  padding: "22px"
};

const inputStyle = {
  background: "#151515",
  border: "1px solid #2a2a2a",
  color: "#eee",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "14px",
  outline: "none",
  width: "140px"
};

const buttonStyle = {
  background: "#1f2d24",
  border: "1px solid #385544",
  color: "#d7f5df",
  borderRadius: "8px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: "650",
  padding: "10px 14px"
};

function normalizeTarget(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.floor(parsed));
}

export default function Settings({ setMode }) {
  const [target, setTarget] = useState(50);
  const [draft, setDraft] = useState("50");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError("");
    setStatus("");

    getReviewSettings()
      .then((settings) => {
        if (cancelled) return;

        const loadedTarget = settings.catchup_daily_target || 50;
        setTarget(loadedTarget);
        setDraft(String(loadedTarget));
        setLoading(false);
      })
      .catch((settingsError) => {
        console.error(settingsError);

        if (!cancelled) {
          setError(settingsError.message || "Paramètres impossibles à charger.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function saveTarget() {
    const nextTarget = normalizeTarget(draft, target);

    if (nextTarget === target) {
      setDraft(String(target));
      setStatus("");
      setError("");
      return;
    }

    setSaving(true);
    setError("");
    setStatus("");

    try {
      const settings = await updateReviewSettings({
        catchup_daily_target: nextTarget
      });
      const savedTarget = settings.catchup_daily_target || nextTarget;

      setTarget(savedTarget);
      setDraft(String(savedTarget));
      await rebalanceReviewCalendar();
      setStatus("Paramètres enregistrés. Calendrier rééquilibré.");
    } catch (saveError) {
      console.error(saveError);
      setDraft(String(target));
      setError(saveError.message || "Paramètres impossibles à enregistrer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#111",
        color: "#eee",
        padding: "30px 24px 80px",
        boxSizing: "border-box"
      }}
    >
      <div
        style={{
          maxWidth: "780px",
          margin: "0 auto"
        }}
      >
        <div
          style={{
            alignItems: "flex-start",
            display: "flex",
            gap: "20px",
            justifyContent: "space-between",
            marginBottom: "28px"
          }}
        >
          <div>
            <div
              style={{
                color: "#666",
                fontSize: "12px",
                letterSpacing: "0.08em",
                marginBottom: "8px"
              }}
            >
              SETTINGS
            </div>

            <h1
              style={{
                fontSize: "38px",
                lineHeight: 1,
                margin: "0 0 12px"
              }}
            >
              Paramètres
            </h1>
          </div>

          <button
            type="button"
            onClick={() => setMode("menu")}
            style={{
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: "8px",
              color: "#bbb",
              cursor: "pointer",
              fontSize: "14px",
              padding: "10px 14px"
            }}
          >
            ← Retour
          </button>
        </div>

        <div style={panelStyle}>
          {loading ? (
            <div
              style={{
                color: "#777",
                padding: "32px 0",
                textAlign: "center"
              }}
            >
              Chargement des paramètres...
            </div>
          ) : (
            <>
              <div
                style={{
                  color: "#777",
                  fontSize: "12px",
                  fontWeight: "700",
                  letterSpacing: "0.06em",
                  marginBottom: "10px"
                }}
              >
                REVIEW
              </div>

              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  marginBottom: "18px"
                }}
              >
                <span
                  style={{
                    color: "#e5e5e5",
                    fontSize: "16px",
                    fontWeight: "700"
                  }}
                >
                  Objectif quotidien
                </span>

                <input
                  aria-label="Objectif quotidien"
                  type="number"
                  min="1"
                  max="10000"
                  value={draft}
                  disabled={saving}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      saveTarget();
                    }
                  }}
                  style={inputStyle}
                />
              </label>

              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "12px"
                }}
              >
                <button
                  type="button"
                  onClick={saveTarget}
                  disabled={saving}
                  style={{
                    ...buttonStyle,
                    background: saving ? "#202020" : buttonStyle.background,
                    color: saving ? "#888" : buttonStyle.color,
                    cursor: saving ? "default" : "pointer"
                  }}
                >
                  {saving ? "Enregistrement..." : "Enregistrer"}
                </button>

                {status && (
                  <div
                    style={{
                      color: "#9bd9aa",
                      fontSize: "14px"
                    }}
                  >
                    {status}
                  </div>
                )}
              </div>
            </>
          )}

          {error && (
            <div
              role="alert"
              style={{
                color: "#ff9c9c",
                fontSize: "14px",
                marginTop: "18px"
              }}
            >
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
