# Frontend Layout

## Philosophy

The frontend is designed around two goals:

1. Fast reviewing
2. Fast knowledge inspection/editing

The application should progressively evolve toward:
- Obsidian-like navigation
- Figma-like panels
- spreadsheet-level editing speed

NOT toward:
- admin dashboards
- form-heavy interfaces
- modal-only workflows

---

# Main Application Modes

The frontend currently has:

- Menu
- Review
- Manage

Future modes may exist, but Manage and Review are the architectural core.

---

# Review Mode

Review mode focuses on:
- minimal friction
- fast answering
- keyboard-first interaction

The user should remain focused on memory retrieval.

Avoid:
- unnecessary UI
- excessive animations
- clutter

---

# Manage Mode

Manage mode is BOTH:
- a spreadsheet
- a knowledge browser

The user should be able to:
- inspect information instantly
- edit inline
- navigate quickly
- open contextual panels

---

# Long-Term Manage Vision

Target UX is similar to:
- Obsidian
- Figma
- Notion database views
- IDE side panels

The layout should progressively evolve toward:

```txt
| Sidebar | Table/List | Embedded Editor |
```

# Layout Philosophy
## Left Side

Navigation and filtering.

Examples:

- collections
- tags
- search
- review filters

## Center

Main knowledge table/list.

Purpose:

- overview
- rapid scanning
- inline editing

This replaces spreadsheet workflows.

## Right Side

Embedded contextual editor.

Examples:

- map editor
- tag editor
- future timeline editor

Avoid fullscreen modals whenever possible.

# Component Architecture

Prefer small focused components.

Recommended structure:

components/
  manage/
    ManageLayout.jsx
    QuestionTable.jsx
    QuestionRow.jsx
    Toolbar.jsx
    Sidebar.jsx
    EmbeddedPanel.jsx

  quiz/
    Quiz.jsx
    TextQuestion.jsx
    MapQuestion.jsx
    QuestionRenderer.jsx

  map/
    SvgMap.jsx
    MapEditor.jsx


# State Philosophy

Prefer:

- localized state
- explicit props
- predictable flows

Avoid:

- giant global state
- deeply nested prop chains
- duplicated derived state

# Inline Editing

Inline editing is preferred whenever possible.

Good:

- direct table editing
- instant visual feedback
- keyboard-friendly flows

Bad:

- opening forms for every small edit
- excessive confirmation dialogs

# Embedded Editors

Complex content editors should appear as embedded side panels.

Examples:

- map zone editor
- timeline editor
- image hotspot editor

Advantages:

- maintains context
- fast navigation
- less disruptive

# Table Philosophy

The question table is critical.

It must support:

- rapid scanning
- rapid editing
- future virtualization
- future grouping

The user should be able to:

- visually inspect knowledge quickly
- find forgotten information instantly

# Runtime Group Display

Grouped review types should remain visually understandable.

Example:

- map groups appear as expandable entities
- opening a map should reveal zones
- zones remain individually editable

Avoid:

- flattening grouped content too aggressively
- hiding atomic structure

# Keyboard UX

Keyboard workflows are extremely important.

Priority shortcuts:

- Enter
- Escape
- arrows
- quick editing
- fast navigation

The app should eventually feel closer to:

- a creative tool
- a knowledge IDE

than a CRUD admin panel.

# Visual Philosophy

Preferred:

- dense information
- clean hierarchy
- subtle colors
- dark mode first
- fast interactions

Avoid:

- oversized cards
- excessive whitespace
- mobile-first admin layouts

# Modals

Modals should remain limited.

Use modals ONLY when:

- context switching is acceptable
- temporary isolation is useful

Prefer embedded panels instead.

# Future Features

The architecture should remain compatible with:

- graph navigation
- backlinks
- relation visualization
- split-screen editing
- pinned panels
- history navigation
- multi-selection editing

# Important Rule

Manage mode is NOT merely an admin interface.

It is the primary knowledge exploration environment.