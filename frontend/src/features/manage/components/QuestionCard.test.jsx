import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuestionCard from "./QuestionCard";

const baseQuestion = {
  id: 1,
  type_q: "text",
  question: "Formule \\(E = mc^2\\)",
  answer: "$$a^2 + b^2 = c^2$$",
  tags: [],
  data: {},
  progress: null
};

function renderQuestionCard(props = {}) {
  return render(
    <QuestionCard
      q={baseQuestion}
      selected={false}
      onClick={vi.fn()}
      deleteOpen={false}
      isRemoving={false}
      isHighlighted={false}
      onDeleteOpen={vi.fn()}
      closeDelete={vi.fn()}
      deleteQuestion={vi.fn()}
      onToggleFavorite={vi.fn()}
      onToggleSuspended={vi.fn()}
      {...props}
    />
  );
}

describe("QuestionCard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders LaTeX in Manage question list snippets", () => {
    const { container } = renderQuestionCard();

    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".katex-display")).not.toBeInTheDocument();
  });

  it("offers a suspend control that reports the intended new state", () => {
    const onToggleSuspended = vi.fn();
    renderQuestionCard({ onToggleSuspended });

    fireEvent.click(
      screen.getByRole("button", { name: "Suspendre la question" })
    );

    expect(onToggleSuspended).toHaveBeenCalledTimes(1);
  });

  it("marks a suspended question as inactive and offers to resume it", () => {
    const { container } = renderQuestionCard({
      q: { ...baseQuestion, suspended: true }
    });

    expect(
      screen.getByRole("button", { name: "Reprendre la question" })
    ).toBeInTheDocument();
    expect(container.firstChild).toHaveStyle({ opacity: "0.55" });
  });
});
