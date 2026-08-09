import {
  ANSWER_POLICY_EXACT,
  ANSWER_POLICY_RELAXED,
  normalizeAnswerPolicy
} from "../../review/answerPolicy";

export function answerPolicyFromGroup(group) {
  return normalizeAnswerPolicy(
    group?.answer_policy || group?.data?.answer_policy || ANSWER_POLICY_RELAXED
  );
}

export function policyPresetValue(policy) {
  return normalizeAnswerPolicy(policy).preset === ANSWER_POLICY_EXACT.preset
    ? ANSWER_POLICY_EXACT.preset
    : ANSWER_POLICY_RELAXED.preset;
}
