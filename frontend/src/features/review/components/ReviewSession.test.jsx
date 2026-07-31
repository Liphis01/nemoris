import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReviewSession from "./ReviewSession";

const baseProps = {
  setMode: vi.fn(),
  showAnswer: false,
  setShowAnswer: vi.fn(),
  handleTextAnswer: vi.fn(),
  currentTextQuality: null,
  selectedTextQuality: null,
  handleMapComplete: vi.fn(),
  handleImageComplete: vi.fn(),
  handleTimelineComplete: vi.fn(),
  handleSequenceComplete: vi.fn(),
  canReturnToLastQuestion: false,
  returnToLastQuestion: vi.fn(),
  sessionComplete: false,
  skipToSessionEnd: vi.fn(),
  reviewLoading: false,
  reviewError: "",
  submitMapAnswer: vi.fn(),
  submitMediaAnswer: vi.fn(),
  submitTimelineAnswer: vi.fn(),
  submitSequenceAnswer: vi.fn()
};

function renderReviewSession(props = {}) {
  return render(
    <ReviewSession
      {...baseProps}
      {...props}
    />
  );
}

describe("ReviewSession", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses the compact visual shell for active image review", () => {
    const { container } = renderReviewSession({
      questions: [
        {
          type_q: "media",
          name: "Flags",
          mode: "type_prompt",
          tags: ["Geo"],
          items: [
            {
              question_id: 1,
              answer: "France",
              label: "France",
              media: "/static/france.png"
            }
          ]
        }
      ],
      currentIndex: 0
    });
    const shell = container.querySelector("[data-visual-session-shell]");
    const bar = container.querySelector("[data-visual-session-bar]");
    const actions = container.querySelector("[data-visual-session-actions]");
    const status = container.querySelector("[data-visual-session-status]");
    const renderer = container.querySelector("[data-visual-renderer]");

    expect(shell).toHaveStyle({
      height: "100%",
      overflow: "hidden"
    });
    expect(bar).toHaveStyle({
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 520px) minmax(0, 1fr)",
      minHeight: "72px"
    });
    expect(renderer).toHaveStyle({
      overflow: "hidden",
      minHeight: "0"
    });
    expect(renderer.style.flex).toBe("1 1 0%");
    expect(actions).toContainElement(screen.getByRole("button", { name: /Retour/ }));
    expect(status).toHaveTextContent("Révision");
    expect(status).toHaveTextContent("Question 1 / 1");
    expect(status).not.toHaveTextContent("Flags");
    expect(shell).toHaveTextContent("Flags");
    expect(status).toHaveTextContent("#Geo");
    expect(bar).not.toHaveTextContent("Image");
    expect(screen.queryByRole("heading", { name: "Révision" }))
      .not.toBeInTheDocument();
  });

  it("keeps the existing layout for active text review", () => {
    const { container } = renderReviewSession({
      questions: [
        {
          id: 1,
          type_q: "text",
          question: "Capital?",
          answer: "Paris"
        }
      ],
      currentIndex: 0
    });

    expect(container.querySelector("[data-visual-session-shell]"))
      .not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Révision" }))
      .toBeInTheDocument();
    expect(screen.getByText("Question 1 / 1")).toBeInTheDocument();
  });

  it("marks a re-queued text question as relearning", () => {
    const { container } = renderReviewSession({
      questions: [
        {
          id: 1,
          type_q: "text",
          question: "Capital?",
          answer: "Paris",
          _reviewRetryOfIndex: 0
        }
      ],
      currentIndex: 0
    });

    expect(container.querySelector("[data-relearning-badge]"))
      .toBeInTheDocument();
    expect(screen.getByText("Réapprentissage")).toBeInTheDocument();
  });

  it("does not mark a question being seen for the first time", () => {
    const { container } = renderReviewSession({
      questions: [
        {
          id: 1,
          type_q: "text",
          question: "Capital?",
          answer: "Paris"
        }
      ],
      currentIndex: 0
    });

    expect(container.querySelector("[data-relearning-badge]"))
      .not.toBeInTheDocument();
  });

  it("marks a re-queued visual question and replaces the session kicker", () => {
    // The retry of a failed bonus group is the first answer of the session, so
    // its retry index is 0 -- the badge must not be hidden by a falsy check.
    const { container } = renderReviewSession({
      questions: [
        {
          type_q: "media",
          name: "Flags",
          mode: "type_prompt",
          tags: [],
          items: [
            {
              question_id: 1,
              answer: "France",
              label: "France",
              media: "/static/france.png"
            }
          ],
          _reviewRetryOfIndex: 0
        }
      ],
      currentIndex: 0,
      bonusReviewActive: true
    });
    const status = container.querySelector("[data-visual-session-status]");

    expect(status).toContainElement(
      container.querySelector("[data-relearning-badge]")
    );
    expect(status).toHaveTextContent("Réapprentissage");
    expect(status).not.toHaveTextContent("Bonus");
  });

  it("keeps the total at the base count when retries are queued", () => {
    // Two questions were failed and re-queued, so the array holds four items,
    // but the user should still read the session as two questions.
    const { container } = renderReviewSession({
      questions: [
        { id: 1, type_q: "text", question: "Q1", answer: "A1" },
        { id: 2, type_q: "text", question: "Q2", answer: "A2" },
        { id: 1, type_q: "text", question: "Q1", answer: "A1", _reviewRetryOfIndex: 0 },
        { id: 2, type_q: "text", question: "Q2", answer: "A2", _reviewRetryOfIndex: 1 }
      ],
      currentIndex: 0
    });

    expect(screen.getByText("Question 1 / 2")).toBeInTheDocument();
    expect(screen.queryByText(/\/ 4/)).not.toBeInTheDocument();
    // The two failed questions are surfaced apart from the total.
    expect(container.querySelector("[data-relearning-count]"))
      .toHaveTextContent("2 à revoir");
    expect(container.querySelector("[data-relearning-badge]"))
      .not.toBeInTheDocument();
  });

  it("rests the counter on the total while relearning and counts down retries", () => {
    const { container } = renderReviewSession({
      questions: [
        { id: 1, type_q: "text", question: "Q1", answer: "A1" },
        { id: 2, type_q: "text", question: "Q2", answer: "A2" },
        { id: 1, type_q: "text", question: "Q1", answer: "A1", _reviewRetryOfIndex: 0 },
        { id: 2, type_q: "text", question: "Q2", answer: "A2", _reviewRetryOfIndex: 1 }
      ],
      currentIndex: 2
    });

    // On the first retry: both base questions are behind, one retry still
    // waiting after this one (the current one is marked by the badge, not the
    // count).
    expect(screen.getByText("Question 2 / 2")).toBeInTheDocument();
    expect(container.querySelector("[data-relearning-count]"))
      .toHaveTextContent("1 à revoir");
    expect(container.querySelector("[data-relearning-badge]"))
      .toBeInTheDocument();
  });

  it("drops the count on the last retry, leaving only the badge", () => {
    const { container } = renderReviewSession({
      questions: [
        { id: 1, type_q: "text", question: "Q1", answer: "A1" },
        { id: 1, type_q: "text", question: "Q1", answer: "A1", _reviewRetryOfIndex: 0 }
      ],
      currentIndex: 1
    });

    expect(screen.getByText("Question 1 / 1")).toBeInTheDocument();
    expect(container.querySelector("[data-relearning-count]"))
      .not.toBeInTheDocument();
    expect(container.querySelector("[data-relearning-badge]"))
      .toBeInTheDocument();
  });

  it("shows no relearning count when nothing has been failed", () => {
    const { container } = renderReviewSession({
      questions: [
        { id: 1, type_q: "text", question: "Q1", answer: "A1" },
        { id: 2, type_q: "text", question: "Q2", answer: "A2" }
      ],
      currentIndex: 0
    });

    expect(screen.getByText("Question 1 / 2")).toBeInTheDocument();
    expect(container.querySelector("[data-relearning-count]"))
      .not.toBeInTheDocument();
  });

  it("shows the end-of-session panel once the session is complete", () => {
    renderReviewSession({
      questions: [],
      currentIndex: 0,
      sessionComplete: true
    });

    expect(
      screen.getByRole("heading", { name: "Session terminée" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retour au menu" })
    ).toBeInTheDocument();
  });

  it("keeps the revise-last-answer action reachable once the session ends", () => {
    const returnToLastQuestion = vi.fn();
    renderReviewSession({
      questions: [],
      currentIndex: 0,
      sessionComplete: true,
      canReturnToLastQuestion: true,
      returnToLastQuestion
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Modifier la dernière réponse" })
    );

    expect(returnToLastQuestion).toHaveBeenCalled();
  });

  it("offers an early exit once only relearning questions remain", () => {
    const skipToSessionEnd = vi.fn();
    renderReviewSession({
      questions: [
        {
          question_id: 4,
          type_q: "text",
          question: "Retry",
          answer: "Answer",
          _reviewRetryOfIndex: 0
        }
      ],
      currentIndex: 0,
      skipToSessionEnd
    });

    fireEvent.click(screen.getByRole("button", { name: "Terminer →" }));

    expect(skipToSessionEnd).toHaveBeenCalled();
  });

  it("hides the early exit while any question ahead is still fresh", () => {
    renderReviewSession({
      questions: [
        {
          question_id: 4,
          type_q: "text",
          question: "Retry",
          answer: "Answer",
          _reviewRetryOfIndex: 0
        },
        {
          question_id: 5,
          type_q: "text",
          question: "Fresh",
          answer: "Answer"
        }
      ],
      currentIndex: 0
    });

    expect(
      screen.queryByRole("button", { name: "Terminer →" })
    ).not.toBeInTheDocument();
  });
});
