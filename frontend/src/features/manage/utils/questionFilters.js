export function getNextReview(question) {
  // Manage receives next_review either inside progress or flattened by some
  // older responses, so keep both supported.
  return question?.progress?.next_review || question?.next_review || null;
}


function matchesSearch(question, search) {
  const normalizedSearch = search.toLowerCase();

  return (
    (question.question || "").toLowerCase().includes(normalizedSearch) ||
    (question.answer || "").toLowerCase().includes(normalizedSearch)
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
      matchesDue(question, dueOnly)
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
