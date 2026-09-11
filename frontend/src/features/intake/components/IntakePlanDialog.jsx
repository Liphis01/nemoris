import { useCallback, useEffect, useRef, useState } from "react";

import { planSummary } from "../intakePlanModel";
import { useIntakePlan } from "../useIntakePlan";
import IntakeDeckDetail from "./IntakeDeckDetail";
import IntakePlanOverview from "./IntakePlanOverview";
import "./IntakePlan.css";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");


function trapFocus(event, container) {
  // Closed menus and collapsed panels are not rendered, so everything the
  // query finds is reachable.
  const focusable = Array.from(container?.querySelectorAll(FOCUSABLE) || []);

  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && (document.activeElement === first || document.activeElement === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}


export default function IntakePlanDialog({
  onClose,
  onOpenQuestion = null,
  onQuestionsChanged = null,
  onOpenPaceSettings = null,
  onPlanChanged = null
}) {
  const changedRef = useRef(false);
  const dialogRef = useRef(null);
  const [view, setView] = useState({ kind: "plan" });
  const [announcement, setAnnouncement] = useState("");
  const plan = useIntakePlan({
    onChanged: (next) => {
      changedRef.current = true;
      onPlanChanged?.(next);
    }
  });
  const { snapshot } = plan;

  const close = useCallback(() => {
    onClose?.({ changed: changedRef.current });
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement;

    dialogRef.current?.focus();

    return () => {
      if (opener && typeof opener.focus === "function" && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

  function escape() {
    if (view.kind === "deck") {
      setView({ kind: "plan", returnKey: view.key });
    } else {
      close();
    }
  }

  const escapeRef = useRef(escape);

  useEffect(() => {
    escapeRef.current = escape;
  });

  // Safety net for keys pressed while focus sits outside the dialog (a
  // removed element leaves it on <body>). App's own Escape handler already
  // stands down while a dialog is open, so nothing else would react.
  useEffect(() => {
    function handleOutsideKey(event) {
      if (dialogRef.current?.contains(event.target)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        escapeRef.current();
      } else if (event.key === "Tab") {
        event.preventDefault();
        dialogRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleOutsideKey);

    return () => document.removeEventListener("keydown", handleOutsideKey);
  }, []);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      escape();
      return;
    }

    if (event.key === "Tab") trapFocus(event, dialogRef.current);
  }

  function openQuestion(id) {
    close();
    onOpenQuestion?.(id);
  }

  function renderBody() {
    if (!snapshot && plan.loading) {
      return (
        <div className="intake-skeleton" aria-hidden="true">
          <span /><span /><span /><span />
        </div>
      );
    }

    if (!snapshot) {
      return (
        <div className="intake-alert" role="alert">
          {plan.loadError || "File des nouvelles indisponible."}
          <button type="button" className="intake-link" onClick={plan.reload}>
            Recharger
          </button>
        </div>
      );
    }

    if (view.kind === "deck") {
      return (
        <IntakeDeckDetail
          key={view.key}
          deckKey={view.key}
          snapshot={snapshot}
          saving={plan.saving}
          apply={plan.apply}
          announce={setAnnouncement}
          onBack={() => setView({ kind: "plan", returnKey: view.key })}
          onOpenQuestion={onOpenQuestion ? openQuestion : null}
          onQuestionsChanged={onQuestionsChanged}
        />
      );
    }

    return (
      <IntakePlanOverview
        snapshot={snapshot}
        saving={plan.saving}
        initialFocusKey={view.returnKey || null}
        apply={plan.apply}
        announce={setAnnouncement}
        onOpenDeck={key => setView({ kind: "deck", key })}
        onOpenPaceSettings={
          onOpenPaceSettings
            ? () => {
              close();
              onOpenPaceSettings();
            }
            : null
        }
      />
    );
  }

  return (
    <div
      className="intake-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="intake-dialog-title"
        aria-describedby="intake-dialog-summary"
        tabIndex={-1}
        className="intake-dialog"
        onKeyDown={handleKeyDown}
      >
        <header className="intake-dialog-header">
          <div className="intake-dialog-heading">
            <h2 id="intake-dialog-title">File des nouvelles</h2>
            <p id="intake-dialog-summary" className="intake-muted">
              {snapshot ? planSummary(snapshot) : "Chargement…"}
            </p>
          </div>
          <button
            type="button"
            className="intake-close"
            aria-label="Fermer"
            onClick={close}
          >
            ×
          </button>
        </header>

        {plan.actionError && (
          <div className="intake-alert intake-alert-banner" role="alert">
            <span>{plan.actionError}</span>
            <button type="button" className="intake-link" onClick={plan.dismissError}>
              OK
            </button>
          </div>
        )}

        <div className="intake-dialog-body intake-scroll app-scrollbar">
          {renderBody()}
        </div>

        <div className="intake-sr-only" aria-live="polite">{announcement}</div>
      </div>
    </div>
  );
}
