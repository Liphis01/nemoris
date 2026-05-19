export function getNextReview(question) {
  return question?.progress?.next_review || question?.next_review || null;
}


function matchesSearch(question, search) {
  const normalizedSearch = search.toLowerCase();

  return (
    (question.question || "").toLowerCase().includes(normalizedSearch) ||
    (question.answer || "").toLowerCase().includes(normalizedSearch)
  );
}


function matchesTag(question, filterTheme) {
  if (!filterTheme) return true;

  const normalizedFilter = filterTheme.toLowerCase();

  return (question.tags || []).some(tag =>
    tag.toLowerCase().includes(normalizedFilter)
  );
}


function matchesDue(question, filterDue) {
  if (!filterDue) return true;

  const nextReview = getNextReview(question);

  if (!nextReview) return true;

  return new Date(nextReview) <= new Date();
}


export function filterAndSortQuestions({
  questions,
  search,
  filterTheme,
  filterDue,
  sortField,
  sortOrder
}) {
  return questions
    .filter(question =>
      matchesSearch(question, search) &&
      matchesTag(question, filterTheme) &&
      matchesDue(question, filterDue)
    )
    .slice()
    .sort((a, b) => {
      let valueA = a[sortField];
      let valueB = b[sortField];

      if (sortField === "next_review") {
        valueA = getNextReview(a) ? new Date(getNextReview(a)) : new Date(0);
        valueB = getNextReview(b) ? new Date(getNextReview(b)) : new Date(0);
      }

      if (typeof valueA === "string") {
        valueA = valueA.toLowerCase();
        valueB = valueB.toLowerCase();
      }

      if (valueA < valueB) return sortOrder === "asc" ? -1 : 1;
      if (valueA > valueB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
}
