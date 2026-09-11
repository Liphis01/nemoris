import { useLayoutEffect, useRef } from "react";

import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";
import { useFlip } from "../../../shared/useFlip";
import { activeDeckKeys, deckMeta, sectionDecks } from "../intakePlanModel";
import { useReorderDrag } from "../useReorderDrag";
import IntakeRowMenu from "./IntakeRowMenu";

const SECTIONS = [
  {
    key: "focus",
    title: "En cours",
    hint: "Ces paquets se partagent les nouvelles du jour."
  },
  {
    key: "next",
    title: "Ensuite",
    hint: "Ils prendront le relais dans cet ordre."
  },
  {
    key: "paused",
    title: "En pause",
    hint: "Aucune nouvelle question. Leurs révisions continuent."
  }
];

const LOOSE_CHIP = { label: "ISOLÉES", background: "#262626", color: "#b5b5b5" };


function deckChip(deck) {
  return deck.type_group ? getQuestionTypeChipStyle(deck.type_group) : LOOSE_CHIP;
}


export default function IntakeDeckList({
  decks,
  saving,
  initialFocusKey = null,
  onMove,
  onTogglePause,
  onStudyNext,
  onShuffle,
  onOpenDeck
}) {
  const listRef = useRef(null);
  const lastFocusedKeyRef = useRef(initialFocusKey);
  const activeKeys = activeDeckKeys(decks);
  const sections = sectionDecks(decks);
  const drag = useReorderDrag({
    keys: activeKeys,
    enabled: !saving,
    onMove
  });

  useFlip(listRef, decks.map(deck => `${deck.key}:${deck.section}`).join("|"));

  // A deck that changes section is re-mounted in another list, which drops
  // focus on <body>. Put it back on the same deck so keyboard users keep
  // their place.
  useLayoutEffect(() => {
    const key = lastFocusedKeyRef.current;
    const active = document.activeElement;

    if (!key || (active && active !== document.body)) return;

    Array.from(listRef.current?.querySelectorAll("[data-flip-key]") || [])
      .find(node => node.getAttribute("data-flip-key") === key)
      ?.querySelector(".intake-deck-main")
      ?.focus();
  });

  function handleRowKeyDown(event, deck) {
    if (!event.altKey || deck.paused || saving) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

    event.preventDefault();

    const index = activeKeys.indexOf(deck.key);
    const target = event.key === "ArrowUp" ? index - 1 : index + 1;

    if (target >= 0 && target < activeKeys.length) onMove(deck.key, target);
  }

  function renderRow(deck) {
    const index = activeKeys.indexOf(deck.key);
    const isFirst = index === 0;
    const isLast = index === activeKeys.length - 1;
    const chip = deckChip(deck);

    return (
      <li
        key={deck.key}
        data-flip-key={deck.key}
        className={
          `intake-deck intake-deck-${deck.section}` +
          `${drag.draggedKey === deck.key ? " intake-dragging" : ""}` +
          drag.dropClass(deck.key)
        }
        onKeyDown={event => handleRowKeyDown(event, deck)}
        onFocus={() => { lastFocusedKeyRef.current = deck.key; }}
        {...drag.rowProps(deck.key, { draggable: !deck.paused })}
      >
        <span
          className={`intake-handle${deck.paused ? " intake-handle-off" : ""}`}
          aria-hidden="true"
          title={deck.paused ? undefined : "Glisser pour réordonner (ou Alt + ↑/↓)"}
        >
          ⋮⋮
        </span>
        <span className="intake-deck-position">{deck.position ?? "–"}</span>
        <button
          type="button"
          className="intake-deck-main"
          aria-keyshortcuts={deck.paused ? undefined : "Alt+ArrowUp Alt+ArrowDown"}
          aria-label={`${deck.name}, ${deckMeta(deck)}. Voir les questions`}
          onClick={() => onOpenDeck(deck.key)}
        >
          <span className="intake-deck-name">{deck.name}</span>
          <span className="intake-deck-meta">{deckMeta(deck)}</span>
        </button>
        <span
          className="intake-chip"
          style={{ background: chip.background, color: chip.color }}
        >
          {chip.label}
        </span>
        <button
          type="button"
          className={`intake-pause${deck.paused ? " intake-pause-on" : ""}`}
          aria-pressed={deck.paused}
          aria-label={
            deck.paused
              ? `Reprendre les nouvelles de ${deck.name}`
              : `Mettre en pause les nouvelles de ${deck.name}`
          }
          disabled={saving}
          onClick={() => onTogglePause(deck)}
        >
          <span aria-hidden="true">{deck.paused ? "▶" : "❚❚"}</span>
          {deck.paused ? "Reprendre" : "Pause"}
        </button>
        <IntakeRowMenu
          label={`Actions pour ${deck.name}`}
          disabled={saving}
          items={[
            {
              label: "Étudier ensuite",
              disabled: isFirst && !deck.paused,
              onSelect: () => onStudyNext(deck)
            },
            {
              label: "Monter",
              disabled: deck.paused || isFirst,
              onSelect: () => onMove(deck.key, index - 1)
            },
            {
              label: "Descendre",
              disabled: deck.paused || isLast,
              onSelect: () => onMove(deck.key, index + 1)
            },
            {
              label: "À la fin",
              disabled: deck.paused || isLast,
              onSelect: () => onMove(deck.key, activeKeys.length - 1)
            },
            {
              label: "Mélanger les questions",
              disabled: (deck.counts?.unseen ?? 0) < 2,
              onSelect: () => onShuffle(deck)
            },
            {
              label: "Voir les questions",
              onSelect: () => onOpenDeck(deck.key)
            }
          ]}
        />
      </li>
    );
  }

  return (
    <div className="intake-deck-sections" ref={listRef}>
      {SECTIONS.map(section => {
        const rows = sections[section.key];

        if (!rows.length) return null;

        return (
          <section key={section.key} className="intake-deck-section" aria-label={section.title}>
            <div className="intake-section-head">
              <h3>{section.title}</h3>
              <span className="intake-muted">{section.hint}</span>
            </div>
            <ul className="intake-deck-list">
              {rows.map(renderRow)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
