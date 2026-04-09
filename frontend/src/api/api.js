export async function getReview(theme = "global", limit = 20) {
  const res = await fetch(
    `http://localhost:8000/review?theme=${theme}&limit=${limit}`
  );
  return res.json();
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