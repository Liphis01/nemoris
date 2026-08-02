import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import DesktopTitleBar from "./DesktopTitleBar";
import "./DesktopStartupGate.css";

const BACKEND_STATUS_EVENT = "backend://status";
const VALID_PHASES = new Set(["starting", "ready", "failed"]);

function desktopBackendIsPresent() {
  return typeof window !== "undefined" && Boolean(window.__NEMORIS_BACKEND__);
}

function mergeBackendPhase(current, next) {
  if (!VALID_PHASES.has(next)) return current;

  // Listening is registered before the snapshot is requested. If readiness is
  // emitted while that request is in flight, its older "starting" response
  // must not move the UI backwards.
  if (current === "ready" && next === "starting") return current;

  return next;
}

function StartupScreen({ phase }) {
  const [relaunching, setRelaunching] = useState(false);
  const [relaunchError, setRelaunchError] = useState("");
  const failed = phase === "failed";

  const restart = useCallback(() => {
    setRelaunching(true);
    setRelaunchError("");

    relaunch().catch((error) => {
      console.error(error);
      setRelaunchError("La relance a échoué. Fermez puis rouvrez Nemoris.");
      setRelaunching(false);
    });
  }, []);

  return (
    <main
      className="desktop-startup"
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
    >
      <div className="desktop-startup__card">
        <img className="desktop-startup__logo" src="/favicon.svg" alt="" />
        {!failed && <span className="desktop-startup__spinner" aria-hidden="true" />}
        <h1>{failed ? "Nemoris n’a pas pu démarrer" : "Démarrage de Nemoris…"}</h1>
        <p>
          {failed
            ? "Le service interne ne répond pas. Vos données n’ont pas été modifiées."
            : "Préparation de votre espace de révision."}
        </p>
        {failed && (
          <button
            className="desktop-startup__retry"
            type="button"
            onClick={restart}
            disabled={relaunching}
          >
            {relaunching ? "Relance…" : "Relancer Nemoris"}
          </button>
        )}
        {relaunchError && <p className="desktop-startup__error">{relaunchError}</p>}
      </div>
    </main>
  );
}

function DesktopStartupGate({ children }) {
  const desktop = desktopBackendIsPresent();
  const [phase, setPhase] = useState(() => (desktop ? "starting" : "ready"));

  useEffect(() => {
    if (!desktop) return undefined;

    let disposed = false;
    let unlisten;

    const applyStatus = (status) => {
      if (disposed) return;
      setPhase((current) => mergeBackendPhase(current, status?.phase));
    };

    const connect = async () => {
      try {
        const stopListening = await listen(BACKEND_STATUS_EVENT, (event) => {
          applyStatus(event.payload);
        });

        if (disposed) {
          stopListening();
          return;
        }

        unlisten = stopListening;
        applyStatus(await invoke("backend_status"));
      } catch (error) {
        console.error(error);
        if (!disposed) {
          setPhase((current) => (current === "ready" ? current : "failed"));
        }
      }
    };

    connect();

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [desktop]);

  return (
    <>
      <DesktopTitleBar />
      {phase === "ready" ? children : <StartupScreen phase={phase} />}
    </>
  );
}

export default DesktopStartupGate;
