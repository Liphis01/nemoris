# Quiz App Architecture

## Project Goal

This project is a personal knowledge/review application inspired by:
- spaced repetition systems
- spreadsheet-based knowledge management
- Obsidian-like exploration

The app must support:
- fast reviewing
- fast editing
- visual exploration of knowledge
- grouped learning (maps, timelines, etc.)

The user must be able to:
- review efficiently
- browse knowledge quickly
- edit questions inline
- visually inspect grouped content

The Manage UI is intended to progressively evolve toward:
- Obsidian/Figma-like knowledge management
- split panels
- embedded editors
- fast navigation
- spreadsheet-level editing speed

---

# Tech Stack

Frontend:
- React
- Vite

Backend:
- FastAPI
- SQLAlchemy

---

# Core Principles

## Questions are ALWAYS atomic

A Question represents ONE reviewable item.

Examples:
- one country
- one capital
- one map zone
- one timeline event

Grouped reviews are generated dynamically at runtime.

---

# Database Model

Every Question has:

- question
- answer
- type_q
- media
- tags
- group_id
- data

Optional fields MAY exist if useful.

---

# Question Types

## text

Standard question/answer review.

Examples:
- capital cities
- vocabulary
- history facts

## map

A single map zone.

A map review session groups multiple map questions sharing the same group_id.

There is NEVER a "map_group" database question type.

"map_group" may only exist as a temporary frontend runtime aggregation object if absolutely necessary.

---

# Group System

Questions sharing a group_id belong to the same visual/grouped review.

Examples:
- countries on same SVG map
- timeline events
- anatomy diagrams

Groups are runtime organizational structures.

Questions remain independent review items.

Each question has independent progress.

---

# Progress Rules

Progress is ALWAYS attached to individual questions.

Map zones must have independent spaced repetition progress.

Grouped reviews are only UI/runtime aggregation.

---

# Media Rules

media replaces old "fichier" field.

media may contain:
- image path
- svg filename
- audio file
- video file

Do NOT reintroduce "fichier".

---

# Map Rules

Map-specific data belongs in:
- Question.data

Examples:
- SVG code (unique identifier for map zones)
- aliases
- extra metadata

Avoid multiplying dedicated SQL columns unless necessary.

Preferred structure:

```json
data = {
  "code": "dep_75",
  "aliases": ["paris", "paris city"]
}
```
---

# Frontend Architecture

Keep components focused and small.

Avoid giant files.

Preferred structure:

components/
  manage/
  quiz/

---

# Manage UI Philosophy

Manage is BOTH:
- a spreadsheet
- a knowledge browser

The user must be able to:
- inspect information instantly
- edit quickly
- navigate visually

The UI should progressively evolve toward:
- split panels
- embedded editors
- keyboard-friendly workflows
- graph-like exploration

NOT toward:
- complex forms
- modal-heavy workflows
- admin-dashboard style UI

---

# Important Constraints

## Do NOT invent new question models

Do NOT create:
- duplicate structures
- parallel APIs
- temporary database models

---

# Refactor Rules

Prefer:
- minimal changes
- preserving behavior
- incremental refactors

Avoid:
- massive rewrites
- unrelated changes
- hidden feature additions

---

# Backend Rules

Prefer:
- joinedload
- minimizing SQL queries
- serializers
- explicit runtime aggregation

Avoid:
- N+1 queries
- duplicated review logic

---

# Frontend Rules

Prefer:
- reusable components
- local state clarity
- embedded panels
- inline editing

Avoid:
- deeply nested props
- giant stateful components
- duplicated rendering logic

---

# Review Endpoint Rules

/review is responsible for:
- filtering
- due question selection
- runtime grouping

The database stores atomic questions only.

---

# Naming Conventions

Use:
- media
- group_id
- data

Avoid old names:
- fichier
- map_group database type

---

# Expected Coding Style

- explicit
- readable
- minimal magic
- low abstraction unless justified

Favor maintainability over cleverness.

---

# Running the app

To run the app you can use the provided .sh file:

```bash
./start.sh
```

# Before Refactoring

Always:
1. explain the plan first
2. preserve behavior
3. minimize changes
4. avoid introducing new concepts unless requested