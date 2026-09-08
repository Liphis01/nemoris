import LearnRowList from "./LearnRowList";


// The vocabulary-book case, and the fallback for every group type without a
// bespoke screen (cloze, grid, set, timeline): prompt on the left, masked
// answer on the right.
export default function LearnText({ items, revealed, selected, onToggle, onSelect }) {
  return (
    <LearnRowList
      items={items}
      revealed={revealed}
      selected={selected}
      onToggle={onToggle}
      onSelect={onSelect}
      renderLead={item => (
        <span className="learn-row-prompt">{item.prompt || item.answer}</span>
      )}
    />
  );
}
