import { useEffect, useRef, useState } from "react";

// Rough height of an open menu, to decide whether it fits below its button
// inside the dialog's scroll region or has to open upward.
const MENU_ESTIMATED_HEIGHT = 230;


export default function IntakeRowMenu({ label, items, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef(null);
  const toggleRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    itemRefs.current.find(item => item && !item.disabled)?.focus();

    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function toggle() {
    if (!open) {
      const scroller = toggleRef.current?.closest(".intake-scroll");
      const bounds = scroller?.getBoundingClientRect();
      const rect = toggleRef.current?.getBoundingClientRect();

      setOpenUp(Boolean(
        bounds && rect && rect.bottom + MENU_ESTIMATED_HEIGHT > bounds.bottom &&
        rect.top - MENU_ESTIMATED_HEIGHT > bounds.top
      ));
    }

    setOpen(value => !value);
  }

  function close() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  function handleKeyDown(event) {
    if (!open) return;

    if (event.key === "Escape") {
      // Closes the menu only; the dialog must not see this Escape.
      event.stopPropagation();
      close();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    event.preventDefault();

    const enabled = itemRefs.current.filter(item => item && !item.disabled);
    const index = enabled.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;

    enabled[(index + step + enabled.length) % enabled.length]?.focus();
  }

  return (
    <div className="intake-menu" ref={rootRef} onKeyDown={handleKeyDown}>
      <button
        ref={toggleRef}
        type="button"
        className="intake-icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={toggle}
      >
        ⋯
      </button>

      {open && (
        <div
          className={`intake-menu-list${openUp ? " intake-menu-list-up" : ""}`}
          role="menu"
          aria-label={label}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={node => { itemRefs.current[index] = node; }}
              type="button"
              role="menuitem"
              className="intake-menu-item"
              disabled={item.disabled}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
