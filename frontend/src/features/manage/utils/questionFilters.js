export function getNextReview(question) {
  // Manage receives next_review either inside progress or flattened by some
  // older responses, so keep both supported.
  return question?.progress?.next_review || question?.next_review || null;
}


function normalizeString(value) {
  return String(value || "").trim().toLowerCase();
}


function normalizeSearchText(value) {
  return normalizeString(value).replace(/[-\s]+/g, " ");
}


function getQuestionTitle(question) {
  if (question?.type_q === "map") {
    return normalizeString(question.answer || question.question);
  }

  return normalizeString(question?.question || question?.answer);
}


function getGroupName(question) {
  return normalizeString(question?.group?.name);
}


function getNextReviewTime(question) {
  const nextReview = getNextReview(question);

  // Missing progress is treated as due now/overdue for review-focused sorting.
  if (!nextReview) return 0;

  const time = new Date(nextReview).getTime();

  return Number.isNaN(time) ? 0 : time;
}


function getReviewReps(question) {
  return Number(question?.progress?.reps || 0);
}


function getSortValues(question, sortField) {
  const id = Number(question?.id || 0);
  const title = getQuestionTitle(question);
  const type = normalizeString(question?.type_q);

  switch (sortField) {
    case "title":
      return [title, id];
    case "type":
      return [type, title, id];
    case "group":
      return [
        question?.group?.name ? 0 : 1,
        getGroupName(question),
        title,
        id
      ];
    case "next_review":
      return [getNextReviewTime(question), title, id];
    case "reps":
      return [getReviewReps(question), getNextReviewTime(question), title, id];
    case "id":
    default:
      return [id];
  }
}


function compareValues(valueA, valueB) {
  if (typeof valueA === "string" || typeof valueB === "string") {
    return String(valueA).localeCompare(String(valueB));
  }

  if (valueA < valueB) return -1;
  if (valueA > valueB) return 1;
  return 0;
}


function compareQuestions(a, b, sortField, sortOrder) {
  const valuesA = getSortValues(a, sortField);
  const valuesB = getSortValues(b, sortField);

  for (let index = 0; index < valuesA.length; index += 1) {
    const compared = compareValues(valuesA[index], valuesB[index]);

    if (compared !== 0) {
      if (sortField === "group" && index === 0) {
        return compared;
      }

      return sortOrder === "asc" ? compared : -compared;
    }
  }

  return 0;
}


function matchesType(question, questionTypeFilter) {
  if (!questionTypeFilter) return true;

  return normalizeString(question?.type_q) === normalizeString(questionTypeFilter);
}


function matchesSearch(question, search) {
  const normalizedSearch = normalizeSearchText(search);
  const directAliases = Array.isArray(question?.aliases) ? question.aliases : [];
  const dataAliases = Array.isArray(question?.data?.aliases)
    ? question.data.aliases
    : [];
  const searchableValues = [
    question.question,
    question.answer,
    ...directAliases,
    ...dataAliases
  ];

  return searchableValues.some(value =>
    normalizeSearchText(value).includes(normalizedSearch)
  );
}


function matchesTag(question, tagFilter) {
  if (!tagFilter) return true;

  const normalizedFilter = tagFilter.toLowerCase();

  return (question.tags || []).some(tag =>
    tag.toLowerCase().includes(normalizedFilter)
  );
}


function matchesDue(question, dueOnly) {
  if (!dueOnly) return true;

  const nextReview = getNextReview(question);

  // Missing progress means "not scheduled yet", which should be visible when
  // filtering for due work.
  if (!nextReview) return true;

  return new Date(nextReview) <= new Date();
}


export function filterAndSortQuestions({
  questions,
  search,
  tagFilter,
  questionTypeFilter,
  dueOnly,
  sortField,
  sortOrder
}) {
  // Filtering stays pure and deterministic so Manage can recompute visible rows
  // from local state after edits without refetching.
  return questions
    .filter(question =>
      matchesSearch(question, search) &&
      matchesTag(question, tagFilter) &&
      matchesType(question, questionTypeFilter) &&
      matchesDue(question, dueOnly)
    )
    .slice()
    .sort((a, b) => compareQuestions(a, b, sortField, sortOrder));
}
