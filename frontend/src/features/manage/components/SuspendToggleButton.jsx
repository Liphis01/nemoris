import { useEffect, useRef, useState } from "react";
import "./SuspendToggleButton.css";
import "./ManageCardActions.css";

// Media-player convention: the icon shows what the click will *do*, not the
// state it is in -- pause while the card is active, play once it is suspended.
function titleFor(scope, suspended, mixed) {
  if (scope === "group") {
    return suspended
      ? {
        title: "Groupe en pause : aucune de ses questions n'est révisée. Cliquer pour tout reprendre.",
        aria: "Reprendre toutes les questions du groupe"
      }
      : {
        title: mixed
          ? "Une partie du groupe est en pause. Cliquer pour suspendre tout le groupe."
          : "Suspendre tout le groupe : ses questions ne seront plus proposées en révision.",
        aria: "Suspendre toutes les questions du groupe"
      };
  }

  return suspended
    ? {
      title: "En pause : cette question n'est plus révisée. Cliquer pour la reprendre.",
      aria: "Reprendre la question"
    }
    : {
      title: "Suspendre : cette question ne sera plus proposée en révision.",
      aria: "Suspendre la question"
    };
}

export default function SuspendToggleButton({
  suspended,
  mixed = false,
  scope = "question",
  disabled = false,
  onToggle
}) {
  const [pulsing, setPulsing] = useState(false);
  const pulseTimeoutRef = useRef(null);
  const { title, aria } = titleFor(scope, suspended, mixed);

  useEffect(() => () => {
    if (pulseTimeoutRef.current) {
      window.clearTimeout(pulseTimeoutRef.current);
    }
  }, []);

  const stateClass = suspended
    ? " suspend-toggle-on"
    : mixed
      ? " suspend-toggle-mixed"
      : "";

  return (
    <button
      type="button"
      aria-label={aria}
      aria-pressed={Boolean(suspended)}
      title={title}
      disabled={disabled}
      className={
        `suspend-toggle${stateClass}${pulsing ? " suspend-toggle-pulse" : ""}`
      }
      onClick={(event) => {
        event.stopPropagation();

        // Restart the animation cleanly if the button is clicked twice quickly.
        setPulsing(false);
        window.clearTimeout(pulseTimeoutRef.current);
        window.requestAnimationFrame(() => setPulsing(true));
        pulseTimeoutRef.current = window.setTimeout(
          () => setPulsing(false),
          450
        );

        onToggle?.();
      }}
    >
      <span className="suspend-toggle-icon" aria-hidden="true">
        {suspended ? "▶" : "❚❚"}
      </span>
    </button>
  );
}
