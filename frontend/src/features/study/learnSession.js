import { matchesAnswerValue, normalizeAnswerText } from "../review/answerPolicy";

// A learner who has never been quizzed on a card has nothing to recall yet, so
// the browse list surfaces those first-class rather than mixing them in.
export const LEARN_STATES = {
  UNSEEN: "unseen",
  SEEN: "seen"
};

// The drill asks for free recall first and only buys help when that fails:
// typing -> first letters -> pick from four. Dropping straight to a choice
// would turn recall into recognition, which is the easy half of learning.
export const DRILL_STEPS = {
  TYPE: "type",
  HINT: "hint",
  CHOICE: "choice"
};

const CHOICE_COUNT = 4;


function firstGroupItem(payload) {
  const items = Array.isArray(payload) ? payload : [];

  return items.find(item => Array.isArray(item?.items) && item.items.length > 0)
    || items[0]
    || null;
}


function itemPrompt(family, item) {
  // A map zone is asked by highlighting it, and a media card by showing the
  // media, so neither has a text prompt. Media's `question` field is built as
  // "<group> - <answer>" server-side and would give the answer away.
  if (family === "map" || family === "media") return "";

  const prompt = item?.question || "";

  return prompt === item?.answer ? "" : prompt;
}


export function learnItemsFromTraining(payload) {
  const group = firstGroupItem(payload);

  if (!group) {
    return { group: null, family: null, items: [] };
  }

  const family = group.type_q || null;
  // /training shuffles its items -- right for free practice, wrong here. A
  // learner reads the same page repeatedly, so the order has to hold still, and
  // for imported content the source order is the meaningful one (a zodiac group
  // is in calendar order, a list of kings in reign order). Rank first when the
  // type has one, then fall back to creation order.
  const ordered = [...(group.items || [])].sort((left, right) => {
    const leftRank = left.position ?? null;
    const rightRank = right.position ?? null;

    if (leftRank !== null && rightRank !== null && leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return (left.question_id || 0) - (right.question_id || 0);
  });
  const items = ordered.map((item) => {
    const reps = Number(item?.progress?.reps) || 0;

    return {
      questionId: item.question_id,
      prompt: itemPrompt(family, item),
      answer: item.label || item.answer || "",
      aliases: item.aliases || [],
      answerPolicy: item.answer_policy || group.answer_policy || null,
      code: item.code || null,
      position: item.position ?? null,
      media: item.media || null,
      mediaPool: item.media_pool || null,
      tags: item.tags || [],
      state: reps > 0 ? LEARN_STATES.SEEN : LEARN_STATES.UNSEEN,
      // Kept whole so the drill can hand the raw card to buildChoiceOptions,
      // which reads progress history and learn_confusions off it.
      source: item
    };
  });

  return { group, family, items };
}


export function matchesLearnAnswer(item, value) {
  if (!item) return false;

  // answerValues() reads answer/label/code/aliases, so a map zone matches on
  // its label and a text card on any of its aliases, with the question's own
  // answer policy deciding how forgiving the comparison is.
  return matchesAnswerValue(
    {
      answer: item.answer,
      label: item.answer,
      aliases: item.aliases,
      answer_policy: item.answerPolicy
    },
    value,
    item.answerPolicy
  );
}


export function isBlankAnswer(value) {
  return normalizeAnswerText(value || "").length === 0;
}


// Reveal enough to unstick recall without giving the answer: the first letter
// of each word, then a second pass adds one more letter per word.
export function answerHint(answer, level = 1) {
  const text = String(answer || "");

  if (!text) return "";

  const keep = Math.max(1, level);

  return text
    .split(/(\s+)/)
    .map((chunk) => {
      if (/^\s+$/.test(chunk)) return chunk;

      const shown = chunk.slice(0, keep);
      const hidden = Math.max(0, chunk.length - keep);

      return shown + "·".repeat(hidden);
    })
    .join("");
}


export function createDrill(items) {
  const queue = (items || []).map(item => item.questionId);

  return {
    queue,
    step: queue.length ? DRILL_STEPS.TYPE : null,
    attempts: 0,
    hintLevel: 0,
    solved: [],
    confusions: [],
    total: queue.length
  };
}


export function drillCurrentId(state) {
  return state?.queue?.[0] ?? null;
}


export function isDrillDone(state) {
  return !state || state.queue.length === 0;
}


function advance(state, extra = {}) {
  const [, ...rest] = state.queue;

  return {
    ...state,
    ...extra,
    queue: rest,
    step: rest.length ? DRILL_STEPS.TYPE : null,
    attempts: 0,
    hintLevel: 0
  };
}


function requeue(state, extra = {}) {
  const [head, ...rest] = state.queue;

  return {
    ...state,
    ...extra,
    queue: [...rest, head],
    step: DRILL_STEPS.TYPE,
    attempts: 0,
    hintLevel: 0
  };
}


// A correct answer retires the card. A miss buys the next rung of help on the
// same card, so the learner still has to produce it before moving on.
export function submitTypedAnswer(state, item, value) {
  if (isDrillDone(state)) return { state, outcome: "done" };

  if (matchesLearnAnswer(item, value)) {
    return {
      state: advance(state, { solved: [...state.solved, item.questionId] }),
      outcome: "correct"
    };
  }

  if (state.step === DRILL_STEPS.TYPE) {
    return {
      state: { ...state, step: DRILL_STEPS.HINT, hintLevel: 1, attempts: state.attempts + 1 },
      outcome: "hint"
    };
  }

  if (state.step === DRILL_STEPS.HINT) {
    return {
      state: { ...state, step: DRILL_STEPS.CHOICE, attempts: state.attempts + 1 },
      outcome: "choice"
    };
  }

  return { state: { ...state, attempts: state.attempts + 1 }, outcome: "retry" };
}


// The choice step is the only one that produces a confusion pair: it is the
// only place where the learner picks a named sibling instead of the answer.
export function submitChoice(state, item, pickedId, offeredIds = []) {
  if (isDrillDone(state)) return { state, outcome: "done" };

  const correct = pickedId === item.questionId;
  const confusions = offeredIds
    .filter(id => id !== item.questionId)
    .map(id => ({
      expected_id: item.questionId,
      picked_id: id,
      correct: id !== pickedId
    }));
  const nextConfusions = [...state.confusions, ...confusions];

  if (correct) {
    return {
      state: advance(state, {
        confusions: nextConfusions,
        solved: [...state.solved, item.questionId]
      }),
      outcome: "correct"
    };
  }

  // Wrong even with four options on screen: send it to the back of the queue
  // and start it over from free recall.
  return {
    state: requeue(state, { confusions: nextConfusions }),
    outcome: "wrong"
  };
}


export function skipCurrent(state) {
  if (isDrillDone(state)) return state;

  return requeue(state);
}


export const CHOICE_OPTION_COUNT = CHOICE_COUNT;
