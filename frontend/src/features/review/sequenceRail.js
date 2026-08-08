export const slotBaseStyle = {
  alignItems: "center",
  borderRadius: "8px",
  boxSizing: "border-box",
  display: "flex",
  gap: "10px",
  minHeight: "42px",
  padding: "8px 11px"
};

export const qualityColors = {
  0: "#ff8c94",
  1: "#f3d36a",
  2: "#7ee2a8",
  3: "#7ee2a8"
};

// Blanks and decoys are both answered. Only blanks are graded -- a decoy is a
// known slot deliberately emptied so the real blanks cannot be found by
// subtraction, which is the failure mode a list has and a map does not.
export function isAnswerable(slot) {
  return slot.kind === "blank" || slot.kind === "decoy";
}
