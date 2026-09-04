import { cleanup, render, screen } from "@testing-library/react";
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

  it("marks a suspended question as inactive without offering card-level suspension", () => {
    const { container } = renderQuestionCard({
      q: { ...baseQuestion, suspended: true }
    });

    expect(
      screen.queryByRole("button", { name: /reprendre|suspendre/i })
    ).not.toBeInTheDocument();
    expect(container.firstChild).toHaveStyle({ opacity: "0.55" });
  });
});
