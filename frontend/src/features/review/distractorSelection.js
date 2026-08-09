import {
  answerValues,
  normalizeAnswerText,
  normalizeAnswerPolicy
} from "./answerPolicy";

const DIFFICULTY_SCALE = 2;
const COOLDOWN_DECAY = 1.6;
const EXPOSURE_PRIOR = 20;
const FULL_FEEDBACK_EXPOSURES = 8;

function itemLabel(item) {
  return String(item?.label || item?.answer || "");
}

function editDistance(left, right) {
  const columns = right.length + 1;
  let previous = Array.from({ length: columns }, (_, index) => index);

  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];

    for (let column = 1; column < columns; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }

    previous = current;
  }

  return previous[columns - 1];
}

function sharedEdgeLength(left, right, fromEnd = false) {
  const limit = Math.min(left.length, right.length);
  let length = 0;

  while (length < limit) {
    const index = fromEnd ? -1 - length : length;

    if (left.at(index) !== right.at(index)) break;
    length += 1;
  }

  return length;
}

function comparableValue(value, policy) {
  return normalizeAnswerText(value, normalizeAnswerPolicy(policy));
}

function numericId(value) {
  const id = Number(value);

  return Number.isInteger(id) ? id : null;
}

function hasEquivalentAnswer(target, candidate) {
  const policy = normalizeAnswerPolicy(target?.answer_policy);
  const targetValues = answerValues(target)
    .map(value => comparableValue(value, policy))
    .filter(Boolean);
  const candidateValues = answerValues(candidate)
    .map(value => comparableValue(value, policy))
    .filter(Boolean);

  return candidateValues.some(value => targetValues.includes(value));
}

export function isEligibleDistractor(target, candidate) {
  return Boolean(
    target &&
    candidate &&
    candidate.question_id !== target.question_id &&
    itemLabel(candidate).trim() &&
    !hasEquivalentAnswer(target, candidate)
  );
}

export function stringConfusability(target, candidate) {
  const policy = normalizeAnswerPolicy(target?.answer_policy);
  const left = comparableValue(itemLabel(target), policy);
  const right = comparableValue(itemLabel(candidate), policy);

  if (!left || !right || left === right) return 0;

  const longest = Math.max(left.length, right.length);
  const shortest = Math.min(left.length, right.length);
  const editSimilarity = 1 - (editDistance(left, right) / longest);
  const sharedEdges = Math.max(
    sharedEdgeLength(left, right),
    sharedEdgeLength(left, right, true)
  ) / shortest;

  const score = Math.max(editSimilarity, sharedEdges);

  // Short accidental overlap is common in unrelated labels. Keep the baseline
  // sampler untouched until the strings carry a meaningful resemblance.
  return score >= 0.5 ? Math.min(1, score) : 0;
}

export function mapProximityConfusability(target, candidate, geometry) {
  const zones = geometry?.zones || geometry;
  const targetZone = zones?.[target?.code];
  const candidateZone = zones?.[candidate?.code];
  const diagonal = Number(geometry?.diagonal);

  if (
    !targetZone?.centroid ||
    !candidateZone?.centroid ||
    !Number.isFinite(diagonal) ||
    diagonal <= 0
  ) {
    return 0;
  }

  const distance = Math.hypot(
    targetZone.centroid.x - candidateZone.centroid.x,
    targetZone.centroid.y - candidateZone.centroid.y
  );

  return Math.max(0, Math.min(1, 1 - (distance / diagonal)));
}

export function sequenceProximityConfusability(target, candidate) {
  const distance = Math.abs(Number(target?.position) - Number(candidate?.position));

  return Number.isFinite(distance) && distance > 0 ? 1 / distance : 0;
}

export function feedbackConfusability(target, candidate) {
  const targetId = numericId(target?.question_id);
  const candidateId = numericId(candidate?.question_id);
  let exposures = 0;
  let mispicks = 0;

  if (targetId === null || candidateId === null) {
    return { exposures, mispicks, score: 0 };
  }

  for (const entry of target?.progress?.history || []) {
    const event = entry?.answer_event;
    const expectedId = numericId(event?.expected_card_id);
    const candidateIds = Array.isArray(event?.candidate_ids)
      ? event.candidate_ids.map(numericId).filter(id => id !== null)
      : [];

    if (
      expectedId !== targetId ||
      !candidateIds.includes(targetId) ||
      !candidateIds.includes(candidateId)
    ) {
      continue;
    }

    exposures += 1;

    if (numericId(event.raw_response) === candidateId) {
      mispicks += 1;
    }
  }

  const rate = (mispicks + 1) / (exposures + EXPOSURE_PRIOR);
  const confidence = Math.min(1, exposures / FULL_FEEDBACK_EXPOSURES);

  return { exposures, mispicks, score: rate * confidence };
}

export function confusabilityScore(target, candidate, { geometry, sequence } = {}) {
  const bootstrap = Math.max(
    stringConfusability(target, candidate),
    geometry ? mapProximityConfusability(target, candidate, geometry) : 0,
    sequence ? sequenceProximityConfusability(target, candidate) : 0
  );
  const feedback = feedbackConfusability(target, candidate).score;

  return 1 - ((1 - bootstrap) * (1 - feedback));
}

function historyStats(item) {
  const history = item?.progress?.history || [];

  if (history.length) {
    return {
      reviews: history.length,
      successRate: history.filter(entry => entry?.quality > 0).length / history.length
    };
  }

  const reps = Number(item?.progress?.reps) || 0;
  const lapses = Number(item?.progress?.lapses) || 0;

  return {
    reviews: reps,
    successRate: reps ? Math.max(0, reps - lapses) / reps : null
  };
}

function difficultyScore(item) {
  const explicit = Number(item?.progress?.difficulty);

  if (Number.isFinite(explicit)) return explicit;

  const stats = historyStats(item);
  return stats.successRate === null ? 5 : 10 - (stats.successRate * 10);
}

function compareCandidates(left, right) {
  const difficultyDifference = difficultyScore(right) - difficultyScore(left);

  if (difficultyDifference) return difficultyDifference;

  const labelDifference = itemLabel(left).localeCompare(itemLabel(right));

  return labelDifference || ((left.question_id || 0) - (right.question_id || 0));
}

function shuffle(items, random = Math.random) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }

  return copy;
}

export function weightedSampleDistractors(
  target,
  items,
  count,
  usageCounts = new Map(),
  options = {}
) {
  const random = options.random || Math.random;
  const candidates = [...(items || [])].sort(compareCandidates);
  const selected = [];

  while (selected.length < count && candidates.length) {
    const maxDifficulty = Math.max(...candidates.map(difficultyScore));
    const weighted = candidates.map((item, index) => {
      const difficulty = Math.exp(
        (difficultyScore(item) - maxDifficulty) / DIFFICULTY_SCALE
      );
      const cooldown = Math.exp(
        -COOLDOWN_DECAY * (usageCounts.get(item.question_id) || 0)
      );
      const multiplier = 1 + confusabilityScore(target, item, options);

      return { index, item, weight: difficulty * cooldown * multiplier };
    }).sort((left, right) => (
      (right.weight - left.weight) || compareCandidates(left.item, right.item)
    ));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let threshold = random() * total;
    let selectedIndex = weighted.at(-1).index;

    for (const entry of weighted) {
      threshold -= entry.weight;
      if (threshold <= 0) {
        selectedIndex = entry.index;
        break;
      }
    }

    selected.push(candidates[selectedIndex]);
    candidates.splice(selectedIndex, 1);
  }

  return selected;
}

export function buildChoiceOptions(
  target,
  contextItems,
  usageCounts,
  excludeQuestionIds,
  options = {}
) {
  if (!target) return [];

  const candidates = (contextItems || []).filter(item =>
    isEligibleDistractor(target, item)
  );
  const preferred = excludeQuestionIds
    ? candidates.filter(item => !excludeQuestionIds.has(item.question_id))
    : candidates;
  let distractors = weightedSampleDistractors(
    target,
    preferred,
    3,
    usageCounts,
    options
  );

  if (distractors.length < 3) {
    const chosen = new Set(distractors.map(item => item.question_id));
    distractors = distractors.concat(weightedSampleDistractors(
      target,
      candidates.filter(item => !chosen.has(item.question_id)),
      3 - distractors.length,
      usageCounts,
      options
    ));
  }

  return shuffle([target, ...distractors], options.random);
}
