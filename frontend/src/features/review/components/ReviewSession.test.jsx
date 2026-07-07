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
  canStartBonusReview: false,
  startBonusReview: vi.fn(),
  bonusReviewActive: false,
  bonusReviewMessage: "",
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

  it("shows the available same-group bonus count at the end", () => {
    renderReviewSession({
      questions: [
        {
          group_id: 12,
          type_q: "image",
          name: "Images",
          items: [{ question_id: 1 }]
        }
      ],
      currentIndex: 1,
      bonusReviewMessage: "Tu peux ajouter quelques questions bonus au planning.",
      bonusReviewStatus: {
        allowed: true,
        state: "available",
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

  it("lists remaining bonus items in the menu and selects one", () => {
    const selectBonusItem = vi.fn();
    const textEntry = {
      key: "q:11",
      label: "Bonus text",
      typeLabel: "Question",
      isContainer: false,
      itemCount: 1,
      tags: ["Geo"],
      chunks: [{ question_id: 11, type_q: "text" }]
    };
    const imagesEntry = {
      key: "group:5",
      label: "Bonus images",
      typeLabel: "Images",
      isContainer: true,
      itemCount: 2,
      tags: [],
      chunks: [{ group_id: 5, type_q: "image", items: [] }]
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

    fireEvent.click(screen.getByRole("button", { name: /Bonus images/ }));

    expect(selectBonusItem).toHaveBeenCalledWith(imagesEntry);
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
});
