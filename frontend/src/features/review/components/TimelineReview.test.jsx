import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TimelineReview from "./TimelineReview";

const timelineItems = [
  {
    question_id: 1,
    question: "Révolution française",
    timeline: {
      kind: "point",
      start: {
        year: 1789,
        month: 7,
        day: 14,
        precision: "day"
      }
    },
    progress: {}
  }
];

describe("TimelineReview", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps the active question and controls while hiding compact helper chrome", () => {
    render(
      <TimelineReview
        fillAvailableHeight
        group={{}}
        reviewItems={timelineItems}
        onComplete={vi.fn()}
        submitAnswer={vi.fn()}
      />
    );

    expect(screen.getByText("Révolution française")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Validate" })).toBeInTheDocument();
    expect(screen.queryByText("TIMELINE")).not.toBeInTheDocument();
    expect(screen.queryByText(/Click the timeline/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Wheel zooms/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Place an answer on the timeline before moving on."))
      .toBeInTheDocument();
  });

  it("renders curated landmark anchors on the canvas", () => {
    render(
      <TimelineReview
        fillAvailableHeight
        group={{}}
        reviewItems={[
          {
            question_id: 9,
            question: "Évènement de 1850",
            timeline: {
              kind: "point",
              start: { year: 1850, month: null, day: null, precision: "year" }
            },
            progress: {}
          }
        ]}
        onComplete={vi.fn()}
        submitAnswer={vi.fn()}
      />
    );

    expect(screen.getByText("Révolution française")).toBeInTheDocument();
  });

  it("never shows a landmark anchor that coincides with a session answer", () => {
    render(
      <TimelineReview
        fillAvailableHeight
        group={{}}
        reviewItems={timelineItems}
        onComplete={vi.fn()}
        submitAnswer={vi.fn()}
      />
    );

    // The only "Révolution française" text is the question title — the
    // coinciding 1789 anchor is filtered out so the answer is never revealed.
    expect(screen.getAllByText("Révolution française")).toHaveLength(1);
  });
});
