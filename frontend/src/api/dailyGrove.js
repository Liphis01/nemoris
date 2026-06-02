import { requestJson } from "./http";


export function getDailyGroveStatus() {
  return requestJson("/daily_grove/status");
}


export function completeDailyGrove() {
  return requestJson("/daily_grove/complete", {
    method: "POST"
  });
}
