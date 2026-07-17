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


// Starting a native OS resize loop from the corner grip: the backend posts
// a non-client hit (Windows) or begins a GTK resize drag while the mouse
// button is still held.
function ResizeGrip() {
  const onPointerDown = (event) => {
    if (event.button === 0) {
      shellWindowRequest("start-resize");
    }
  };

  return (
    <div
      className="desktop-resize-grip"
      onPointerDown={onPointerDown}
      aria-hidden="true"
    >
      <svg width="12" height="12" viewBox="0 0 12 12">
        <path
          d="M11 1 1 11M11 6 6 11"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
        />
      </svg>
    </div>
  );
}


function DesktopTitleBar() {
  const ready = useDesktopShell();
  const [maximized, setMaximized] = useState(true);

  // The window opens maximized by default; confirm the real state so the
  // restore/maximize glyph is right even if that ever changes.
  useEffect(() => {
    if (!ready) return;

    shellWindowRequest("state", "GET").then((state) => {
      if (typeof state?.maximized === "boolean") {
        setMaximized(state.maximized);
      }
    });
  }, [ready]);

  const toggleMaximize = useCallback(() => {
    shellWindowRequest("toggle-maximize").then((state) => {
      if (typeof state?.maximized === "boolean") {
        setMaximized(state.maximized);
      }
    });
  }, []);

  const onDragPointerDown = (event) => {
    // detail === 1 keeps the second press of a double-click for the
    // maximize toggle instead of starting another native drag.
    if (event.button === 0 && event.detail === 1) {
      shellWindowRequest("start-drag");
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
      <ResizeGrip />
    </>
  );
}

export default DesktopTitleBar;
