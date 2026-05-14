# Question Model

## Philosophy

The system is built around ONE central concept:

> A Question is ALWAYS an atomic reviewable item.

A question represents:
- one fact
- one concept
- one location
- one vocabulary word
- one map zone
- one timeline event

Questions are NEVER large grouped structures.

Grouped reviews are generated dynamically at runtime.

---

# Why Atomic Questions?

Atomic questions allow:
- independent spaced repetition
- precise memory tracking
- easier filtering
- reusable group structures
- scalable future question types

Examples:

GOOD:
- "Capital of Japan"
- "Locate Germany"
- "This SVG zone = France"

BAD:
- "Entire Europe map"
- "All countries quiz"
- giant bundled review items

---

# Core Question Fields

Every Question contains:

| Field | Purpose |
|---|---|
| id | unique identifier |
| question | displayed prompt |
| answer | expected answer |
| type_q | question type |
| media | associated media |
| tags | filtering and organization |
| group_id | grouped review membership |
| data | type-specific metadata |

---

# Standard Question Structure

Example:

```json
{
  "id": 42,
  "question": "Capital of Japan",
  "answer": "Tokyo",
  "type_q": "text",
  "media": null,
  "tags": ["geography", "asia"],
  "group_id": null,
  "data": {}
}
```

# type_q

## text

Standard question/answer review.

Examples:

- capitals
- vocabulary
- history
- definitions

## map

A single map zone.

A map review session groups multiple map questions sharing the same group_id.

Example:

```json
{
  "question": "France",
  "answer": "France",
  "type_q": "map",
  "group_id": 12
}
```

# group_id

group_id links related questions together.

Examples:

- same SVG map
- same anatomy diagram
- same timeline
- same image set

Grouping exists for:

- UI
- runtime review aggregation
- visual navigation

Grouping does NOT replace atomic questions.

# Runtime Grouping

The database stores atomic questions only.

Grouped review objects are generated dynamically in /review.

Example runtime structure:

```json
{
  "type_q": "map",
  "group_id": 12,
  "media": "europe.svg",
  "items": [
    {
      "id": 1,
      "question": "France",
      "data": {
        "code": "fr"
      }
    },
    {
      "id": 2,
      "question": "Germany",
      "data": {
        "code": "de"
      }
    }
  ]
}
```

This grouped structure is NOT persisted in the database.

# media Field

media replaces the old "fichier" field.

media may contain:

- image path
- SVG filename
- audio path
- video path

Examples:

```json
"media": "flags/france.png"
```

```json
"media": "europe.svg"
```

# data Field

data stores type-specific metadata.

This avoids multiplying SQL columns.

Examples:

SVG codes
aliases
coordinates
future metadata

Preferred structure:

```json
{
  "code": "dep_75",
  "aliases": ["paris", "paris city"]
}
```

# Why Use data Instead of Dedicated Columns?

Advantages:

- flexible
- extensible
- future-proof
- avoids schema explosion

Useful for:

- maps
- timelines
- image hotspots
- future custom question types

# Map Questions

Map questions are standard Questions with:

```json
"type_q": "map"
```

and map-specific data stored inside:

```json
"data": {
  "code": "fr",
  "aliases": ["france"]
}
```

# Important Rule

There is NO database type called:

map_group

map_group may exist temporarily as a frontend runtime aggregation object only.

It is NEVER stored in the database.

# Progress Model

Progress is ALWAYS attached to individual questions.

Each map zone has independent spaced repetition progress.

This is critical.

Example:

Zone	Progress
France	Mature
Germany	Learning
Italy	Forgotten

Even if they appear together in one map review session.

# Future Question Types

The architecture is designed to support future grouped systems.

Possible future types:

- timeline
- image hotspot
- audio identification
- diagram labeling
- chess positions
- code snippets

These should follow the SAME philosophy:

- atomic questions
- runtime grouping
- type-specific data in data

# Collections

Collections are independent from groups.

Collections are thematic/user organization tools.

Examples:

- "Europe"
- "Exam 2026"
- "Hard questions"

A question may belong to:

- zero collections
- one collection
- multiple collections

Collections do NOT define grouped review behavior.

# Tags

Tags are lightweight filtering tools.

Examples:

- geography
- asia
- capitals
- anatomy

Tags are:

- flexible
- overlapping
- non-structural
- Design Goals

The model prioritizes:

- flexibility
- scalability
- maintainability
- independent review tracking
- runtime composition

Avoid:

- rigid schemas
- duplicated structures
- grouped database objects
- type-specific tables unless truly necessary

# Golden Rule

If a new feature is added, always ask:

"Is this still fundamentally an atomic reviewable item?"

If yes:

- it should probably remain a Question.

If no:

- rethink the architecture before implementing.