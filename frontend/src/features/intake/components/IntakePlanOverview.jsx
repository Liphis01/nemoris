import { useState } from "react";

import {
  FOCUS_OPTIONS,
  NEW_DECK_POLICY_OPTIONS,
  deckNoun,
  focusDescription,
  moveDeckInSnapshot,
  quotaExplanation
} from "../intakePlanModel";
import IntakeDeckList from "./IntakeDeckList";


export default function IntakePlanOverview({
  snapshot,
  saving,
  initialFocusKey = null,
  apply,
  announce,
  onOpenDeck,
  onOpenPaceSettings
}) {
  const [showWhy, setShowWhy] = useState(false);
  const decksByKey = new Map(snapshot.decks.map(deck => [deck.key, deck]));
  const today = snapshot.today || {};
  const focus = snapshot.settings?.focus ?? 2;
  const allPaused = snapshot.decks.length > 0 && snapshot.decks.every(deck => deck.paused);
  const explanation = quotaExplanation(today, snapshot.counts);

  async function move(key, toIndex) {
    const deck = decksByKey.get(key);
    const next = await apply(
      [{ type: "move", key, to_index: toIndex }],
      { optimistic: current => moveDeckInSnapshot(current, key, toIndex) }
    );

    if (next && deck) announce(`${deck.name} : position ${toIndex + 1}.`);
  }

  async function togglePause(deck) {
    const next = await apply([
      { type: "set_paused", keys: [deck.key], paused: !deck.paused }
    ]);

    if (next) {
      announce(deck.paused ? `${deck.name} reprend.` : `${deck.name} est en pause.`);
    }
  }

  async function studyNext(deck) {
    const next = await apply([{ type: "study_next", keys: [deck.key] }]);

    if (next) announce(`${deck.name} passe en premier.`);
  }

  async function shuffle(deck) {
    const next = await apply([{ type: "shuffle", key: deck.key }]);

    if (next) announce(`Questions de ${deck.name} mélangées.`);
  }

  return (
    <div className="intake-overview">
      <section className="intake-today" aria-labelledby="intake-today-title">
        <div className="intake-section-head">
          <h3 id="intake-today-title">Aujourd'hui</h3>
          <button
            type="button"
            className="intake-link"
            aria-expanded={showWhy}
            aria-controls="intake-why"
            onClick={() => setShowWhy(value => !value)}
          >
            Pourquoi {today.count ?? 0} ?
          </button>
        </div>

        {today.by_deck?.length ? (
          <ul className="intake-today-list">
            {today.by_deck.map(entry => {
              const deck = decksByKey.get(entry.key);

              return (
                <li key={entry.key}>
                  <button
                    type="button"
                    className="intake-today-deck"
                    onClick={() => onOpenDeck(entry.key)}
                  >
                    <span className="intake-today-name">{deck?.name || entry.key}</span>
                    <span className="intake-today-count">
                      {deckNoun(deck?.type_group, entry.count)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="intake-muted">Aucune nouvelle question aujourd'hui.</p>
        )}

        {showWhy && (
          <div id="intake-why" className="intake-why">
            <ul>
              {explanation.map(line => <li key={line}>{line}</li>)}
            </ul>
            {onOpenPaceSettings && (
              <button type="button" className="intake-link" onClick={onOpenPaceSettings}>
                Changer le rythme
              </button>
            )}
          </div>
        )}
      </section>

      <section className="intake-focus" aria-labelledby="intake-focus-label">
        <div className="intake-focus-row">
          <h3 id="intake-focus-label">Paquets en parallèle</h3>
          <div className="intake-segmented" role="group" aria-labelledby="intake-focus-label">
            {FOCUS_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={focus === option.value}
                className={focus === option.value ? "intake-segment-on" : ""}
                disabled={saving}
                onClick={() => {
                  if (focus !== option.value) {
                    apply([{ type: "set_focus", focus: option.value }]);
                  }
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p className="intake-muted">{focusDescription(focus)}</p>
      </section>

      {allPaused && (
        <p className="intake-notice">
          Tous les paquets sont en pause : aucune nouvelle question ne sera introduite.
        </p>
      )}

      {snapshot.decks.length ? (
        <IntakeDeckList
          decks={snapshot.decks}
          saving={saving}
          initialFocusKey={initialFocusKey}
          onMove={move}
          onTogglePause={togglePause}
          onStudyNext={studyNext}
          onShuffle={shuffle}
          onOpenDeck={onOpenDeck}
        />
      ) : (
        <p className="intake-empty">
          Toutes les questions ont été lancées. Importe un pack ou crée des
          questions pour en ajouter.
        </p>
      )}

      <label className="intake-policy">
        <span>Nouveaux paquets</span>
        <select
          value={snapshot.settings?.new_decks || "end"}
          disabled={saving}
          onChange={event => apply([{ type: "set_new_decks", policy: event.target.value }])}
        >
          {NEW_DECK_POLICY_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
