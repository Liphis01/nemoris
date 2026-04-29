export async function getReview(selectedTags = [], limit = 20) {
  const res = await fetch("http://localhost:8000/questions");
  const data = await res.json();

  return data
    .filter(q =>
      selectedTags.length === 0 ||
      selectedTags.every(tag => q.tags?.includes(tag))
    )
    .slice(0, limit);
}

export async function sendAnswer(questionId, quality) {
  await fetch("http://localhost:8000/answer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      question_id: questionId,
      quality: quality,
    }),
  });
}