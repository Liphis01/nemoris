#!/usr/bin/env node
// Nemoris quiz-app interaction driver.
// Uses Playwright with mocked backend — no running backend required.
//
// Usage (from repo root, with Vite dev server already running):
//   node .claude/skills/run-quiz-app/driver.mjs [command] [outfile]
//
// Commands:
//   smoke               — home page + full text review flow (default)
//   screenshot <path>   — just a home page screenshot
//   review <path>       — text review flow end-to-end, screenshot result
//
// Environment:
//   QUIZ_URL  — override base URL (default: http://127.0.0.1:5173)

import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "../../../frontend");

// Resolve Playwright from the frontend project's node_modules
const pwPath = path.resolve(frontendDir, "node_modules/@playwright/test/index.mjs");
const { chromium } = await import(pwPath);

// Re-use the existing e2e API mock so our driver stays in sync with the app
const { mockApi } = await import(
  path.resolve(frontendDir, "e2e/apiMock.js")
);

const BASE_URL = process.env.QUIZ_URL || "http://127.0.0.1:5173";
const [, , cmd = "smoke", arg] = process.argv;

async function withPage(fn) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function ss(page, outPath) {
  const resolved = path.resolve(outPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  await page.screenshot({ path: resolved, fullPage: true });
  console.log(`screenshot → ${resolved}`);
}

// Standard one-question review fixture
const reviewFixture = [
  {
    question_id: 1,
    type_q: "text",
    question: "Capitale de la France ?",
    answer: "Paris",
    tags: ["geo"]
  }
];

if (cmd === "screenshot") {
  const out = arg || "/tmp/quiz-screenshot.png";
  await withPage(async (page) => {
    await mockApi(page, { review: reviewFixture });
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    await ss(page, out);
  });

} else if (cmd === "review") {
  const out = arg || "/tmp/quiz-review.png";
  await withPage(async (page) => {
    await mockApi(page, { review: reviewFixture });
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    // The review hero card's accessible name comes from its aria-label
    // ("Révision du jour: ...") not its visible "DÉMARRER →" text.
    await page.getByRole("button", { name: /Révision du jour/ }).click();
    await page.waitForSelector("text=Voir la réponse");
    await page.getByRole("button", { name: "Voir la réponse" }).click();
    await page.getByRole("button", { name: /Bon/ }).click();
    await page.waitForSelector("text=Session terminée");
    await ss(page, out);
    console.log("review flow: OK");
  });

} else if (cmd === "smoke") {
  await withPage(async (page) => {
    await mockApi(page, { review: reviewFixture });

    // 1. Home page
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    await ss(page, "/tmp/quiz-smoke-home.png");
    console.log("home: OK");

    // 2. Start review
    await page.getByRole("button", { name: /Révision du jour/ }).click();
    await page.waitForSelector("text=Voir la réponse");
    await ss(page, "/tmp/quiz-smoke-question.png");
    console.log("question: OK");

    // 3. Show answer, grade Good
    await page.getByRole("button", { name: "Voir la réponse" }).click();
    await page.getByRole("button", { name: /Bon/ }).click();
    await page.waitForSelector("text=Session terminée");
    await ss(page, "/tmp/quiz-smoke-done.png");
    console.log("smoke: PASS — screenshots in /tmp/quiz-smoke-*.png");
  });

} else {
  console.error(`Unknown command: ${cmd}. Use: smoke | screenshot <path> | review <path>`);
  process.exit(1);
}
