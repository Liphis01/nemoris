import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReviewCalendar from "./ReviewCalendar";


function reviewedQuestion(history) {
  return {
    id: 1,
    type_q: "text",
    question: "Capital of France?",
    answer: "Paris",
    tags: [],
    progress: {
      reps: history.length,
      lapses: history.filter((entry) => Number(entry.quality) === 0).length,
      interval: 3,
      last_review: "2026-01-01",
      next_review: "2026-01-04",
      history
    }
  };
}


function reviewedGroupQuestion(id, history) {
  return {
    id,
    type_q: "map",
    question: `Zone ${id}`,
    answer: id === 1 ? "Allier" : "Alpes",
    group_id: 10,
    group: {
      id: 10,
      type_group: "map",
      name: "Départements français",
      tags: []
    },
    tags: [],
    data: { code: `0${id}` },
    progress: {
      reps: history.length,
      lapses: history.filter((entry) => Number(entry.quality) === 0).length,
      interval: 3,
      last_review: "2026-01-01",
      next_review: "2026-01-04",
      history
    }
  };
}


describe("ReviewCalendar", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a same-day failed retry marked as failed in the calendar card", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12));

    render(
      <ReviewCalendar
        setMode={vi.fn()}
        questions={[
          reviewedQuestion([
            { reviewed_on: "2026-01-01", quality: 0 },
            { reviewed_on: "2026-01-01", quality: 2 }
          ])
        ]}
      />
    );

    expect(screen.getByText("Faux")).toBeInTheDocument();
    expect(screen.queryByText("Bon")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Capital of France?"));

    expect(screen.getByText("50% (2)")).toBeInTheDocument();
  });

  it("opens Study from a grouped calendar card", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12));
    const onOpenStudy = vi.fn();

    render(
      <ReviewCalendar
        setMode={vi.fn()}
        questions={[
          reviewedGroupQuestion(1, [
            { reviewed_on: "2026-01-01", quality: 2 }
          ]),
          reviewedGroupQuestion(2, [
            { reviewed_on: "2026-01-01", quality: 1 }
          ])
        ]}
        onOpenStudy={onOpenStudy}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Étudier" }));

    expect(onOpenStudy).toHaveBeenCalledWith(expect.objectContaining({
      id: 10,
      name: "Départements français",
      type: "group",
      type_group: "map"
    }));
  }, 10000);
});
