import { requestJson } from "./http";


export function getStats() {
  return requestJson("/stats");
}
