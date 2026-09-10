export const PROMPT_ERROR_BUDGETS = [null, 2, 1, 0];


export function normalizePromptErrorBudget(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const budget = Number(value);

  return Number.isInteger(budget) && [0, 1, 2].includes(budget)
    ? budget
    : null;
}


export function isFinitePromptErrorBudget(value) {
  return normalizePromptErrorBudget(value) !== null;
}


export function promptErrorBudgetExceeded(errorCount, maxErrorsPerQuestion) {
  const budget = normalizePromptErrorBudget(maxErrorsPerQuestion);

  if (budget === null) {
    return false;
  }

  const count = Number(errorCount);

  return Number.isFinite(count) && count > budget;
}


export function promptErrorCountLabel(errorCount, maxErrorsPerQuestion) {
  const budget = normalizePromptErrorBudget(maxErrorsPerQuestion);

  if (budget === null) {
    return "";
  }

  const count = Math.max(0, Number(errorCount) || 0);

  return `Erreurs ${Math.min(count, budget + 1)} / ${budget + 1}`;
}
