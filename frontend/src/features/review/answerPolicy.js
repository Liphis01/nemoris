export const ANSWER_POLICY_RELAXED = {
  preset: "relaxed",
  case: "ignore",
  diacritics: "ignore",
  spacing: "relaxed",
  punctuation: "relaxed",
  fuzzy: "none"
};

export const ANSWER_POLICY_EXACT = {
  preset: "exact",
  case: "strict",
  diacritics: "strict",
  spacing: "strict",
  punctuation: "strict",
  fuzzy: "none"
};

export const ANSWER_POLICY_GOLDEN_VECTORS = [
  {
    policy: ANSWER_POLICY_RELAXED,
    left: "Ville-Lumiere",
    right: "ville lumiere",
    matches: true
  },
  {
    policy: ANSWER_POLICY_RELAXED,
    left: "État",
    right: "etat",
    matches: true
  },
  {
    policy: ANSWER_POLICY_EXACT,
    left: "État",
    right: "etat",
    matches: false
  },
  {
    policy: ANSWER_POLICY_EXACT,
    left: "Ville-Lumiere",
    right: "Ville Lumiere",
    matches: false
  }
];

export function answerPolicyForPreset(preset) {
  return preset === "exact"
    ? { ...ANSWER_POLICY_EXACT }
    : { ...ANSWER_POLICY_RELAXED };
}

export function normalizeAnswerPolicy(policy) {
  const preset = policy?.preset === "exact" ? "exact" : "relaxed";
  const base = answerPolicyForPreset(preset);

  return {
    ...base,
    ...(policy?.case === "strict" || policy?.case === "ignore"
      ? { case: policy.case }
      : {}),
    ...(policy?.diacritics === "strict" || policy?.diacritics === "ignore"
      ? { diacritics: policy.diacritics }
      : {}),
    ...(policy?.spacing === "strict" || policy?.spacing === "relaxed"
      ? { spacing: policy.spacing }
      : {}),
    ...(policy?.punctuation === "strict" || policy?.punctuation === "relaxed"
      ? { punctuation: policy.punctuation }
      : {}),
    fuzzy: "none"
  };
}

export function normalizeAnswerText(value = "", policy = ANSWER_POLICY_RELAXED) {
  const resolved = normalizeAnswerPolicy(policy);
  let text = String(value ?? "");

  if (resolved.case === "ignore") {
    text = text.toLowerCase();
  }

  if (resolved.diacritics === "ignore") {
    text = text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  }

  if (resolved.punctuation === "relaxed") {
    text = text.replace(/[-\s]+/g, " ");
  } else if (resolved.spacing === "relaxed") {
    text = text.replace(/\s+/g, " ");
  }

  if (resolved.spacing === "relaxed") {
    text = text.trim();
  }

  return text;
}

export function answerValues(item) {
  return [
    item?.answer,
    item?.label,
    item?.code,
    ...(item?.aliases || item?.data?.aliases || [])
  ].filter(Boolean);
}

export function matchesAnswerValue(item, value, policy = item?.answer_policy) {
  const resolved = normalizeAnswerPolicy(policy);
  const normalized = normalizeAnswerText(value, resolved);

  if (!normalized) return false;

  return answerValues(item).some(answer =>
    normalizeAnswerText(answer, resolved) === normalized
  );
}
