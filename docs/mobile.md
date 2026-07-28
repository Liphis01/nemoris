# Mobile Companion Contract

## Product Boundary

The mobile app is a companion for daily review. Desktop remains the full
authoring workspace. Mobile v1 deliberately excludes Manage, pack publishing,
backup import/export, map editing, timeline editing, bonus/new review, and
training.

Mobile v1 supports:

- Android-first private builds through Capacitor.
- Local synced collection state.
- Due review for `text` and `media` questions only.
- Uploaded `/static/...` media cached for offline use.
- External `http(s)://` media as online-only.

## Session Rules

- A review session fixes `session_date` when it starts. Every answer in that
  session uses that date, even if the device crosses midnight.
- Mobile pulls before starting a clean session when online.
- Answers are applied to the local collection immediately and mark the mobile
  collection dirty.
- The app pushes at session end when online.
- If a push conflicts, the phone never discards local review progress silently.
  The conflict UI must offer explicit upload-phone-copy or download-cloud-copy
  actions.

## Local Data Rules

- `questions.db` is the synced collection and must not store mobile-only state.
- Auth tokens, active session state, dirty flags, media-cache status, and sync
  metadata are device-local.
- Supabase access/refresh tokens must use native secure storage. Web fallback
  storage is only for development and tests.
- Mobile review writes both `progress.history` and `review_log` snapshots.
- Integer ids are valid inside a synced whole-DB copy. Public mobile event
  formats should also keep question/group guids where available.

## Scheduling Gate

The backend remains the scheduling source of truth. The mobile scheduler is a
port that must pass backend-generated fixtures before a mobile build is treated
as release-ready. If `ts-fsrs` behavior differs from `py-fsrs`, the mobile
engine must use the app-specific fixture-compatible path instead of accepting
approximate intervals.

