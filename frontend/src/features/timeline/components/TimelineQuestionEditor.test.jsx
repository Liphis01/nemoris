import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TimelineQuestionEditor from "./TimelineQuestionEditor";

function draftWith(timeline) {
  return {
    question: "Évènement",
    tags: [],
    data: {
      timeline: timeline || {
        kind: "point",
        start: { year: 1789, month: null, day: null, precision: "year" }
      }
    }
  };
}

// The editor is fully controlled: it hands a new draft to onChange and expects it
// back as `draft`. This harness closes that loop and records every emitted draft.
function renderEditor(initial = draftWith()) {
  const drafts = [];

  function Harness() {
    const [draft, setDraft] = useState(initial);

    return (
      <TimelineQuestionEditor
        draft={draft}
        heading="Nouvelle question"
        onChange={(next) => {
          drafts.push(next);
          setDraft(next);
        }}
        onSubmit={vi.fn()}
      />
    );
  }

  render(<Harness />);

  return {
    drafts,
    lastTimeline: () => drafts[drafts.length - 1].data.timeline,
    lastDraft: () => drafts[drafts.length - 1]
  };
}

describe("TimelineQuestionEditor", () => {
  afterEach(cleanup);

  it("pre-fills the date field from an existing question, era-free", () => {
    renderEditor(
      draftWith({
        kind: "point",
        start: { year: 1789, month: 7, day: 14, precision: "day" }
      })
    );

    expect(screen.getByLabelText("Date")).toHaveValue("14/07/1789");
  });

  it("infers year precision from a bare year", () => {
    const editor = renderEditor();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "1492" } });

    expect(editor.lastTimeline().kind).toBe("point");
    expect(editor.lastTimeline().start.precision).toBe("year");
    expect(editor.lastTimeline().start.year).toBe(1492);
  });

  it("infers day precision from a d/m/y date", () => {
    const editor = renderEditor();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "06/06/1944" } });

    const timeline = editor.lastTimeline();

    expect(timeline.start.precision).toBe("day");
    expect(timeline.start.day).toBe(6);
    expect(timeline.start.month).toBe(6);
    expect(timeline.start.year).toBe(1944);
  });

  it("infers an interval from a dashed range", () => {
    const editor = renderEditor();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "1914-1918" } });

    const timeline = editor.lastTimeline();

    expect(timeline.kind).toBe("interval");
    expect(timeline.start.year).toBe(1914);
    expect(timeline.end.year).toBe(1918);
  });

  it("flips the year to BC via the era toggle and regenerates the answer", () => {
    const editor = renderEditor(
      draftWith({
        kind: "point",
        start: { year: 44, month: null, day: null, precision: "year" }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Basculer l'ère/ }));

    expect(editor.lastTimeline().start.year).toBe(-44);
    expect(editor.lastDraft().answer).toBe("44 av. J.-C.");
  });

  it("keeps the era across an edit: BC magnitude stays BC when retyped", () => {
    const editor = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /Basculer l'ère/ }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "44" } });

    expect(editor.lastTimeline().start.year).toBe(-44);
  });

  it("honours an explicit av. J.-C. typed in the field", () => {
    const editor = renderEditor();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "44 av. J.-C." } });

    expect(editor.lastTimeline().start.year).toBe(-44);
  });

  it("shows an error for an unparseable date on blur", () => {
    renderEditor();

    const input = screen.getByLabelText("Date");
    fireEvent.change(input, { target: { value: "pas une date" } });
    fireEvent.blur(input);

    expect(screen.getByText("Format de date invalide")).toBeInTheDocument();
  });

  it("emits the save-payload shape the backend expects", () => {
    const editor = renderEditor();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "1515" } });

    const draft = editor.lastDraft();

    expect(draft.type_q).toBe("timeline");
    expect(draft.group_id).toBeNull();
    expect(draft.answer).toBe("1515");
    expect(draft.data.timeline.start.year).toBe(1515);
  });
});
