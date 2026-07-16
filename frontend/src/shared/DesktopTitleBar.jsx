import { useCallback, useEffect, useRef, useState } from "react";
import "./DesktopTitleBar.css";

const TITLEBAR_HEIGHT = "36px";


// True once pywebview injects its JS bridge: only the desktop shell shows
// the custom title bar; browser and dev usage keep the plain page. The
// --shell-top variable is how the rest of the app makes room for the bar.
function useDesktopShell() {
  const [ready, setReady] = useState(() => Boolean(window.pywebview));

  useEffect(() => {
    if (ready) return undefined;

    const onReady = () => setReady(true);
    window.addEventListener("pywebviewready", onReady);
    return () => window.removeEventListener("pywebviewready", onReady);
  }, [ready]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--shell-top",
      ready ? TITLEBAR_HEIGHT : "0px"
    );
  }, [ready]);

  return ready;
}


function callWindowApi(method, ...args) {
  const api = window.pywebview?.api;

  if (!api?.[method]) {
    return Promise.resolve(null);
  }

  return api[method](...args);
}


// pywebview frameless windows have no OS resize borders, so a bottom-right
// grip drives the window size through the bridge instead.
function ResizeGrip() {
  const drag = useRef(null);

  const onPointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startX: event.screenX,
      startY: event.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
      raf: null
    };
  };

  const onPointerMove = (event) => {
    const state = drag.current;

    if (!state) return;

    state.targetWidth = state.width + (event.screenX - state.startX);
    state.targetHeight = state.height + (event.screenY - state.startY);

    if (!state.raf) {
      state.raf = requestAnimationFrame(() => {
        state.raf = null;
        callWindowApi("resize_to", state.targetWidth, state.targetHeight);
      });
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div
      className="desktop-resize-grip"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
  const [maximized, setMaximized] = useState(false);

  const toggleMaximize = useCallback(() => {
    callWindowApi("toggle_maximize").then((state) => {
      if (typeof state === "boolean") {
        setMaximized(state);
      }
    });
  }, []);

  if (!ready) {
    return null;
  }

  return (
    <>
      <header className="desktop-titlebar">
        <div
          className="desktop-titlebar__drag pywebview-drag-region"
          onDoubleClick={toggleMaximize}
        >
          <img className="desktop-titlebar__icon" src="/favicon.svg" alt="" />
          <span className="desktop-titlebar__title">Nemoris</span>
        </div>

        <button
          type="button"
          className="desktop-titlebar__button"
          onClick={() => callWindowApi("minimize")}
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
          onClick={() => callWindowApi("close")}
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
