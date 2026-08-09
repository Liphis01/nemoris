import {
  answerValues,
  matchesAnswerValue,
  normalizeAnswerText
} from "./answerPolicy";


export function normalizeTextTrainingAnswer(value = "") {
  return normalizeAnswerText(value);
}


export function textAnswerValues(question) {
  return answerValues(question);
}


export function matchesTextTrainingAnswer(question, value) {
  return matchesAnswerValue(question, value);
}
