import { useEffect, useRef, useState } from "react";
import "./FavoriteToggleButton.css";
import "./ManageCardActions.css";

export default function FavoriteToggleButton({
  favorite,
  onToggle
}) {
  const [pulsing, setPulsing] = useState(false);
  const pulseTimeoutRef = useRef(null);
  const label = favorite ? "Retirer des favoris" : "Ajouter aux favoris";

  useEffect(() => () => {
    if (pulseTimeoutRef.current) {
      window.clearTimeout(pulseTimeoutRef.current);
    }
  }, []);

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={Boolean(favorite)}
      className={
        `favorite-toggle${favorite ? " favorite-toggle-on" : ""}` +
        `${pulsing ? " favorite-toggle-pulse" : ""}`
      }
      onClick={(event) => {
        event.stopPropagation();

        // Restart cleanly if the button is clicked twice in quick succession.
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
      <span className="favorite-toggle-icon" aria-hidden="true">
        {favorite ? "★" : "☆"}
      </span>
    </button>
  );
}
