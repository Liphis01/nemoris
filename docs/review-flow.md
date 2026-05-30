# Review Flow

## Purpose

The review system is responsible for:
- selecting due questions
- grouping related questions dynamically
- returning frontend-ready review objects
- preserving independent spaced repetition progress

The review system must remain:
- predictable
- scalable
- database-efficient

---

# Core Principle

The database stores ONLY atomic questions.

The `/review` endpoint dynamically aggregates grouped review sessions.

Examples:
- map reviews
- future timeline reviews
- future diagram reviews

Grouping exists ONLY at runtime.

---

# Review Lifecycle

## Step 1 — Load Due Questions

The backend selects:
- questions with due progress
- OR questions with no progress yet

Example logic:

```python
or_(
    Progress.id == None,
    Progress.next_review == None,
    Progress.next_review <= today
)
```

This ensures:

- new questions appear immediately
- due questions are reviewed
- forgotten questions resurface

## Step 2 — Group Runtime Objects

Grouped question types are aggregated dynamically.

Example:

- all map zones sharing the same group_id
- grouped into one runtime review item

Example runtime object:

```json
{
  "type_q": "map",
  "group_id": 12,
  "media": "europe.svg",
  "items": [...]
}
```

This object is NOT stored in database.

## Step 3 — Return Frontend Review Items

The frontend receives a mixed review queue:

```json
[
  { "type_q": "text" },
  { "type_q": "text" },
  { "type_q": "map" }
]
```

Each item is frontend-renderable.

# Review Object Types

Text Question

```json
{
  "id": 42,
  "question": "Capital of Japan",
  "answer": "Tokyo",
  "type_q": "text"
}
```

# Map Group Runtime Object

```json
{
  "type_q": "map",
  "group_id": 5,
  "media": "europe.svg",
  "items": [
    {
      "id": 1,
      "question": "France",
      "data": {
        "code": "fr"
      }
    }
  ]
}
```

# Important Distinction

## Database Question

Persistent atomic object.

Contains:

- one progress
- one memory item
- one reviewable unit

## Runtime Group Object

Temporary UI/review structure.

Contains:

- multiple atomic questions
- frontend rendering info

Never persisted.

# Progress System

Progress is ALWAYS attached to atomic questions.

Example:

Question	Progress
France	due
Germany	mature
Italy	learning

Even when reviewed together.

# Sending Answers

## Text Questions

Frontend sends:

```json
{
  "question_id": 42,
  "quality": 2
}
```

## Map Reviews

Frontend sends per-item results:

```json
{
  "items": {
    "12": 2,
    "13": 1,
    "14": 0
  }
}
```

Each item updates its own progress independently.

# Runtime Aggregation Rules

Aggregation should:

- happen in backend
- remain explicit
- avoid frontend reconstruction complexity

Avoid:

- hidden grouping logic
- duplicated grouping logic in frontend

# SQL Efficiency Rules

Prefer:

- joinedload
- outerjoin
- bulk loading

Avoid:

- N+1 queries
- per-question fetches
- repeated group lookups

# Frontend Responsibilities

Frontend should:

- render review objects
- manage session state
- send answer quality

Frontend should NOT:

- rebuild grouped structures
- infer backend grouping rules

# Future Compatibility

The review flow is designed to support:

- timelines
- image hotspot quizzes
- anatomy diagrams
- audio recognition
- grouped media reviews

All future grouped systems should follow the SAME runtime aggregation pattern.

# Golden Rule

Review grouping is a VIEW concern.

Progress remains atomic forever.
