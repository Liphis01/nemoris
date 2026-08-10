import { useEffect, useRef, useState } from "react";

const qualities = [[1, "Difficile"], [2, "Bien"], [3, "Facile"]];

export default function EnumerationReview({
  q,
  submitAnswer,
  onComplete,
  trainingMode = false
}) {
  const [draft, setDraft] = useState("");
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    setDraft("");
    setAnswers([]);
    setResult(null);
    input.current?.focus();
  }, [q.question_id]);

  const addAnswer = () => {
    const answer = draft.trim();
    if (answer && !answers.includes(answer)) {
      setAnswers((current) => [...current, answer]);
      setDraft("");
    }
  };

  const preview = async (event) => {
    event?.preventDefault();
    const nextAnswers = draft.trim() ? [...answers, draft.trim()] : answers;
    setAnswers(nextAnswers);
    setDraft("");
    setResult(await submitAnswer({
      questionId: q.question_id,
      answers: nextAnswers,
      commit: false
    }));
  };

  const commit = async (quality) => {
    if (trainingMode) {
      onComplete?.(result.correct ? [] : [q.question_id]);
      return;
    }
    const saved = await submitAnswer({
      questionId: q.question_id,
      answers,
      quality,
      commit: true
    });
    onComplete?.(saved.correct ? [] : [q.question_id]);
  };

  return (
    <section style={{ display: "grid", gap: 14, margin: "0 auto", maxWidth: 700, padding: 24 }}>
      <div style={{ color: "#f3a8ef", fontSize: 12, fontWeight: 800 }}>ÉNUMÉRATION</div>
      <h2>{q.question}</h2>
      <p>Donne au moins {q.enumeration?.required_count} réponses distinctes.</p>

      <form onSubmit={preview}>
        {answers.map((answer) => (
          <button key={answer} type="button" onClick={() => setAnswers((current) => current.filter((value) => value !== answer))}>
            {answer} ×
          </button>
        ))}
        {!result && <>
          <input
            ref={input}
            aria-label="Ajouter une réponse"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addAnswer();
              }
            }}
          />
          <button type="submit">Vérifier</button>
        </>}
      </form>

      {result && <>
        <strong>{result.correct ? "Quota atteint" : "Quota non atteint"}</strong>
        {result.unmatched?.map((answer) => <div key={answer}>Non reconnu : {answer}</div>)}
        {result.correct && !trainingMode
          ? qualities.map(([value, label]) => <button key={value} onClick={() => commit(value)}>{label}</button>)
          : <button onClick={() => commit(0)}>Continuer</button>}
      </>}
    </section>
  );
}
