# Quiz App Frontend

React + Vite frontend for the personal knowledge review app. The frontend owns
the interactive review, spreadsheet-like management workspace, map editing, and
timeline editing UI. The FastAPI backend owns persistence, scheduling, grouping,
and serializers.

## Run Locally

Recommended from the project root:

```bash
./start.sh
```

This starts FastAPI on `http://localhost:8000`, Vite on
`http://localhost:5173`, and opens the app.

Frontend only:

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
```

By default, development API calls target `http://localhost:8000`. Override that
with `VITE_API_BASE_URL` when the backend runs elsewhere.

## Scripts

```bash
npm run dev      # Vite dev server on port 5173
npm run build    # Production frontend build in dist/
npm run lint     # ESLint
npm run preview  # Preview a production build
npm run test     # Vitest watch mode for src/**/*.test.*
npm run test:run # Vitest single run
npm run test:e2e # Playwright critical browser flows
```

## Source Layout

- `src/App.jsx` coordinates top-level modes: menu, review, manage, and
  calendar.
- `src/api/` wraps backend endpoints and centralizes API URL handling.
- `src/features/review/` renders backend-prepared review payloads for text,
  map, and timeline questions.
- `src/features/manage/` contains the three-panel library workspace: filters,
  list/cards, and the embedded inspector/editor.
- `src/features/map/` contains SVG map editing and zone helpers.
- `src/features/timeline/` contains timeline editors, previews, and date math.
- `src/features/calendar/` shows review history and links questions back to
  Manage.
- `src/shared/` contains cross-feature UI and data helpers.

## Implementation Notes

- `Question` remains the atomic review item. Runtime grouped review objects may
  be rendered, but they are not persisted as questions.
- Keep backend grouping and serializers authoritative; frontend code should
  render returned shapes instead of rebuilding review grouping rules.
- Preserve the Manage direction as a fast spreadsheet plus knowledge browser:
  left filters/sort, center list/cards, right embedded inspector.
- Keep filtering and sorting logic in dedicated utilities under
  `src/features/manage/utils/`.
- Keep timeline date behavior consistent with
  `backend/app/services/timeline.py`.
- Use `media`, `group_id`, and `data`; do not reintroduce old `fichier`
  naming.

## Related Docs

- `../docs/architecture.md` for product and data-model rules.
- `../docs/review-flow.md` for review payload and scheduling flow.
- `../docs/build.md` for production and portable build instructions.
- `../docs/roadmap.md` for TODOs and longer-term ideas.
