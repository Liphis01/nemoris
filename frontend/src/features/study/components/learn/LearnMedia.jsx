import { getMediaKind, resolveMediaUrl } from "../../../../shared/media";


function MediaFace({ item }) {
  const url = resolveMediaUrl(item.media);
  const kind = getMediaKind(item.media);

  if (!url) return <span className="learn-tile-placeholder" aria-hidden="true">?</span>;

  if (kind === "audio") {
    return <audio className="learn-tile-audio" controls preload="none" src={url} />;
  }

  if (kind === "video") {
    return <video className="learn-tile-video" controls preload="metadata" src={url} />;
  }

  return <img className="learn-tile-image" src={url} alt="" loading="lazy" />;
}


// A media group is learned by looking, so the wall shows every card's media at
// once and hides only the name. Audio groups get a player instead of a face --
// there is nothing to look at, and the sound is the prompt.
export default function LearnMedia({ items, revealed, selected, onToggle, onSelect }) {
  return (
    <ul className="learn-tiles">
      {items.map((item, index) => {
        const isRevealed = revealed.has(item.questionId);
        const isSelected = selected.has(item.questionId);
        const itemName = isRevealed ? `« ${item.answer} »` : `l'item ${index + 1}`;
        const selectionAction = isSelected ? "Retirer" : "Ajouter";
        const selectionDirection = isSelected ? "du test" : "au test";

        return (
          <li
            key={item.questionId}
            className={[
              "learn-tile",
              isSelected ? "is-selected" : "",
              item.state === "unseen" ? "is-unseen" : ""
            ].filter(Boolean).join(" ")}
          >
            <button
              type="button"
              className="learn-tile-face"
              aria-expanded={isRevealed}
              onClick={() => onToggle(item.questionId)}
            >
              <MediaFace item={item} />

              <span className={isRevealed ? "learn-tile-name" : "learn-tile-name is-masked"}>
                {isRevealed ? item.answer : "•••"}
              </span>
            </button>

            <label className="learn-tile-pick">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onSelect(item.questionId)}
              />
              <span className="learn-row-pick-box" aria-hidden="true" />
              <span className="sr-only">
                {selectionAction} {itemName} {selectionDirection}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
