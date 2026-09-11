import { useState } from "react";

import { dropIndex } from "./intakePlanModel";


// Native drag-and-drop for a vertical list. The drop lands before or after the
// hovered row depending on which half the pointer is in, so every position --
// including the very last one -- is reachable.
export function useReorderDrag({ keys, enabled, onMove }) {
  const [draggedKey, setDraggedKey] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  function reset() {
    setDraggedKey(null);
    setDropTarget(null);
  }

  function rowProps(key, { draggable = true } = {}) {
    const canDrag = Boolean(enabled && draggable);

    return {
      draggable: canDrag,
      onDragStart: (event) => {
        if (!canDrag) return;

        setDraggedKey(key);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(key));
      },
      onDragOver: (event) => {
        if (!canDrag || draggedKey === null || draggedKey === key) return;

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";

        const rect = event.currentTarget.getBoundingClientRect();
        const placement = event.clientY < rect.top + rect.height / 2
          ? "before"
          : "after";

        setDropTarget(current => (
          current?.key === key && current.placement === placement
            ? current
            : { key, placement }
        ));
      },
      onDrop: (event) => {
        if (!canDrag || draggedKey === null) return;

        event.preventDefault();

        const moved = draggedKey;
        const placement = dropTarget?.key === key ? dropTarget.placement : "before";
        const index = dropIndex(keys, moved, key, placement);

        reset();

        if (index !== null && index !== keys.indexOf(moved)) {
          onMove(moved, index);
        }
      },
      onDragEnd: reset
    };
  }

  function dropClass(key) {
    if (dropTarget?.key !== key) return "";
    return dropTarget.placement === "after" ? " intake-drop-after" : " intake-drop-before";
  }

  return { draggedKey, dropClass, rowProps };
}
