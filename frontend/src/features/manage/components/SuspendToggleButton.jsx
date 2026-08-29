import { useEffect, useRef, useState } from "react";
import "./SuspendToggleButton.css";
import "./ManageCardActions.css";

// Media-player convention: the icon shows what the click will *do*, not the
// state it is in -- pause while the card is active, play once it is suspended.
function labelFor(scope, suspended) {
  if (scope === "group") {
    return suspended
      ? "Reprendre toutes les questions du groupe"
      : "Suspendre toutes les questions du groupe";
  }

  return suspended
    ? "Reprendre la question"
    : "Suspendre la question";
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
  const aria = labelFor(scope, suspended);

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
