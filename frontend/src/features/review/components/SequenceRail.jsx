import { Fragment } from "react";

import { isAnswerable, slotBaseStyle } from "../sequenceRail";

// The shared context surface for ordered lists. Same grammar as a map review:
// the surroundings stay on screen and only the probed item is withheld.
//
// One thing a map does NOT have to worry about: on a map the context is the
// CUE and the answer appears nowhere, but in a list the context IS the answer,
// so a nearly-complete rail is answerable by subtraction. Decoys (known slots
// blanked on purpose) are what stop that, and they only work if they are
// indistinguishable from real blanks while answering -- hence `kind` is
// reported as "blank" in the DOM until the recap.
export default function SequenceRail({
  slots,
  revealed,
  renderSlot,
  onSlotClick,
  onSlotDrop,
  slotBorder
}) {
  return (
    <div
      className="app-scrollbar"
      data-sequence-rail=""
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        minHeight: 0,
        overflowY: "auto"
      }}
    >
      {slots.map((slot, index) => {
        const previous = slots[index - 1];
        // A windowed rail is a set of runs, not one span. The break has to be
        // visible or the learner reads two distant parts of the list as
        // adjacent and the ordering they infer is wrong.
        const isRunBreak = previous && slot.position !== previous.position + 1;
        const answerable = isAnswerable(slot);

        return (
          <Fragment key={slot.position}>
            {isRunBreak && (
              <div
                data-sequence-rail-gap=""
                style={{
                  color: "#555",
                  fontSize: "12px",
                  padding: "2px 11px",
                  textAlign: "center"
                }}
              >
                ⋯
              </div>
            )}

            <div
              data-sequence-slot={
                revealed ? slot.kind : answerable ? "blank" : slot.kind
              }
              data-sequence-slot-position={slot.position}
              onClick={onSlotClick ? () => onSlotClick(slot) : undefined}
              onDragOver={event => {
                if (answerable && !revealed && onSlotDrop) event.preventDefault();
              }}
              onDrop={event => {
                if (!answerable || revealed || !onSlotDrop) return;

                event.preventDefault();
                onSlotDrop(slot, Number(event.dataTransfer.getData("text/plain")));
              }}
              style={{
                ...slotBaseStyle,
                background: answerable ? "#151515" : "#101010",
                border: slotBorder
                  ? slotBorder(slot)
                  : `1px solid ${answerable ? "#3a3a3a" : "#1e1e1e"}`,
                opacity: slot.kind === "hidden" ? 0.45 : 1
              }}
            >
              <span
                style={{ color: "#666", fontSize: "12px", minWidth: "28px" }}
              >
                {slot.position}
              </span>

              {renderSlot(slot)}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
