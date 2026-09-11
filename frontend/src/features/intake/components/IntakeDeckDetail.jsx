import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { getIntakePlanDeck } from "../../../api/review";
import { useFlip } from "../../../shared/useFlip";
import { deckMeta, moveItem } from "../intakePlanModel";
import { useReorderDrag } from "../useReorderDrag";
import SuspendToggleButton from "./SuspendToggleButton";


function matchesQuery(question, query) {
  const needle = query.trim().toLocaleLowerCase("fr");

  if (!needle) return true;

  return `${question.primary} ${question.secondary}`
    .toLocaleLowerCase("fr")
    .includes(needle);
}


export default function IntakeDeckDetail({
  deckKey,
  snapshot,
  saving,
  apply,
  announce,
  onBack,
  onOpenQuestion,
  onQuestionsChanged
}) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const summaryDeck = snapshot?.decks.find(deck => deck.key === deckKey);
  const deck = summaryDeck || detail?.deck;
  const questions = detail?.questions || [];
  const suspended = detail?.suspended || [];
  const filtering = Boolean(query.trim());
  const visible = filtering
    ? questions.filter(question => matchesQuery(question, query))
    : questions;
  const ids = questions.map(question => question.id);
  const todayCount = snapshot?.today?.count ?? 0;
  const isFirstDeck = summaryDeck?.position === 1;

  const load = useCallback(async () => {
    setLoadError("");

    try {
      setDetail(await getIntakePlanDeck(deckKey));
    } catch (caught) {
      setLoadError(caught?.message || "Paquet indisponible.");
    } finally {
      setLoading(false);
    }
  }, [deckKey]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useFlip(listRef, ids.join(","));

  // Opening the deck removes the button that opened it, and suspending a
  // question removes its row: either way focus lands on <body>. The search box
  // is the natural place to resume from.
  useLayoutEffect(() => {
    const active = document.activeElement;

    if (!active || active === document.body) searchRef.current?.focus();
  });

  async function reorder(nextIds, message) {
    const byId = new Map(questions.map(question => [question.id, question]));

    setDetail(current => ({
      ...current,
      questions: nextIds.map(id => byId.get(id))
    }));

    const next = await apply([
      { type: "reorder_questions", key: deckKey, question_ids: nextIds }
    ]);

    // Fresh feed positions on success; on failure, the server's order back
    // (the hook keeps the error visible).
    await load();

    if (next && message) announce(message);
  }

  function moveQuestion(id, toIndex) {
    const fromIndex = ids.indexOf(id);

    if (fromIndex < 0 || fromIndex === toIndex) return;

    const question = questions[fromIndex];

    reorder(
      moveItem(ids, fromIndex, toIndex),
      `${question.primary} : position ${toIndex + 1}.`
    );
  }

  const drag = useReorderDrag({
    keys: ids,
    enabled: !saving && !filtering,
    onMove: moveQuestion
  });

  async function setSuspended(question, value) {
    const next = await apply([
      { type: "set_suspended", question_ids: [question.id], suspended: value }
    ]);

    if (!next) return;

    onQuestionsChanged?.([{ id: question.id, suspended: value }]);
    await load();
    announce(value ? `${question.primary} suspendue.` : `${question.primary} reprise.`);
  }

  async function deckAction(action, message) {
    const next = await apply([action]);

    if (!next) return;

    if (action.type === "shuffle") await load();
    announce(message);
  }

  function handleRowKeyDown(event, id) {
    if (!event.altKey || filtering || saving) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

    event.preventDefault();

    const index = ids.indexOf(id);
    const target = event.key === "ArrowUp" ? index - 1 : index + 1;

    if (target >= 0 && target < ids.length) moveQuestion(id, target);
  }

  return (
    <div className="intake-detail">
      <div className="intake-detail-head">
        <button type="button" className="intake-back" onClick={onBack}>
          ← Paquets
        </button>
        <div className="intake-detail-title">
          <h3>{deck?.name || "Paquet"}</h3>
          {summaryDeck && <p className="intake-muted">{deckMeta(summaryDeck)}</p>}
        </div>
        {deck && (
          <div className="intake-detail-actions">
            {(!isFirstDeck || deck.paused) && (
              <button
                type="button"
                className="intake-button"
                disabled={saving}
                onClick={() => deckAction(
                  { type: "study_next", keys: [deckKey] },
                  `${deck.name} passe en premier.`
                )}
              >
                Étudier ensuite
              </button>
            )}
            <button
              type="button"
              className={`intake-pause${deck.paused ? " intake-pause-on" : ""}`}
              aria-pressed={Boolean(deck.paused)}
              disabled={saving}
              onClick={() => deckAction(
                { type: "set_paused", keys: [deckKey], paused: !deck.paused },
                deck.paused ? `${deck.name} reprend.` : `${deck.name} est en pause.`
              )}
            >
              <span aria-hidden="true">{deck.paused ? "▶" : "❚❚"}</span>
              {deck.paused ? "Reprendre" : "Pause"}
            </button>
            <button
              type="button"
              className="intake-button"
              disabled={saving || questions.length < 2}
              onClick={() => deckAction(
                { type: "shuffle", key: deckKey },
                `Questions de ${deck.name} mélangées.`
              )}
            >
              Mélanger
            </button>
          </div>
        )}
      </div>

      <div className="intake-search-row">
        <input
          ref={searchRef}
          type="search"
          className="intake-search"
          placeholder="Chercher dans ce paquet…"
          aria-label="Chercher dans ce paquet"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            // First Escape clears the search; the next one reaches the dialog.
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        {filtering && (
          <span className="intake-muted">
            Efface la recherche pour glisser-déposer.
          </span>
        )}
      </div>

      {loading && !detail && (
        <div className="intake-skeleton" aria-hidden="true">
          <span /><span /><span />
        </div>
      )}

      {loadError && (
        <div className="intake-alert" role="alert">
          {loadError}
          <button type="button" className="intake-link" onClick={load}>Recharger</button>
        </div>
      )}

      {detail && (
        <>
          {visible.length ? (
            <ol className="intake-question-list" ref={listRef}>
              {visible.map(question => {
                const index = ids.indexOf(question.id);
                const arrivesToday = question.feed_position !== null &&
                  question.feed_position < todayCount;

                return (
                  <li
                    key={question.id}
                    data-flip-key={question.id}
                    className={
                      "intake-question" +
                      `${drag.draggedKey === question.id ? " intake-dragging" : ""}` +
                      drag.dropClass(question.id)
                    }
                    onKeyDown={event => handleRowKeyDown(event, question.id)}
                    {...drag.rowProps(question.id, { draggable: !filtering })}
                  >
                    <span
                      className={`intake-handle${filtering ? " intake-handle-off" : ""}`}
                      aria-hidden="true"
                    >
                      ⋮⋮
                    </span>
                    <span className="intake-deck-position">{index + 1}</span>
                    <span
                      className="intake-question-text"
                      tabIndex={0}
                      aria-keyshortcuts={filtering ? undefined : "Alt+ArrowUp Alt+ArrowDown"}
                    >
                      <span className="intake-question-primary">{question.primary}</span>
                      {question.secondary && (
                        <span className="intake-question-secondary">{question.secondary}</span>
                      )}
                    </span>
                    {arrivesToday && <span className="intake-badge">aujourd'hui</span>}
                    <button
                      type="button"
                      className="intake-icon-button"
                      aria-label={`Mettre en premier : ${question.primary}`}
                      title="En premier dans le paquet"
                      disabled={saving || index === 0}
                      onClick={() => moveQuestion(question.id, 0)}
                    >
                      ⤒
                    </button>
                    <button
                      type="button"
                      className="intake-icon-button"
                      aria-label={`Mettre en dernier : ${question.primary}`}
                      title="En dernier dans le paquet"
                      disabled={saving || index === ids.length - 1}
                      onClick={() => moveQuestion(question.id, ids.length - 1)}
                    >
                      ⤓
                    </button>
                    {onOpenQuestion && (
                      <button
                        type="button"
                        className="intake-icon-button"
                        aria-label={`Ouvrir dans le gestionnaire : ${question.primary}`}
                        title="Ouvrir dans le gestionnaire"
                        onClick={() => onOpenQuestion(question.id)}
                      >
                        ↗
                      </button>
                    )}
                    <SuspendToggleButton
                      suspended={false}
                      disabled={saving}
                      onToggle={() => setSuspended(question, true)}
                    />
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="intake-empty">
              {filtering
                ? "Aucune question ne correspond à cette recherche."
                : "Plus aucune nouvelle question active dans ce paquet."}
            </p>
          )}

          {suspended.length > 0 && (
            <section className="intake-suspended" aria-label="Questions suspendues">
              <div className="intake-section-head">
                <h3>Suspendues · {suspended.length}</h3>
                <span className="intake-muted">Exclues des révisions jusqu'à reprise.</span>
              </div>
              <ul className="intake-question-list">
                {suspended.map(question => (
                  <li key={question.id} className="intake-question intake-question-suspended">
                    <span className="intake-question-text">
                      <span className="intake-question-primary">{question.primary}</span>
                      {question.secondary && (
                        <span className="intake-question-secondary">{question.secondary}</span>
                      )}
                    </span>
                    {onOpenQuestion && (
                      <button
                        type="button"
                        className="intake-icon-button"
                        aria-label={`Ouvrir dans le gestionnaire : ${question.primary}`}
                        onClick={() => onOpenQuestion(question.id)}
                      >
                        ↗
                      </button>
                    )}
                    <SuspendToggleButton
                      suspended
                      disabled={saving}
                      onToggle={() => setSuspended(question, false)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
