import { requestJson } from "./http";

export function getProfile() {
  return requestJson("/profile");
}

export function updateProfile({ username, avatar_emoji, avatar_color }) {
  return requestJson("/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, avatar_emoji, avatar_color })
  });
}
