import LearnRowList from "./LearnRowList";


// An ordered set is learned in its order. learnItemsFromTraining already sorts
// by position, so the rank is all this screen adds.
export default function LearnSequence({ items, revealed, selected, onToggle, onSelect }) {
  return (
    <LearnRowList
      items={items}
      revealed={revealed}
      selected={selected}
      onToggle={onToggle}
      onSelect={onSelect}
      renderLead={item => (
        <span className="learn-row-rank">{item.position ?? "—"}</span>
      )}
    />
  );
}
