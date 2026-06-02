import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReviewSession from "./ReviewSession";

function renderFinishedReview() {
  return render(
    <ReviewSession
      setMode={vi.fn()}
      questions={[
        {
          question_id: 1,
          type_q: "text",
          question: "Question",
          answer: "Answer"
        }
      ]}
      currentIndex={1}
      showAnswer={false}
      setShowAnswer={vi.fn()}
      handleTextAnswer={vi.fn()}
      currentTextQuality={null}
      selectedTextQuality={null}
      handleMapComplete={vi.fn()}
      handleImageComplete={vi.fn()}
      handleTimelineComplete={vi.fn()}
      canReturnToLastQuestion={false}
      returnToLastQuestion={vi.fn()}
      canStartBonusReview={false}
      startBonusReview={vi.fn()}
      bonusReviewLoading={false}
      reviewLoading={false}
      reviewError=""
    />
  );
}

describe("ReviewSession finish panel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the normal finish panel without daily habit content", () => {
    renderFinishedReview();

    expect(screen.getByText("Session terminée")).toBeInTheDocument();
    expect(screen.getByText("Toutes les questions ont été révisées.")).toBeInTheDocument();
  });
});
