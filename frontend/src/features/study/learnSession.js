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
  CHOICE: "choice",
  REVEAL: "reveal"
};

const CHOICE_COUNT = 4;
const MIN_CHOICE_DECOYS = CHOICE_COUNT - 1;

export const LEARN_SUPPORT = {
  NONE: "none",
  HINT: "hint",
  CHOICE: "choice",
  ANSWER: "answer"
};

const SUPPORT_RANK = {
  [LEARN_SUPPORT.NONE]: 0,
  [LEARN_SUPPORT.HINT]: 1,
  [LEARN_SUPPORT.CHOICE]: 2,
  [LEARN_SUPPORT.ANSWER]: 3
};


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

function answerWords(answer) {
  return normalizeAnswerText(answer || "")
    .split(/\s+/)
    .map(word => word.trim())
    .filter(Boolean);
}


function hintProfile(answer) {
  const words = answerWords(answer);

  return {
    initials: words.map(word => word[0] || ""),
    wordCount: words.length
  };
}


function itemAnswer(item) {
  return item?.label || item?.answer || "";
}


function itemId(item) {
  return item?.questionId ?? item?.question_id ?? null;
}


export function learnHintSignature(answer) {
  return hintProfile(answer).initials.join(" ");
}


function sharedInitialPrefix(left, right) {
  const length = Math.min(left.length, right.length);
  let shared = 0;

  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) break;
    shared += 1;
  }

  return shared;
}


function hintCompatibilityTier(target, candidate) {
  const targetProfile = hintProfile(itemAnswer(target));
  const candidateProfile = hintProfile(itemAnswer(candidate));

  if (!targetProfile.wordCount || !candidateProfile.wordCount) return 0;

  const sameSignature = (
    targetProfile.wordCount === candidateProfile.wordCount
    && targetProfile.initials.join("|") === candidateProfile.initials.join("|")
  );

  if (sameSignature) return 2;

  const shared = sharedInitialPrefix(
    targetProfile.initials,
    candidateProfile.initials
  );
  const sameShape = targetProfile.wordCount === candidateProfile.wordCount;
  const enoughShared = shared >= Math.min(2, targetProfile.wordCount);

  return sameShape && enoughShared ? 1 : 0;
}


export function learnChoiceDecoys(target, candidates, count = MIN_CHOICE_DECOYS) {
  const targetId = itemId(target);
  const targetAnswer = normalizeAnswerText(itemAnswer(target));
  const targetWordCount = hintProfile(itemAnswer(target)).wordCount;
  const ranked = (candidates || [])
    .filter(candidate => {
      const candidateId = itemId(candidate);

      return (
        candidateId !== null
        && candidateId !== targetId
        && normalizeAnswerText(itemAnswer(candidate)) !== targetAnswer
      );
    })
    .map(candidate => ({
      candidate,
      tier: hintCompatibilityTier(target, candidate),
      wordCount: hintProfile(itemAnswer(candidate)).wordCount
    }))
    .filter(entry => entry.tier > 0)
    .sort((left, right) => (
      (right.tier - left.tier)
      || (Math.abs(left.wordCount - targetWordCount)
        - Math.abs(right.wordCount - targetWordCount))
      || itemAnswer(left.candidate).localeCompare(itemAnswer(right.candidate), "fr")
      || ((itemId(left.candidate) || 0) - (itemId(right.candidate) || 0))
    ));

  if (ranked.length < count) return [];

  return ranked.map(entry => entry.candidate);
}


export function canOfferLearnChoice(target, candidates) {
  return learnChoiceDecoys(target, candidates).length >= MIN_CHOICE_DECOYS;
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
    itemIds: [...queue],
    queue,
    step: queue.length ? DRILL_STEPS.TYPE : null,
    attempts: 0,
    hintLevel: 0,
    solved: [],
    confusions: [],
    outcomes: {},
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


function strongerSupport(left = LEARN_SUPPORT.NONE, right = LEARN_SUPPORT.NONE) {
  return SUPPORT_RANK[right] > SUPPORT_RANK[left] ? right : left;
}


function markOutcome(state, questionId, changes = {}) {
  const key = String(questionId);
  const current = state.outcomes?.[key] || {
    support: LEARN_SUPPORT.NONE,
    solved: false
  };
  const support = strongerSupport(current.support, changes.support);

  return {
    ...state,
    outcomes: {
      ...(state.outcomes || {}),
      [key]: {
        ...current,
        ...changes,
        support,
        solved: Boolean(current.solved || changes.solved)
      }
    }
  };
}


function markSolved(state, questionId) {
  const solved = state.solved.includes(questionId)
    ? state.solved
    : [...state.solved, questionId];

  return {
    ...markOutcome(state, questionId, { solved: true }),
    solved
  };
}


// A correct answer retires the card. A miss buys the next rung of help on the
// same card, so the learner still has to produce it before moving on.
export function submitTypedAnswer(state, item, value, options = {}) {
  if (isDrillDone(state)) return { state, outcome: "done" };

  if (matchesLearnAnswer(item, value)) {
    return {
      state: advance(markSolved(state, item.questionId)),
      outcome: "correct",
      support: state.outcomes?.[String(item.questionId)]?.support || LEARN_SUPPORT.NONE
    };
  }

  if (state.step === DRILL_STEPS.TYPE) {
    return {
      state: {
        ...markOutcome(state, item.questionId, { support: LEARN_SUPPORT.HINT }),
        step: DRILL_STEPS.HINT,
        hintLevel: 1,
        attempts: state.attempts + 1
      },
      outcome: "hint"
    };
  }

  if (state.step === DRILL_STEPS.HINT) {
    if (options.canOfferChoice === false) {
      return {
        state: {
          ...markOutcome(state, item.questionId, { support: LEARN_SUPPORT.ANSWER }),
          step: DRILL_STEPS.REVEAL,
          attempts: state.attempts + 1
        },
        outcome: "answer"
      };
    }

    return {
      state: {
        ...markOutcome(state, item.questionId, { support: LEARN_SUPPORT.CHOICE }),
        step: DRILL_STEPS.CHOICE,
        attempts: state.attempts + 1
      },
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
  const markedState = markOutcome({
    ...state,
    confusions: nextConfusions
  }, item.questionId, {
    support: LEARN_SUPPORT.CHOICE,
    recognized: correct,
    choiceMissed: !correct
  });

  if (correct) {
    return {
      state: requeue(markedState),
      outcome: "recognized"
    };
  }

  // Wrong even with four options on screen: send it to the back of the queue
  // and start it over from free recall.
  return {
    state: requeue(markedState),
    outcome: "wrong"
  };
}


export function continueAfterReveal(state) {
  if (isDrillDone(state)) return state;

  return requeue(state);
}


export function skipCurrent(state) {
  if (isDrillDone(state)) return state;

  return requeue(state);
}


export function drillResultStats(state) {
  const stats = {
    memory: { count: 0, ids: [] },
    hint: { count: 0, ids: [] },
    choice: { count: 0, ids: [] },
    review: { count: 0, ids: [] }
  };

  for (const questionId of state?.solved || []) {
    const outcome = state.outcomes?.[String(questionId)] || {};
    const support = outcome.support || LEARN_SUPPORT.NONE;
    let bucket = "review";

    if (support === LEARN_SUPPORT.NONE) bucket = "memory";
    else if (support === LEARN_SUPPORT.HINT) bucket = "hint";
    else if (support === LEARN_SUPPORT.CHOICE && outcome.recognized && !outcome.choiceMissed) {
      bucket = "choice";
    }

    stats[bucket].count += 1;
    stats[bucket].ids.push(questionId);
  }

  return stats;
}


export function helpedQuestionIds(state) {
  const stats = drillResultStats(state);

  return [
    ...stats.hint.ids,
    ...stats.choice.ids,
    ...stats.review.ids
  ];
}


export function reviveDrillState(saved, items) {
  const state = saved?.state || saved;
  const availableIds = new Set((items || []).map(item => item.questionId));

  if (!state || !Array.isArray(state.queue) || !Array.isArray(state.itemIds)) {
    return null;
  }

  const itemIds = state.itemIds.filter(id => availableIds.has(id));
  const itemIdSet = new Set(itemIds);
  const queue = state.queue.filter(id => itemIdSet.has(id));
  const solved = Array.isArray(state.solved)
    ? state.solved.filter(id => itemIdSet.has(id))
    : [];

  if (!itemIds.length || !queue.length) return null;

  const step = Object.values(DRILL_STEPS).includes(state.step)
    ? state.step
    : DRILL_STEPS.TYPE;

  return {
    ...createDrill((items || []).filter(item => itemIdSet.has(item.questionId))),
    ...state,
    itemIds,
    queue,
    solved,
    step,
    attempts: Number(state.attempts) || 0,
    hintLevel: Number(state.hintLevel) || 0,
    confusions: Array.isArray(state.confusions) ? state.confusions : [],
    outcomes: state.outcomes && typeof state.outcomes === "object" ? state.outcomes : {},
    total: Number(state.total) || itemIds.length
  };
}


export const CHOICE_OPTION_COUNT = CHOICE_COUNT;
