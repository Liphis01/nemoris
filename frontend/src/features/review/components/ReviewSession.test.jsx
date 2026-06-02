import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReviewSession from "./ReviewSession";

function renderFinishedReview(overrides = {}) {
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
      dailyGroveCompletion={{
        current_streak: 7,
        due_count: 0,
        today_complete: true,
        milestone_reached: null,
        rest_leaves: 1,
        fallen_leaves: 0,
        shield_capacity: 1,
        shield_growth: {
          current: 7,
          target: 7,
          remaining: 0,
          percent: 100,
          next_award_at: 7,
          growing: false
        },
        shield_event: null,
        grove_stage: {
          key: "young_grove",
          label: "Jeune bosquet"
        },
        ...overrides.dailyGroveCompletion
      }}
      dailyGroveCompletionError=""
      dailyGroveCompletionLoading={false}
      reviewLoading={false}
      reviewError=""
      {...overrides.props}
    />
  );
}

describe("ReviewSession plant milestone", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the growth artwork when a milestone was reached", () => {
    renderFinishedReview({
      dailyGroveCompletion: {
        milestone_reached: 7
      }
    });

    expect(
      screen.getByRole("img", {
        name: "Illustration animée de la plante Nemoris"
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText("La plante grandit : floraison des 7 jours")
    ).toBeInTheDocument();
  });

  it("shows the growth artwork when a shield event was returned", () => {
    const { container } = renderFinishedReview({
      dailyGroveCompletion: {
        fallen_leaves: 1,
        rest_leaves: 0,
        shield_event: {
          type: "protected",
          leaves_used: 1,
          leaves_regrown: 0,
          streak_broken: false
        },
        shield_growth: {
          current: 1,
          target: 7,
          remaining: 6,
          percent: 14,
          next_award_at: 14,
          growing: true
        }
      }
    });

    expect(
      screen.getByRole("img", {
        name: "Illustration animée de la plante Nemoris"
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Une feuille de garde a protégé la série")
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".grove-art-fallen-leaf")).toHaveLength(1);
    expect(container.querySelectorAll(".grove-art-regrowing-bud")).toHaveLength(1);
  });

  it("shows shield regrowth alongside a milestone", () => {
    renderFinishedReview({
      dailyGroveCompletion: {
        milestone_reached: 7,
        shield_event: {
          type: "regrown",
          leaves_used: 0,
          leaves_regrown: 1,
          streak_broken: false
        }
      }
    });

    expect(
      screen.getByText("Floraison des 7 jours : une feuille de garde repousse")
    ).toBeInTheDocument();
  });

  it("keeps the normal finish panel compact without a milestone", () => {
    renderFinishedReview();

    expect(
      screen.queryByRole("img", {
        name: "Illustration animée de la plante Nemoris"
      })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/La plante grandit/)).not.toBeInTheDocument();
  });
});
