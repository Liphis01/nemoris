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
  canStartBonusReview: false,
  startBonusReview: vi.fn(),
  bonusReviewActive: false,
  bonusReviewStatus: null,
  bonusReviewLoading: false,
  bonusStatusLoading: false,
  bonusMenuOpen: false,
  bonusMenuEntries: [],
  selectBonusItem: vi.fn(),
  returnToBonusMenu: vi.fn(),
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
      bonusReviewStatus: { allowed: true }
    });

    const panel = container.querySelector("[data-review-outcome='empty']");

    expect(panel).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Aucune question pour aujourd’hui" }))
      .toBeInTheDocument();
    expect(screen.getByText("Planning à jour")).toBeInTheDocument();
    expect(screen.getByText("0 question à revoir")).toBeInTheDocument();
    expect(screen.getByText("Bonus disponible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Faire des questions bonus" }))
      .toBeInTheDocument();
  });

  it("hides the bonus action when no bonus questions are available", () => {
    renderReviewSession({
      questions: [],
      currentIndex: 0,
      bonusReviewStatus: { allowed: false }
    });

    expect(screen.getByText("Aucun bonus")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Faire des questions bonus" }))
      .not.toBeInTheDocument();
  });

  it("shows the available same-group bonus count at the end", () => {
    renderReviewSession({
      questions: [
        {
          group_id: 12,
          type_q: "media",
          name: "Images",
          items: [{ question_id: 1 }]
        }
      ],
      currentIndex: 1,
      bonusReviewStatus: {
        allowed: true,
        same_group_filter_applied: true,
        same_group_bonus_question_count: 2
      },
      canStartBonusReview: true
    });

    expect(screen.getByText("2 questions bonus")).toBeInTheDocument();
    expect(screen.getByText("Même groupe")).toBeInTheDocument();
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

  it("starts a single bonus question on click but opens a count slider for a group", () => {
    const selectBonusItem = vi.fn();
    const textEntry = {
      key: "q:11",
      label: "Bonus text",
      typeLabel: "Question",
      isContainer: false,
      itemCount: 1,
      tags: ["Geo"]
    };
    const imagesEntry = {
      key: "group:5",
      label: "Bonus images",
      typeLabel: "Images",
      isContainer: true,
      itemCount: 30,
      tags: []
    };
    renderReviewSession({
      questions: [],
      currentIndex: 0,
      bonusReviewActive: true,
      bonusMenuOpen: true,
      bonusMenuEntries: [textEntry, imagesEntry],
      selectBonusItem
    });

    expect(screen.getByRole("heading", { name: "Choisis une question à réviser" }))
      .toBeInTheDocument();
    expect(screen.getByText("Bonus text")).toBeInTheDocument();
    expect(screen.getByText("Bonus images")).toBeInTheDocument();

    // A single loose question has nothing to choose — it starts on click.
    fireEvent.click(screen.getByRole("button", { name: /Bonus text/ }));
    expect(selectBonusItem).toHaveBeenCalledWith(textEntry);
    selectBonusItem.mockClear();

    // A multi-question group opens a slider instead of starting immediately.
    fireEvent.click(screen.getByRole("button", { name: /Bonus images/ }));
    expect(selectBonusItem).not.toHaveBeenCalled();

    const slider = screen.getByRole("slider", { name: /Bonus images/ });
    expect(slider).toHaveAttribute("min", "1");
    expect(slider).toHaveAttribute("max", "30");
    // Default is min(20, available).
    expect(screen.getByText("20 questions bonus")).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: "5" } });
    expect(screen.getByText("5 questions bonus")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Commencer/ }));
    expect(selectBonusItem).toHaveBeenCalledWith(imagesEntry, 5);
  });

  it("shows a completion state when no bonus items remain", () => {
    renderReviewSession({
      questions: [],
      currentIndex: 0,
      bonusReviewActive: true,
      bonusMenuOpen: true,
      bonusMenuEntries: []
    });

    expect(screen.getByRole("heading", { name: "Bonus terminés" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retour au menu" }))
      .toBeInTheDocument();
  });

  it("shows a return-to-bonus-menu button during an active bonus item", () => {
    const returnToBonusMenu = vi.fn();
    renderReviewSession({
      questions: [
        {
          id: 1,
          type_q: "text",
          question: "Capital?",
          answer: "Paris"
        }
      ],
      currentIndex: 0,
      bonusReviewActive: true,
      returnToBonusMenu
    });

    fireEvent.click(screen.getByRole("button", { name: "← Menu bonus" }));

    expect(returnToBonusMenu).toHaveBeenCalledTimes(1);
  });

  it("shows a return-to-bonus-menu button in compact visual review", () => {
    const returnToBonusMenu = vi.fn();
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
        }
      ],
      currentIndex: 0,
      bonusReviewActive: true,
      returnToBonusMenu
    });

    fireEvent.click(screen.getByRole("button", { name: "← Menu bonus" }));

    expect(returnToBonusMenu).toHaveBeenCalledTimes(1);
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
});
