import { describe, expect, it } from "vitest";
import {
  DRILL_STEPS,
  LEARN_SUPPORT,
  LEARN_STATES,
  answerHint,
  canOfferLearnChoice,
  continueAfterReveal,
  createDrill,
  drillResultStats,
  drillCurrentId,
  helpedQuestionIds,
  isDrillDone,
  learnChoiceDecoys,
  learnItemsFromTraining,
  matchesLearnAnswer,
  skipCurrent,
  submitChoice,
  submitTypedAnswer
} from "./learnSession";


function card(id, question, answer, extra = {}) {
  return {
    question_id: id,
    question,
    answer,
    label: answer,
    aliases: [],
    answer_policy: { preset: "relaxed" },
    progress: { reps: 0, history: [] },
    ...extra
  };
}


function payload(typeQ, cards, group = {}) {
  return [{ group_id: 1, type_q: typeQ, name: "G", items: cards, ...group }];
}


describe("learnItemsFromTraining", () => {
  it("marks never-reviewed cards as unseen", () => {
    const { items } = learnItemsFromTraining(payload("text", [
      card(1, "prompt", "answer"),
      card(2, "prompt", "other", { progress: { reps: 3, history: [] } })
    ]));

    expect(items[0].state).toBe(LEARN_STATES.UNSEEN);
    expect(items[1].state).toBe(LEARN_STATES.SEEN);
  });

  it("gives map and media cards no text prompt", () => {
    // A map zone is asked by highlighting it; media's server-built `question`
    // is "<group> - <answer>" and would hand over the answer.
    const map = learnItemsFromTraining(payload("map", [
      card(1, null, "Mexique", { code: "MX" })
    ]));
    const media = learnItemsFromTraining(payload("media", [
      card(2, "Drapeaux - France", "France", { media: "/static/fr.svg" })
    ]));

    expect(map.items[0].prompt).toBe("");
    expect(map.items[0].code).toBe("MX");
    expect(media.items[0].prompt).toBe("");
    expect(media.items[0].answer).toBe("France");
  });

  it("drops a text prompt that just repeats the answer", () => {
    const { items } = learnItemsFromTraining(payload("sequence", [
      card(1, "la littérature", "la littérature", { position: 5 })
    ]));

    expect(items[0].prompt).toBe("");
    expect(items[0].position).toBe(5);
  });

  it("holds the order still, despite /training shuffling its items", () => {
    // The endpoint is shared with free practice, which wants a shuffle. A
    // learner re-reading the same page does not.
    const { items } = learnItemsFromTraining(payload("text", [
      card(3, "c", "Gémeaux"),
      card(1, "a", "Bélier"),
      card(2, "b", "Taureau")
    ]));

    expect(items.map(item => item.answer)).toEqual([
      "Bélier",
      "Taureau",
      "Gémeaux"
    ]);
  });

  it("puts a ranked type in rank order", () => {
    const { items } = learnItemsFromTraining(payload("sequence", [
      card(9, "c", "troisième", { position: 3 }),
      card(7, "a", "premier", { position: 1 }),
      card(8, "b", "deuxième", { position: 2 })
    ]));

    expect(items.map(item => item.position)).toEqual([1, 2, 3]);
  });

  it("survives an empty payload", () => {
    expect(learnItemsFromTraining([])).toEqual({
      group: null,
      family: null,
      items: []
    });
  });
});


describe("matchesLearnAnswer", () => {
  const item = {
    answer: "Verseau",
    aliases: ["Le Verseau"],
    answerPolicy: { preset: "relaxed" }
  };

  it("accepts the answer, an alias, and a relaxed spelling", () => {
    expect(matchesLearnAnswer(item, "Verseau")).toBe(true);
    expect(matchesLearnAnswer(item, "le verseau")).toBe(true);
    expect(matchesLearnAnswer(item, "  verseau ")).toBe(true);
  });

  it("rejects a wrong answer and a blank one", () => {
    expect(matchesLearnAnswer(item, "Poissons")).toBe(false);
    expect(matchesLearnAnswer(item, "")).toBe(false);
  });
});


describe("answerHint", () => {
  it("keeps the first letter of each word", () => {
    expect(answerHint("Verseau", 1)).toBe("V······");
    expect(answerHint("Costa Rica", 1)).toBe("C···· R···");
  });

  it("widens with the level", () => {
    expect(answerHint("Verseau", 3)).toBe("Ver····");
  });

  it("returns nothing for an empty answer", () => {
    expect(answerHint("", 1)).toBe("");
  });
});


describe("the drill ladder", () => {
  const item = {
    questionId: 1,
    answer: "Verseau",
    aliases: [],
    answerPolicy: { preset: "relaxed" }
  };
  const items = [item, { ...item, questionId: 2, answer: "Poissons" }];

  it("retires a card answered from memory", () => {
    const { state, outcome } = submitTypedAnswer(createDrill(items), item, "Verseau");

    expect(outcome).toBe("correct");
    expect(state.solved).toEqual([1]);
    expect(drillCurrentId(state)).toBe(2);
  });

  it("climbs typing -> hint -> choice on repeated misses", () => {
    let state = createDrill(items);

    expect(state.step).toBe(DRILL_STEPS.TYPE);

    ({ state } = submitTypedAnswer(state, item, "faux"));
    expect(state.step).toBe(DRILL_STEPS.HINT);
    expect(state.hintLevel).toBe(1);
    // Still the same card: help is bought, the card is not skipped.
    expect(drillCurrentId(state)).toBe(1);

    ({ state } = submitTypedAnswer(state, item, "encore faux"));
    expect(state.step).toBe(DRILL_STEPS.CHOICE);
    expect(drillCurrentId(state)).toBe(1);
  });

  it("shows the answer instead of a fake choice when decoys are not meaningful", () => {
    let state = createDrill([item]);

    ({ state } = submitTypedAnswer(state, item, "faux"));
    ({ state } = submitTypedAnswer(state, item, "encore faux", { canOfferChoice: false }));

    expect(state.step).toBe(DRILL_STEPS.REVEAL);
    expect(state.outcomes["1"].support).toBe(LEARN_SUPPORT.ANSWER);

    state = continueAfterReveal(state);
    expect(state.queue).toEqual([1]);
    expect(state.step).toBe(DRILL_STEPS.TYPE);
  });

  it("records every offered pair when a choice is made", () => {
    const state = { ...createDrill(items), step: DRILL_STEPS.CHOICE };
    const { state: next, outcome } = submitChoice(state, item, 2, [1, 2, 3]);

    expect(outcome).toBe("wrong");
    expect(next.confusions).toEqual([
      { expected_id: 1, picked_id: 2, correct: false },
      { expected_id: 1, picked_id: 3, correct: true }
    ]);
  });

  it("sends a card missed even on a choice back to free recall", () => {
    const state = { ...createDrill(items), step: DRILL_STEPS.CHOICE };
    const { state: next } = submitChoice(state, item, 2, [1, 2]);

    expect(next.queue).toEqual([2, 1]);
    expect(next.step).toBe(DRILL_STEPS.TYPE);
    expect(next.solved).toEqual([]);
  });

  it("requeues a correct choice because recognition is not recall", () => {
    const state = { ...createDrill(items), step: DRILL_STEPS.CHOICE };
    const { state: next, outcome } = submitChoice(state, item, 1, [1, 2]);

    expect(outcome).toBe("recognized");
    expect(next.queue).toEqual([2, 1]);
    expect(next.solved).toEqual([]);
    expect(next.confusions).toEqual([
      { expected_id: 1, picked_id: 2, correct: true }
    ]);
  });

  it("requeues a skipped card instead of dropping it", () => {
    const next = skipCurrent(createDrill(items));

    expect(next.queue).toEqual([2, 1]);
  });

  it("ends only once the queue is empty", () => {
    let state = createDrill([item]);

    expect(isDrillDone(state)).toBe(false);
    ({ state } = submitTypedAnswer(state, item, "Verseau"));
    expect(isDrillDone(state)).toBe(true);
  });

  it("classifies final recalls by the strongest support used", () => {
    const [first, second, third, fourth] = [
      item,
      { ...item, questionId: 2, answer: "Vierge" },
      { ...item, questionId: 3, answer: "Volcan" },
      { ...item, questionId: 4, answer: "Vison" }
    ];
    let state = createDrill([first, second, third, fourth]);

    ({ state } = submitTypedAnswer(state, first, "Verseau"));

    ({ state } = submitTypedAnswer(state, second, "faux"));
    ({ state } = submitTypedAnswer(state, second, "Vierge"));

    ({ state } = submitTypedAnswer(state, third, "faux"));
    ({ state } = submitTypedAnswer(state, third, "encore faux", { canOfferChoice: true }));
    ({ state } = submitChoice(state, third, 3, [3, 4, 1, 2]));

    ({ state } = submitTypedAnswer(state, fourth, "faux"));
    ({ state } = submitTypedAnswer(state, fourth, "encore faux", { canOfferChoice: false }));
    state = continueAfterReveal(state);

    ({ state } = submitTypedAnswer(state, third, "Volcan"));
    ({ state } = submitTypedAnswer(state, fourth, "Vison"));

    const stats = drillResultStats(state);

    expect(stats.memory.ids).toEqual([1]);
    expect(stats.hint.ids).toEqual([2]);
    expect(stats.choice.ids).toEqual([3]);
    expect(stats.review.ids).toEqual([4]);
    expect(helpedQuestionIds(state)).toEqual([2, 3, 4]);
  });

  it("puts a wrong QCM recall in the retravailler bucket", () => {
    let state = { ...createDrill([item]), step: DRILL_STEPS.CHOICE };

    ({ state } = submitChoice(state, item, 2, [1, 2, 3, 4]));
    ({ state } = submitTypedAnswer(state, item, "Verseau"));

    const stats = drillResultStats(state);

    expect(stats.choice.count).toBe(0);
    expect(stats.review.ids).toEqual([1]);
  });
});


describe("Learn choice decoys", () => {
  it("requires enough decoys compatible with the visible hint", () => {
    const target = card(10, "p", "Biais de confirmation");
    const candidates = [
      card(11, "p", "Biais de cadrage"),
      card(12, "p", "Biais de croyance"),
      card(13, "p", "Biais de conservatisme"),
      card(14, "p", "Effet de halo")
    ];

    expect(learnChoiceDecoys(target, candidates).map(item => item.answer)).toEqual([
      "Biais de cadrage",
      "Biais de conservatisme",
      "Biais de croyance"
    ]);
    expect(canOfferLearnChoice(target, candidates)).toBe(true);
  });

  it("rejects choices the first-letter hint would give away", () => {
    const target = card(20, "p", "Costa Rica");
    const candidates = [
      card(21, "p", "Chili"),
      card(22, "p", "Colombie"),
      card(23, "p", "Canada"),
      card(24, "p", "Côte d'Ivoire")
    ];

    expect(learnChoiceDecoys(target, candidates)).toEqual([]);
    expect(canOfferLearnChoice(target, candidates)).toBe(false);
  });
});
