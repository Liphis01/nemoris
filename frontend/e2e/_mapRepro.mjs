import { chromium } from "@playwright/test";
import { mockApi } from "./apiMock.js";

const BASE = process.env.QUIZ_URL || "http://127.0.0.1:5173";

function zone(question_id, code, label) {
  return {
    question_id,
    code,
    label,
    aliases: [],
    progress: { interval: 0, history: [], reps: 0 },
    projected_intervals: { 0: 0, 1: 1, 2: 3, 3: 7 }
  };
}

const items = [
  zone(101, "FR", "France"),
  zone(102, "DE", "Allemagne"),
  zone(103, "BR", "Brésil"),
  zone(104, "CA", "Canada")
];

const mapGroup = {
  group_id: 1,
  type_q: "map",
  name: "Pays du monde",
  media: "world.svg",
  tags: [],
  mode: process.env.MAP_MODE || "type_all",
  context_items: items,
  items
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await mockApi(page, { review: [mapGroup] });
await page.goto(BASE);

// Start the review session.
await page.getByRole("button", { name: /DÉMARRER/i }).click().catch(() => {});
await page.waitForTimeout(2500);

// Measure the injected SVG.
const info = await page.evaluate(() => {
  const svg = document.querySelector("[data-map-review-shell] svg, svg");
  if (!svg) return { found: false };
  const r = svg.getBoundingClientRect();
  const paths = svg.querySelectorAll("[data-code]").length;
  // bounding box of first few country paths
  const first = svg.querySelector('[data-code="FR"]');
  const fr = first ? first.getBoundingClientRect() : null;
  const container = svg.parentElement;
  const cs = getComputedStyle(container);
  return {
    found: true,
    svgRect: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) },
    paths,
    frRect: fr ? { w: Math.round(fr.width), h: Math.round(fr.height), x: Math.round(fr.x), y: Math.round(fr.y) } : null,
    transform: cs.transform
  };
});

console.log("MODE:", mapGroup.mode);
console.log("SVG INFO:", JSON.stringify(info, null, 2));
console.log("ERRORS:", errors.length ? errors : "none");

await page.screenshot({ path: "/tmp/map-repro.png", fullPage: false });
console.log("screenshot -> /tmp/map-repro.png");

await browser.close();
