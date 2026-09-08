import { requestJson } from "./http";


// The only write a Learn session makes. Everything else it does -- revealing,
// selecting, drilling -- stays in the browser, so a session never schedules a
// card or creates a Progress row.
export function saveLearnConfusions(entries) {
  if (!entries?.length) return Promise.resolve(null);

  return requestJson("/learn/confusions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries })
  });
}
