import { useCallback, useEffect, useMemo, useState } from "react";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import { getTrainingItems } from "../../../api/training";
import { saveLearnConfusions } from "../../../api/learn";
import {
  LEARN_STATES,
  isDrillDone,
  learnItemsFromTraining,
  reviveDrillState
} from "../learnSession";
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

const DRILL_STORAGE_VERSION = 1;
const SMART_BATCH_LIMIT = 10;
const RANDOM_BATCH_LIMIT = 15;


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


function drillStorageKey(groupId) {
  return groupId == null ? null : `nemoris:learn-drill:group:${groupId}`;
}


function readStoredDrill(key, items) {
  if (!key || typeof window === "undefined") return null;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null");

    if (parsed?.version !== DRILL_STORAGE_VERSION) return null;

    return reviveDrillState(parsed.state, items);
  } catch {
    return null;
  }
}


function persistableDrillState(state) {
  return state ? { ...state, confusions: [] } : state;
}


function writeStoredDrill(key, state) {
  if (!key || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, JSON.stringify({
      version: DRILL_STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
      state: persistableDrillState(state)
    }));
  } catch {
    // Local persistence is a convenience. A full/blocked storage quota must not
    // interrupt the learning drill.
  }
}


function clearStoredDrill(key) {
  if (!key || typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures for the same reason as writes.
  }
}


function questionHistory(item) {
  return item?.source?.progress?.history || item?.progress?.history || [];
}


function progressFor(item) {
  return item?.source?.progress || item?.progress || {};
}


function numericId(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}


function fragileScore(item) {
  const progress = progressFor(item);
  const history = questionHistory(item);
  const reps = Number(progress.reps) || 0;
  let score = 0;

  if (!reps && !history.length) return 0;

  score += (Number(progress.lapses) || 0) * 4;
  score += Math.max(0, Number(progress.difficulty) || 0);

  for (const [index, entry] of history.slice(-6).entries()) {
    const recency = index + 1;
    const quality = Number(entry?.quality);

    if (quality === 0) score += 8 + recency;
    else if (quality === 1) score += 4 + recency / 2;
  }

  return score;
}


function confusionScore(item) {
  const source = item?.source || item;
  const targetId = item.questionId;
  let score = 0;

  for (const entry of source?.learn_confusions || []) {
    score += (Number(entry.mispicks) || 0) * 4;
    score += Number(entry.exposures) || 0;
  }

  for (const entry of questionHistory(item)) {
    const event = entry?.answer_event || {};
    const expectedId = numericId(event.expected_card_id);
    const pickedId = numericId(event.resolved_response_id ?? event.raw_response);
    const candidateIds = Array.isArray(event.candidate_ids)
      ? event.candidate_ids.map(numericId).filter(id => id !== null)
      : [];

    if (
      expectedId === targetId
      && pickedId !== null
      && pickedId !== targetId
      && candidateIds.includes(pickedId)
    ) {
      score += 6;
    }
  }

  return score;
}


function firstByScore(items, scorer, limit) {
  return [...items]
    .map((item, index) => ({ item, index, score: scorer(item) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => (
      (right.score - left.score)
      || (left.index - right.index)
      || (left.item.questionId - right.item.questionId)
    ))
    .slice(0, limit)
    .map(entry => entry.item);
}


function randomBatch(items, limit) {
  return [...items]
    .map(item => ({ item, sort: Math.random() }))
    .sort((left, right) => left.sort - right.sort)
    .slice(0, limit)
    .map(entry => entry.item);
}


function itemIds(items) {
  return items.map(item => item.questionId);
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
  const [drillInitialState, setDrillInitialState] = useState(null);
  const [resumeState, setResumeState] = useState(null);
  const groupId = scope?.id ?? scope?.groupId ?? null;
  const storageKey = drillStorageKey(groupId);

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
    setFocusId(null);
    setDrilling(false);
    setDrillInitialState(null);
    setResumeState(null);

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

  useEffect(() => {
    if (loading || error || !items.length) {
      setResumeState(null);
      return;
    }

    setResumeState(readStoredDrill(storageKey, items));
  }, [error, items, loading, storageKey]);

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

  const unseenItems = useMemo(
    () => items.filter(item => item.state === LEARN_STATES.UNSEEN).slice(0, SMART_BATCH_LIMIT),
    [items]
  );
  const fragileItems = useMemo(
    () => firstByScore(items, fragileScore, SMART_BATCH_LIMIT),
    [items]
  );
  const confusedItems = useMemo(
    () => firstByScore(items, confusionScore, SMART_BATCH_LIMIT),
    [items]
  );

  const selectItems = useCallback((nextItems) => {
    setSelected(new Set(itemIds(nextItems)));
  }, []);

  const startDrill = useCallback(() => {
    setDrillInitialState(null);
    setDrilling(true);
  }, []);

  const resumeDrill = useCallback(() => {
    if (!resumeState) return;

    setSelected(new Set(resumeState.itemIds));
    setDrillInitialState(resumeState);
    setDrilling(true);
  }, [resumeState]);

  const closeDrill = useCallback(() => {
    setDrilling(false);
    setDrillInitialState(null);
  }, []);

  const handleDrillStateChange = useCallback((state) => {
    if (!state || isDrillDone(state)) return;

    setResumeState(reviveDrillState(persistableDrillState(state), items));
    writeStoredDrill(storageKey, state);
  }, [items, storageKey]);

  const handleDrillComplete = useCallback(() => {
    clearStoredDrill(storageKey);
    setResumeState(null);
  }, [storageKey]);

  const handleFinish = useCallback((confusions) => {
    // The pairs go out in one write when the drill surface closes, rather than
    // a request per answer.
    saveLearnConfusions(confusions).catch(saveError => console.error(saveError));
  }, []);

  if (!scope) return <EmptyStudy setMode={setMode} />;

  const Screen = SCREENS[family] || LearnText;
  const unseenCount = items.filter(item => item.state === LEARN_STATES.UNSEEN).length;
  const groupCountLabel = loading
    ? "Chargement..."
    : `${items.length} item${items.length > 1 ? "s" : ""}${
      unseenCount > 0 ? ` · ${unseenCount} jamais vu${unseenCount > 1 ? "s" : ""}` : ""
    }`;

  return (
    <div className="learn-screen">
      <div className="learn-shell">
        <header className="learn-header">
          <div>
            <div className="learn-overline">Apprendre</div>
            <h1>{group?.name || scope?.name || "Groupe"}</h1>
            <p>{groupCountLabel}</p>
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
            initialState={drillInitialState}
            onExit={closeDrill}
            onFinish={handleFinish}
            onStateChange={handleDrillStateChange}
            onComplete={handleDrillComplete}
          />
        )}

        {!loading && !error && !drilling && items.length === 0 && (
          <div className="learn-state">
            Aucun item disponible dans ce groupe.
          </div>
        )}

        {!loading && !error && !drilling && items.length > 0 && (
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
                disabled={unseenItems.length === 0}
                onClick={() => selectItems(unseenItems)}
              >
                10 non-vus
              </button>

              <button
                type="button"
                className="learn-ghost"
                disabled={fragileItems.length === 0}
                onClick={() => selectItems(fragileItems)}
              >
                10 fragiles
              </button>

              <button
                type="button"
                className="learn-ghost"
                disabled={confusedItems.length === 0}
                onClick={() => selectItems(confusedItems)}
              >
                10 confusions
              </button>

              <button
                type="button"
                className="learn-ghost"
                disabled={items.length === 0}
                onClick={() => selectItems(randomBatch(items, RANDOM_BATCH_LIMIT))}
              >
                15 au hasard
              </button>

              <button
                type="button"
                className="learn-ghost"
                disabled={!resumeState}
                onClick={resumeDrill}
              >
                Reprendre
              </button>

              <button
                type="button"
                className="learn-ghost learn-toolbar-secondary"
                onClick={() => setSelected(new Set(items.map(item => item.questionId)))}
              >
                Tout sélectionner
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
                onClick={startDrill}
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
