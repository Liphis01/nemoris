import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./DesktopTitleBar.css";

const TITLEBAR_HEIGHT = "36px";

async function syncResizableState(win, setMaximized) {
  const isMaximized = await win.isMaximized();
  setMaximized(isMaximized);

  const shouldBeResizable = !isMaximized;
  if ((await win.isResizable()) !== shouldBeResizable) {
    await win.setResizable(shouldBeResizable);
  }

  return isMaximized;
}

// The Rust host injects window.__NEMORIS_BACKEND__ before any app script runs
// and only ever under Tauri, so it doubles as the desktop-shell signal. In a
// plain browser it is absent and the bar never renders. The --shell-top
// variable is how the rest of the app makes room for the bar.
function useDesktopShell() {
  const [ready] = useState(
    () => typeof window !== "undefined" && Boolean(window.__NEMORIS_BACKEND__)
  );

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--shell-top",
      ready ? TITLEBAR_HEIGHT : "0px"
    );
  }, [ready]);

  return ready;
}


function DesktopTitleBar() {
  const ready = useDesktopShell();
  const [maximized, setMaximized] = useState(true);

  // Keep the maximize/restore glyph in sync with the real window state,
  // including native gestures (drag-to-restore, snap) that bypass the button.
  useEffect(() => {
    if (!ready) return undefined;

    let unlisten;
    let cancelled = false;
    const win = getCurrentWindow();

    const sync = () => syncResizableState(win, setMaximized).catch(console.error);

    sync();
    win.onResized(() => sync()).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [ready]);

  const minimize = useCallback(() => getCurrentWindow().minimize(), []);
  const toggleMaximize = useCallback(() => {
    (async () => {
      const win = getCurrentWindow();
      const wasMaximized = await syncResizableState(win, setMaximized);

      if (wasMaximized) {
        await win.setResizable(true);
      }

      await win.toggleMaximize();
      await syncResizableState(win, setMaximized);
    })().catch(console.error);
  }, []);
  const restoreFromDragRegionDoubleClick = useCallback(() => {
    if (!maximized) return;

    (async () => {
      const win = getCurrentWindow();

      if (await syncResizableState(win, setMaximized)) {
        await win.setResizable(true);
        await win.unmaximize();
        await syncResizableState(win, setMaximized);
      }
    })().catch(console.error);
  }, [maximized]);
  const close = useCallback(() => getCurrentWindow().close(), []);

  if (!ready) {
    return null;
  }

  return (
    <header className="desktop-titlebar">
      {/* Tauri handles dragging and double-click-maximize for this region. */}
      <div
        className="desktop-titlebar__drag"
        data-tauri-drag-region
        onDoubleClick={restoreFromDragRegionDoubleClick}
      >
        <img className="desktop-titlebar__icon" src="/favicon.svg" alt="" />
        <span className="desktop-titlebar__title">Nemoris</span>
      </div>

      <button
        type="button"
        className="desktop-titlebar__button"
        onClick={minimize}
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
        onClick={close}
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
  );
}

export default DesktopTitleBar;
