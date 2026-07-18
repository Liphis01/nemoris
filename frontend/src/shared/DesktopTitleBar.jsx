import { useCallback, useEffect, useState } from "react";
import "./DesktopTitleBar.css";

const TITLEBAR_HEIGHT = "36px";


// The desktop launcher opens the app with ?shell=desktop: that flag is the
// render signal for the custom title bar. Browser and dev usage keep the
// plain page. The --shell-top variable is how the rest of the app makes
// room for the bar.
function useDesktopShell() {
  const [ready] = useState(
    () =>
      new URLSearchParams(window.location.search).get("shell") === "desktop"
  );

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--shell-top",
      ready ? TITLEBAR_HEIGHT : "0px"
    );
  }, [ready]);

  return ready;
}


// Window actions go through plain HTTP to the launcher-registered
// /shell/window routes — the same channel the whole app runs on, so the
// buttons work whenever the page itself does. (pywebview's injected JS
// bridge proved unreliable in frozen Windows builds: the api object could
// exist with its methods silently missing.)
function shellWindowRequest(action, method = "POST") {
  return fetch(`/shell/window/${action}`, { method })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
}


// Reports readiness plus the viewport's real screen geometry: the window
// rect and the page can disagree by a few pixels per edge, and the release
// gesture test aims at the page's actual pixels.
function reportClientReady() {
  return fetch("/shell/window/client-ready", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      screen_x: window.screenX,
      screen_y: window.screenY,
      inner_w: window.innerWidth,
      inner_h: window.innerHeight,
      dpr: window.devicePixelRatio || 1
    })
  }).catch(() => {});
}


const RESIZE_EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];


// GTK only: invisible strips along the borders that start native OS resize
// loops over HTTP. Windows uses WM_NCHITTEST on the host window instead
// (strips would claim the edge pixels as client and block it).
function ResizeEdges() {
  return RESIZE_EDGES.map((edge) => (
    <div
      key={edge}
      className={`shell-resize-edge shell-resize-edge--${edge}`}
      onPointerDown={(event) => {
        if (event.button === 0) {
          shellWindowRequest(`start-resize?edge=${edge}`);
        }
      }}
      aria-hidden="true"
    />
  ));
}


function DesktopTitleBar() {
  const ready = useDesktopShell();
  const [maximized, setMaximized] = useState(true);
  const [platform, setPlatform] = useState(null);

  const syncWindowState = useCallback(() => {
    shellWindowRequest("state", "GET").then((state) => {
      if (typeof state?.maximized === "boolean") {
        setMaximized(state.maximized);
      }

      if (state?.platform) {
        setPlatform(state.platform);
      }
    });
  }, []);

  // The window opens maximized by default; confirm the real state so the
  // restore/maximize glyph is right even if that ever changes. Also tell
  // the launcher the title bar exists — the release gesture test waits for
  // this before simulating input.
  useEffect(() => {
    if (!ready) return;

    syncWindowState();
    reportClientReady();
  }, [ready, syncWindowState]);

  // Native gestures (caption drag-restore, Aero Snap, OS resize) bypass our
  // JS entirely but always resize the viewport: re-learn the real state.
  useEffect(() => {
    if (!ready) return undefined;

    let timer = null;

    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        syncWindowState();
        reportClientReady();
      }, 250);
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [ready, syncWindowState]);

  const toggleMaximize = useCallback(() => {
    shellWindowRequest("toggle-maximize").then((state) => {
      if (typeof state?.maximized === "boolean") {
        setMaximized(state.maximized);
      }
    });
  }, []);

  // On Windows the native caption (app-region: drag) swallows these events,
  // so this only fires on GTK — or as a fallback on a WebView2 runtime too
  // old for non-client region support.
  const onDragPointerDown = (event) => {
    // detail === 1 keeps the second press of a double-click for the
    // maximize toggle instead of starting another native drag.
    if (event.button === 0 && event.detail === 1) {
      // Dragging restores a maximized window; re-sync the glyph after.
      shellWindowRequest("start-drag").then(() => {
        setTimeout(syncWindowState, 400);
      });
    }
  };

  if (!ready) {
    return null;
  }

  return (
    <>
      <header className="desktop-titlebar">
        <div
          className="desktop-titlebar__drag"
          onPointerDown={onDragPointerDown}
          onDoubleClick={toggleMaximize}
        >
          <img className="desktop-titlebar__icon" src="/favicon.svg" alt="" />
          <span className="desktop-titlebar__title">Nemoris</span>
        </div>

        <button
          type="button"
          className="desktop-titlebar__button"
          onClick={() => shellWindowRequest("minimize")}
          aria-label="Réduire"
          tabIndex={-1}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>

        <button
          type="button"
          className="desktop-titlebar__button"
          onClick={toggleMaximize}
          aria-label={maximized ? "Restaurer" : "Agrandir"}
          tabIndex={-1}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path
                d="M2.5 2.5V.5h7v7h-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.1"
              />
              <rect
                x="0.5"
                y="2.5"
                width="7"
                height="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.1"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect
                x="0.5"
                y="0.5"
                width="9"
                height="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.1"
              />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="desktop-titlebar__button desktop-titlebar__button--close"
          onClick={() => shellWindowRequest("close")}
          aria-label="Fermer"
          tabIndex={-1}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path
              d="M0 0l10 10M10 0L0 10"
              stroke="currentColor"
              strokeWidth="1.1"
            />
          </svg>
        </button>
      </header>
      {/* GTK only: Windows resizes via native WM_NCHITTEST borders, and
          these strips (app-region: no-drag) would force those edge pixels
          back to client and block it. */}
      {platform === "gtk" && !maximized && <ResizeEdges />}
    </>
  );
}

export default DesktopTitleBar;
