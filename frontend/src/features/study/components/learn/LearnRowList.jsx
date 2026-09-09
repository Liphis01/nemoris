// Shared row list behind the text and sequence screens. A row is one click to
// reveal, and its checkbox is what puts the card in the drill -- the learner
// picks their own batch instead of the app slicing the group for them.
export default function LearnRowList({
  items,
  revealed,
  selected,
  onToggle,
  onSelect,
  renderLead
}) {
  return (
    <ul className="learn-rows">
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
              "learn-row",
              isSelected ? "is-selected" : "",
              item.state === "unseen" ? "is-unseen" : ""
            ].filter(Boolean).join(" ")}
          >
            <button
              type="button"
              className="learn-row-main"
              aria-expanded={isRevealed}
              onClick={() => onToggle(item.questionId)}
            >
              {renderLead(item)}

              <span className={isRevealed ? "learn-row-answer" : "learn-row-answer is-masked"}>
                {isRevealed ? item.answer : "•".repeat(Math.min(18, Math.max(4, item.answer.length)))}
              </span>
            </button>

            <label className="learn-row-pick">
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
