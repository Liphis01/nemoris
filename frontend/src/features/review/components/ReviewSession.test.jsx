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
  canReturnToLastQuestion: false,
  returnToLastQuestion: vi.fn(),
  canSkipCurrentQuestion: false,
  skipCurrentQuestion: vi.fn(),
  canReturnToLastSkippedQuestion: false,
  returnToLastSkippedQuestion: vi.fn(),
  skippedQuestionCount: 0,
  canStartBonusReview: false,
  startBonusReview: vi.fn(),
  bonusReviewMessage: "",
  bonusReviewStatus: null,
  bonusReviewLoading: false,
  bonusStatusLoading: false,
  reviewLoading: false,
  reviewError: "",
  submitMapAnswer: vi.fn(),
  submitImageAnswer: vi.fn(),
  submitTimelineAnswer: vi.fn()
};

function renderReviewSession(props = {}) {
  return render(
    <ReviewSession
      {...baseProps}
      {...props}
    />
  );
}

function renderFinishedReview() {
  return renderReviewSession({
    questions: [
      {
        question_id: 1,
        type_q: "text",
        question: "Question",
        answer: "Answer"
      }
    ],
    currentIndex: 1
  });
}

describe("ReviewSession", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a clear empty review panel with bonus review action", () => {
    const startBonusReview = vi.fn();
    const { container } = renderReviewSession({
      questions: [],
      currentIndex: 0,
      canStartBonusReview: true,
      startBonusReview,
      bonusReviewMessage: "Le planning est léger.",
      bonusReviewStatus: { allowed: true, state: "low" }
    });

    const panel = container.querySelector("[data-review-outcome='empty']");

    expect(panel).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Aucune question pour aujourd’hui" }))
      .toBeInTheDocument();
    expect(screen.getByText("Planning à jour")).toBeInTheDocument();
    expect(screen.getByText("0 question à revoir")).toBeInTheDocument();
    expect(screen.getByText("Bonus disponible")).toBeInTheDocument();
    expect(screen.getByText("Le planning est léger.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Faire des questions bonus" }))
      .toBeInTheDocument();
  });

  it("shows a full schedule message without a bonus action", () => {
    renderReviewSession({
      questions: [],
      currentIndex: 0,
      bonusReviewMessage: "Le planning est déjà rempli.",
      bonusReviewStatus: { allowed: false, state: "full" }
    });

    expect(screen.getByText("Planning plein")).toBeInTheDocument();
    expect(screen.getByText("Le planning est déjà rempli.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Faire des questions bonus" }))
      .not.toBeInTheDocument();
  });

  it("shows a polished finish panel without daily habit content", () => {
    renderFinishedReview();

    expect(screen.getByText("Session terminée")).toBeInTheDocument();
    expect(screen.getByText("Toutes les questions ont été révisées.")).toBeInTheDocument();
    expect(screen.getByText("Journée bouclée")).toBeInTheDocument();
    expect(screen.getByText("1 question revue")).toBeInTheDocument();
  });

  it("uses the compact visual shell for active image review", () => {
    const { container } = renderReviewSession({
      questions: [
        {
          type_q: "image",
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
      height: "calc(100dvh - 48px)",
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

  it("shows bonus skip controls in text review", () => {
    const skipCurrentQuestion = vi.fn();
    const returnToLastSkippedQuestion = vi.fn();
    renderReviewSession({
      questions: [
        {
          id: 1,
          type_q: "text",
          question: "Capital?",
          answer: "Paris"
        },
        {
          id: 2,
          type_q: "text",
          question: "Country?",
          answer: "France"
        }
      ],
      currentIndex: 0,
      canSkipCurrentQuestion: true,
      skipCurrentQuestion,
      canReturnToLastSkippedQuestion: true,
      returnToLastSkippedQuestion,
      skippedQuestionCount: 2
    });

    fireEvent.click(screen.getByRole("button", { name: "Mettre cette question de côté sans la noter" }));
    fireEvent.click(screen.getByRole("button", { name: "Reprendre la dernière question mise de côté" }));

    expect(skipCurrentQuestion).toHaveBeenCalledTimes(1);
    expect(returnToLastSkippedQuestion).toHaveBeenCalledTimes(1);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows bonus skip controls in compact visual review", () => {
    renderReviewSession({
      questions: [
        {
          type_q: "timeline",
          name: "Dates",
          items: [
            {
              question_id: 1,
              answer: "1900",
              timeline: {
                kind: "point",
                start: { year: 1900 },
                precision: "year"
              }
            }
          ]
        },
        {
          type_q: "text",
          question: "Capital?",
          answer: "Paris"
        }
      ],
      currentIndex: 0,
      canSkipCurrentQuestion: true,
      canReturnToLastSkippedQuestion: true,
      skippedQuestionCount: 1
    });

    expect(screen.getByRole("button", { name: "Mettre cette question de côté sans la noter" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reprendre la dernière question mise de côté" }))
      .toBeInTheDocument();
  });
});
