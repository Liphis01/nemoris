import { useMemo } from "react";
import SvgMap from "../../../map/components/SvgMap";
import { resolveMediaUrl } from "../../../../shared/media";


// For a map group the map *is* the page: clicking a zone names it in place.
// A synced index scrolls beside it so the learner can also work down the list
// and see where each name lands.
export default function LearnMap({
  group,
  items,
  revealed,
  selected,
  focusId,
  onToggle,
  onSelect,
  onFocus,
  onGeometryLoaded
}) {
  const mapSrc = resolveMediaUrl(group?.media);
  const byCode = useMemo(() => {
    const index = {};

    for (const item of items) {
      if (item.code) index[item.code] = item;
    }

    return index;
  }, [items]);

  const zoneLabels = useMemo(() => {
    const labels = {};

    for (const item of items) {
      if (item.code && revealed.has(item.questionId)) {
        labels[item.code] = item.answer;
      }
    }

    return labels;
  }, [items, revealed]);

  const revealedCodes = useMemo(
    () => items.filter(item => revealed.has(item.questionId) && item.code).map(item => item.code),
    [items, revealed]
  );
  const selectedCodes = useMemo(
    () => items.filter(item => selected.has(item.questionId) && item.code).map(item => item.code),
    [items, selected]
  );
  const focusItem = items.find(item => item.questionId === focusId) || null;

  if (!mapSrc) {
    return <div className="learn-empty">Carte indisponible pour ce groupe.</div>;
  }

  return (
    <div className="learn-map-layout">
      <div className="learn-map-frame">
        <SvgMap
          svgPath={mapSrc}
          mapManifest={group?.map || null}
          found={revealedCodes}
          missed={selectedCodes}
          dueItems={[]}
          selected={focusItem?.code || null}
          focusCode={focusItem?.code || null}
          focusVersion={focusId || 0}
          zoneLabels={zoneLabels}
          onSelect={(code) => {
            const item = byCode[code];

            if (item) onToggle(item.questionId);
          }}
          onGeometryLoaded={onGeometryLoaded}
        />
      </div>

      <ul className="learn-map-index app-scrollbar">
        {items.map((item) => {
          const isRevealed = revealed.has(item.questionId);
          const isSelected = selected.has(item.questionId);

          return (
            <li
              key={item.questionId}
              className={[
                "learn-row",
                isSelected ? "is-selected" : "",
                item.state === "unseen" ? "is-unseen" : ""
              ].filter(Boolean).join(" ")}
            >
              {/* The index names stay legible: masking them would leave a
                  column of dots, and half of learning a map is going the other
                  way -- from a name to where it sits. Clicking one lights that
                  zone up on the map. */}
              <button
                type="button"
                className="learn-row-main"
                aria-pressed={isRevealed}
                onClick={() => {
                  onFocus(item.questionId);
                  onToggle(item.questionId);
                }}
              >
                <span className="learn-row-answer">{item.answer}</span>
              </button>

              <label className="learn-row-pick">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onSelect(item.questionId)}
                />
                <span className="learn-row-pick-box" aria-hidden="true" />
                <span className="sr-only">Ajouter « {item.answer} » au test</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
