import { useCallback, useEffect, useMemo, useState } from "react";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import { getTrainingItems } from "../../../api/training";
import { saveLearnConfusions } from "../../../api/learn";
import { LEARN_STATES, learnItemsFromTraining } from "../learnSession";
import LearnDrill from "./learn/LearnDrill";
import LearnMap from "./learn/LearnMap";
import LearnMedia from "./learn/LearnMedia";
import LearnSequence from "./learn/LearnSequence";
import LearnText from "./learn/LearnText";
import "./StudyScreen.css";


const SCREENS = {
  map: LearnMap,
  media: LearnMedia,
  sequence: LearnSequence,
  text: LearnText
};


function EmptyStudy({ setMode }) {
  return (
    <div className="learn-screen">
      <div className="learn-shell learn-empty-shell">
        <h1>Rien à apprendre</h1>
        <p>Choisis un groupe depuis le menu pour l'apprendre par cœur.</p>
        <button type="button" className="learn-primary" onClick={() => setMode("menu")}>
          Retour au menu
        </button>
      </div>
    </div>
  );
}


export default function StudyScreen({ scope, setMode }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [revealed, setRevealed] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const [focusId, setFocusId] = useState(null);
  const [drilling, setDrilling] = useState(false);
  const groupId = scope?.id ?? scope?.groupId ?? null;

  useEffect(() => {
    if (groupId == null) {
      setPayload(null);
      return undefined;
    }

    let cancelled = false;

    setLoading(true);
    setError("");
    setRevealed(new Set());
    setSelected(new Set());
    setDrilling(false);

    getTrainingItems({ scopeType: "group", groupId })
      .then((data) => {
        if (cancelled) return;

        setPayload(data);
        setLoading(false);
      })
      .catch((loadError) => {
        console.error(loadError);

        if (cancelled) return;

        setError(loadError.message || "Impossible de charger ce groupe.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [groupId, reloadNonce]);

  const { group, family, items } = useMemo(
    () => learnItemsFromTraining(payload),
    [payload]
  );

  const toggleReveal = useCallback((questionId) => {
    setRevealed((current) => {
      const next = new Set(current);

      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);

      return next;
    });
  }, []);

  const toggleSelect = useCallback((questionId) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);

      return next;
    });
  }, []);

  const drillItems = useMemo(
    () => items.filter(item => selected.has(item.questionId)),
    [items, selected]
  );

  const handleFinish = useCallback((confusions) => {
    // Fired once, when the drill empties: the pairs go out in a single write
    // rather than a request per answer.
    saveLearnConfusions(confusions).catch(saveError => console.error(saveError));
  }, []);

  if (!scope) return <EmptyStudy setMode={setMode} />;

  const Screen = SCREENS[family] || LearnText;
  const unseenCount = items.filter(item => item.state === LEARN_STATES.UNSEEN).length;

  return (
    <div className="learn-screen">
      <div className="learn-shell">
        <header className="learn-header">
          <div>
            <div className="learn-overline">Apprendre</div>
            <h1>{group?.name || scope?.name || "Groupe"}</h1>
            <p>
              {items.length} item{items.length > 1 ? "s" : ""}
              {unseenCount > 0 ? ` · ${unseenCount} jamais vu${unseenCount > 1 ? "s" : ""}` : ""}
            </p>
          </div>

          <ReturnToMenuButton onClick={() => setMode("menu")} className="learn-back" />
        </header>

        {loading && <div className="learn-state">Chargement du groupe...</div>}

        {!loading && error && (
          <div className="learn-state learn-state-error" role="alert">
            <strong>{error}</strong>
            <button type="button" onClick={() => setReloadNonce(value => value + 1)}>
              Réessayer
            </button>
          </div>
        )}

        {!loading && !error && drilling && drillItems.length > 0 && (
          <LearnDrill
            family={family}
            group={group}
            items={drillItems}
            pool={items}
            onExit={() => setDrilling(false)}
            onFinish={handleFinish}
          />
        )}

        {!loading && !error && !drilling && (
          <>
            <div className="learn-toolbar">
              <button
                type="button"
                className="learn-ghost"
                onClick={() => setRevealed(
                  revealed.size === items.length
                    ? new Set()
                    : new Set(items.map(item => item.questionId))
                )}
              >
                {revealed.size === items.length ? "Tout masquer" : "Tout révéler"}
              </button>

              <button
                type="button"
                className="learn-ghost"
                onClick={() => setSelected(new Set(items.map(item => item.questionId)))}
              >
                Tout sélectionner
              </button>

              <button
                type="button"
                className="learn-ghost"
                disabled={unseenCount === 0}
                onClick={() => setSelected(new Set(
                  items
                    .filter(item => item.state === LEARN_STATES.UNSEEN)
                    .map(item => item.questionId)
                ))}
              >
                Les non-vus
              </button>

              {selected.size > 0 && (
                <button type="button" className="learn-ghost" onClick={() => setSelected(new Set())}>
                  Vider
                </button>
              )}
            </div>

            <main className="learn-body app-scrollbar">
              <Screen
                group={group}
                items={items}
                revealed={revealed}
                selected={selected}
                focusId={focusId}
                onToggle={toggleReveal}
                onSelect={toggleSelect}
                onFocus={setFocusId}
              />
            </main>

            <footer className="learn-footer">
              <span>
                {selected.size === 0
                  ? "Sélectionne ce que tu veux apprendre"
                  : `${selected.size} sélectionné${selected.size > 1 ? "s" : ""}`}
              </span>

              <button
                type="button"
                className="learn-primary"
                disabled={selected.size === 0}
                onClick={() => setDrilling(true)}
              >
                Se tester
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
