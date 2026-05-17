import { apiUrl } from "./config";

export async function getReview(selectedTags = [], limit = 200, collectionId = null) {
  const params = new URLSearchParams();

  selectedTags.forEach(tag => params.append("tags", tag));

  if (limit) params.append("limit", limit);
  if (collectionId) params.append("collection_id", collectionId);

  const res = await fetch(apiUrl(`/review?${params}`));
  return await res.json();
}

export async function sendAnswer(questionId, quality) {
  await fetch(apiUrl("/answer"), {
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

export async function sendMapAnswer(items) {
  await fetch(apiUrl("/answer_map"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items })
  });
}
