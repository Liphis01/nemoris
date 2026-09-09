import { useEffect, useMemo, useRef, useState } from "react";
import { buildChoiceOptions } from "../../../review/distractorSelection";
import { getMediaKind, resolveMediaUrl } from "../../../../shared/media";
import SvgMap from "../../../map/components/SvgMap";
import {
  CHOICE_OPTION_COUNT,
  DRILL_STEPS,
  answerHint,
  canOfferLearnChoice,
  continueAfterReveal,
  createDrill,
  drillResultStats,
  drillCurrentId,
  helpedQuestionIds,
  isBlankAnswer,
  isDrillDone,
  learnChoiceDecoys,
  reviveDrillState,
  skipCurrent,
  submitChoice,
  submitTypedAnswer
} from "../../learnSession";


// The prompt wears the group's own clothes: a highlighted zone for a map, the
// media for a media card, the text prompt otherwise. Reusing the browse
// presentation keeps the test recognisably the same material.
function DrillPrompt({ family, group, item, onGeometryLoaded }) {
  if (family === "map") {
    const mapSrc = resolveMediaUrl(group?.media);

    if (!mapSrc || !item.code) {
      return <div className="learn-drill-prompt-text">{item.prompt || "?"}</div>;
    }

    return (
      <div className="learn-drill-map">
        <SvgMap
          svgPath={mapSrc}
          mapManifest={group?.map || null}
          found={[]}
          missed={[]}
          dueItems={[]}
          selected={item.code}
          focusCode={item.code}
          focusVersion={item.questionId}
          flashCodes={[item.code]}
          clickableCodes={[]}
          zoneLabels={{}}
          onGeometryLoaded={onGeometryLoaded}
        />
      </div>
    );
  }

  if (family === "media") {
    const url = resolveMediaUrl(item.media);
    const kind = getMediaKind(item.media);

    if (!url) return <div className="learn-drill-prompt-text">{item.prompt || "?"}</div>;
    if (kind === "audio") return <audio className="learn-drill-audio" autoPlay controls src={url} />;
    if (kind === "video") return <video className="learn-drill-video" controls src={url} />;

    return <img className="learn-drill-image" src={url} alt="" />;
  }

  if (family === "sequence") {
    return (
      <div className="learn-drill-prompt-text">
        <span className="learn-drill-rank">{item.position ?? "—"}</span>
        {item.prompt && item.prompt !== item.answer ? <span>{item.prompt}</span> : null}
      </div>
    );
  }

  return <div className="learn-drill-prompt-text">{item.prompt || "?"}</div>;
}


function ChoiceFace({ family, option }) {
  if (family === "media") {
    const url = resolveMediaUrl(option.media);

    if (url && getMediaKind(option.media) === "image") {
      return <img className="learn-choice-image" src={url} alt="" />;
    }
  }

  return <span>{option.label || option.answer}</span>;
}


export default function LearnDrill({
  family,
  group,
  items,
  // Every card in the group, not just the drilled ones: decoys drawn from a
  // three-card selection would make the choice trivial and would only ever
  // produce confusion pairs between cards the learner happened to pick.
  pool,
  onExit,
  onFinish,
  initialState = null,
  onStateChange,
  onComplete
}) {
  const [state, setState] = useState(() => (
    reviveDrillState(initialState, items) || createDrill(items)
  ));
  const [value, setValue] = useState("");
  const [flash, setFlash] = useState(null);
  const [geometry, setGeometry] = useState(null);
  const [decoyUsage, setDecoyUsage] = useState(() => new Map());
  const inputRef = useRef(null);
  const byId = useMemo(
    () => new Map(items.map(item => [item.questionId, item])),
    [items]
  );
  const currentId = drillCurrentId(state);
  const current = currentId != null ? byId.get(currentId) : null;
  const done = isDrillDone(state);
  const choiceContext = useMemo(() => {
    if (!current) return [];

    return learnChoiceDecoys(
      current.source,
      (pool || items)
        .filter(item => item.questionId !== current.questionId)
        .map(item => item.source)
    );
  }, [current, items, pool]);

  // The choices come from the same weighted sampler the real reviews use, so
  // the decoys are the siblings this learner is most likely to mix up -- and a
  // mistake here feeds that same signal back (see learn_confusions).
  const choices = useMemo(() => {
    if (!current || state.step !== DRILL_STEPS.CHOICE) return [];

    const target = current.source;
    const built = buildChoiceOptions(target, choiceContext, decoyUsage, null, {
      geometry: family === "map" ? geometry : null,
      sequence: family === "sequence"
    });

    return built.length === CHOICE_OPTION_COUNT ? built : [];
  }, [choiceContext, current, decoyUsage, family, geometry, state.step]);

  useEffect(() => {
    if (!done && state.step !== DRILL_STEPS.CHOICE) inputRef.current?.focus();
  }, [currentId, done, state.step]);

  // Confusions are flushed when the drill goes away, not when it is completed:
  // quitting halfway is the common case, and the evidence gathered up to that
  // point is exactly as useful. The sent counter keeps a double-invoked effect
  // (StrictMode) or a later re-entry from counting the same pairs twice.
  const confusionsRef = useRef([]);
  const sentRef = useRef(0);

  useEffect(() => {
    confusionsRef.current = state.confusions;
  }, [state.confusions]);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  useEffect(() => {
    if (done) onComplete?.();
  }, [done, onComplete]);

  useEffect(() => {
    return () => {
      const pending = confusionsRef.current.slice(sentRef.current);

      sentRef.current = confusionsRef.current.length;

      if (pending.length) onFinish(pending);
    };
  }, [onFinish]);

  function handleSubmit(event) {
    event.preventDefault();

    if (!current || isBlankAnswer(value)) return;

    const { state: next, outcome } = submitTypedAnswer(state, current, value, {
      canOfferChoice: state.step !== DRILL_STEPS.HINT
        || canOfferLearnChoice(current.source, choiceContext)
    });

    setState(next);
    setValue("");
    setFlash(outcome === "correct" ? "correct" : "wrong");
  }

  function handleChoice(option) {
    if (!current) return;

    setDecoyUsage((usage) => {
      const nextUsage = new Map(usage);

      for (const choice of choices) {
        if (choice.question_id === current.questionId) continue;

        nextUsage.set(
          choice.question_id,
          (nextUsage.get(choice.question_id) || 0) + 1
        );
      }

      return nextUsage;
    });

    const { state: next, outcome } = submitChoice(
      state,
      current,
      option.question_id,
      choices.map(choice => choice.question_id)
    );

    setState(next);
    setValue("");
    setFlash(outcome === "recognized" ? "correct" : "wrong");
  }

  function handleRevealContinue() {
    setState(continueAfterReveal(state));
    setValue("");
    setFlash(null);
  }

  if (done) {
    const stats = drillResultStats(state);
    const retryIds = helpedQuestionIds(state);
    const retryItems = items.filter(item => retryIds.includes(item.questionId));

    return (
      <div className="learn-drill learn-drill-done">
        <h2>Série terminée</h2>
        <p>{state.total} item{state.total > 1 ? "s" : ""} travaillé{state.total > 1 ? "s" : ""}.</p>

        <dl className="learn-drill-results">
          <div>
            <dt>Sans aide</dt>
            <dd>{stats.memory.count}</dd>
          </div>
          <div>
            <dt>Après indice</dt>
            <dd>{stats.hint.count}</dd>
          </div>
          <div>
            <dt>Après QCM</dt>
            <dd>{stats.choice.count}</dd>
          </div>
          <div>
            <dt>À retravailler</dt>
            <dd>{stats.review.count}</dd>
          </div>
        </dl>

        <div className="learn-drill-actions">
          {retryItems.length > 0 && (
            <button
              type="button"
              className="learn-primary"
              onClick={() => {
                setDecoyUsage(new Map());
                setState(createDrill(retryItems));
              }}
            >
              Revoir les aidés
            </button>
          )}
          <button
            type="button"
            className="learn-primary"
            onClick={() => {
              setDecoyUsage(new Map());
              setState(createDrill(items));
            }}
          >
            Recommencer
          </button>
          <button type="button" className="learn-ghost" onClick={onExit}>
            Retour à la liste
          </button>
        </div>
      </div>
    );
  }

  const remaining = state.queue.length;

  return (
    <div className={`learn-drill${flash ? ` is-${flash}` : ""}`} onAnimationEnd={() => setFlash(null)}>
      <div className="learn-drill-head">
        <span>{state.total - remaining + 1} / {state.total}</span>
        <button type="button" className="learn-ghost" onClick={onExit}>Quitter</button>
      </div>

      <div className="learn-drill-stage">
        <DrillPrompt
          family={family}
          group={group}
          item={current}
          onGeometryLoaded={setGeometry}
        />
      </div>

      {state.step === DRILL_STEPS.REVEAL ? (
        <div className="learn-drill-reveal">
          <span>Réponse</span>
          <strong>{current.answer}</strong>
          <button type="button" className="learn-primary" onClick={handleRevealContinue}>
            Revoir plus tard
          </button>
        </div>
      ) : state.step === DRILL_STEPS.CHOICE ? (
        <div className="learn-choices">
          {choices.map(option => (
            <button
              type="button"
              key={option.question_id}
              className="learn-choice"
              aria-label={`Choix : ${option.label || option.answer}`}
              onClick={() => handleChoice(option)}
            >
              <ChoiceFace family={family} option={option} />
            </button>
          ))}
        </div>
      ) : (
        <form className="learn-drill-form" onSubmit={handleSubmit}>
          {state.step === DRILL_STEPS.HINT && (
            <p className="learn-drill-hint" aria-live="polite">
              {answerHint(current.answer, state.hintLevel)}
            </p>
          )}

          <input
            ref={inputRef}
            className="learn-drill-input"
            type="text"
            autoComplete="off"
            placeholder="Ta réponse"
            value={value}
            onChange={event => setValue(event.target.value)}
          />

          <div className="learn-drill-actions">
            <button type="submit" className="learn-primary">Valider</button>
            <button type="button" className="learn-ghost" onClick={() => setState(skipCurrent(state))}>
              Plus tard
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
