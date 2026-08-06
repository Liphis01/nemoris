---
name: run-quiz-app
description: Run, screenshot, and drive the Nemoris quiz app (spaced repetition). Use when asked to start, launch, screenshot, verify, or test the app. Also covers the Playwright e2e suite.
---

# Run Nemoris (quiz-app)

**Nemoris** is a React + FastAPI spaced-repetition app. For agent use the driver at `.claude/skills/run-quiz-app/driver.mjs` drives the frontend via Playwright with a fully mocked backend — no real backend required.

## Prerequisites

Playwright browsers must already be installed (they are in this repo):

```bash
ls ~/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome   # should exist
```

If missing: `cd frontend && npx playwright install chromium`

## Build / start the dev server

```bash
cd /home/louis/projects/quiz-app/frontend
npm run dev -- --host 127.0.0.1 --port 5173 &
# Wait ~2 s, then verify:
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/   # → 200
```

The frontend is served at `http://127.0.0.1:5173`. The backend (FastAPI, port 8000) is **not needed** for driver or e2e runs — the driver and the e2e suite both mock all `http://localhost:8000/**` calls.

## Run (agent path) — driver

Run from the **repo root** with the dev server already running:

```bash
node .claude/skills/run-quiz-app/driver.mjs smoke
# → /tmp/quiz-smoke-home.png, /tmp/quiz-smoke-question.png, /tmp/quiz-smoke-done.png
```

Commands:

| command | what it does | screenshot |
|---|---|---|
| `smoke` (default) | home → start review → grade → session done | `/tmp/quiz-smoke-*.png` |
| `screenshot <path>` | just the home page | `<path>` |
| `review <path>` | full text review flow | `<path>` |

Override the base URL: `QUIZ_URL=http://127.0.0.1:5173 node driver.mjs smoke`

The driver imports `frontend/e2e/apiMock.js` to set up mocks — it intercepts `/review/summary`, `/review`, `/answer`, `/review/bonus_status`, and all other backend routes.

## Run (agent path) — Playwright e2e suite

```bash
cd /home/louis/projects/quiz-app/frontend
npx playwright test --reporter=line
# 6 tests, ~8 s, all pass
```

The Playwright config auto-starts the dev server (`npm run dev -- --host 127.0.0.1`), so no separate server step is needed.

## Run (human path)

```bash
cd /home/louis/projects/quiz-app
./start.sh
# Opens http://localhost:5173 in the browser.
# Backend: venv/bin/python -m uvicorn app.main:app --reload (port 8000)
# Frontend: npm run dev (port 5173)
```

## Unit tests

```bash
cd frontend && npm run test:run   # vitest, ~1 s
```

## Gotchas

- **The whole review card is one button, and its accessible name is not the visible "DÉMARRER →" text.** The card has `aria-label={`${reviewTitle}: ...`}` (e.g. "Révision du jour: ..."), which overrides the button's computed name — `getByRole("button", { name: "DÉMARRER" })` matches zero elements and times out. Use `page.getByRole("button", { name: /Révision du jour/ })` (or `getByText("Révision du jour")`, matched on visible text) in custom scripts. This is what `driver.mjs` does.

- **`/review/summary` must return `has_due: true`.** Without it the home page shows "0 À JOUR" and the DÉMARRER button is disabled. The driver's `mockApi(page, { review: reviewFixture })` sets this automatically.

- **`import` from `/tmp/` breaks.** The driver must be run from inside the project tree so Node finds `frontend/node_modules/@playwright/test`. The path is hardcoded relative to `__dirname`; don't copy the driver elsewhere.

- **No `chromium-cli` in PATH.** This project uses `@playwright/test` directly (installed in `frontend/node_modules`). Import from `frontend/node_modules/@playwright/test/index.mjs`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find package '@playwright/test'` | Run from repo root, not `/tmp/` |
| `Cannot find module '...chrome'` | `cd frontend && npx playwright install chromium` |
| `waitForSelector: Timeout` on `text=Voir la réponse` | Check that `mockApi` is called before `page.goto` — it must set `has_due: true` in `/review/summary` |
| Port 5173 already in use | `fuser -k 5173/tcp` then restart dev server |
