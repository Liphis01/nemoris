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
  bonusReviewActive: false,
  bonusReviewLoading: false,
  bonusStatusLoading: false,
  bonusMenuOpen: false,
  bonusMenuEntries: [],
  selectBonusItem: vi.fn(),
  returnToBonusMenu: vi.fn(),
  skipToBonusMenu: vi.fn(),
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

  it("shows a loading state in the bonus menu while it checks eligibility, with no separate summary screen", () => {
    renderReviewSession({
      questions: [],
      currentIndex: 0,
      bonusMenuOpen: true,
      bonusMenuEntries: [],
      bonusReviewLoading: true
    });

    expect(screen.getByRole("heading", { name: "Recherche de questions bonus" }))
      .toBeInTheDocument();
    // No separate "session over" screen ever renders: the bonus menu shell
    // itself carries the loading state.
    expect(screen.queryByText("Session terminée")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Bonus terminés" }))
      .not.toBeInTheDocument();
  });

  it("falls back to an all-done state once loading finishes with nothing available", () => {
    renderReviewSession({
      questions: [],
      currentIndex: 0,
      bonusMenuOpen: true,
      bonusMenuEntries: [],
      bonusReviewLoading: false,
      bonusStatusLoading: false
    });

    expect(screen.getByRole("heading", { name: "Bonus terminés" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retour au menu" }))
      .toBeInTheDocument();
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

  it("breaks the open group's picker onto its own row instead of squeezing it into the card", () => {
    // The grid is auto-fill, so its column count depends on the panel's
    // width; simulate a 3-per-row layout by mocking the computed style the
    // component reads back from the grid container.
    const realGetComputedStyle = window.getComputedStyle;
    const getComputedStyleSpy = vi.spyOn(window, "getComputedStyle")
      .mockImplementation(element =>
        element.classList?.contains("bonus-menu-list")
          ? { gridTemplateColumns: "100px 100px 100px" }
          : realGetComputedStyle(element)
      );

    const entries = [
      { key: "q:1", label: "Q1", typeLabel: "Question", isContainer: false, itemCount: 1, tags: [] },
      { key: "group:2", label: "Group two", typeLabel: "Images", isContainer: true, itemCount: 10, tags: [] },
      { key: "q:3", label: "Q3", typeLabel: "Question", isContainer: false, itemCount: 1, tags: [] },
      { key: "q:4", label: "Q4", typeLabel: "Question", isContainer: false, itemCount: 1, tags: [] }
    ];

    const { container } = renderReviewSession({
      questions: [],
      currentIndex: 0,
      bonusReviewActive: true,
      bonusMenuOpen: true,
      bonusMenuEntries: entries
    });

    fireEvent.click(screen.getByRole("button", { name: /Group two/ }));

    const list = container.querySelector(".bonus-menu-list");
    const children = Array.from(list.children);
    const pickerIndex = children.findIndex(node =>
      node.classList.contains("bonus-menu-picker-row")
    );

    // Row 1 is [Q1, Group two, Q3] at 3 columns, so the picker lands right
    // after Q3 -- the end of that row -- not right after "Group two" itself,
    // which would otherwise push Q3 (and Q4) down instead.
    expect(pickerIndex).toBe(3);
    expect(children[pickerIndex - 1]).toHaveTextContent("Q3");
    expect(children[1]).not.toContainElement(screen.getByRole("slider"));

    getComputedStyleSpy.mockRestore();
  });

  it("keeps the revise-last-answer action reachable from the bonus menu", () => {
    const returnToLastQuestion = vi.fn();
    renderReviewSession({
      questions: [],
      currentIndex: 0,
      bonusReviewActive: true,
      bonusMenuOpen: true,
      bonusMenuEntries: [],
      canReturnToLastQuestion: true,
      returnToLastQuestion
    });

    fireEvent.click(screen.getByRole("button", { name: "Modifier la dernière réponse" }));
    expect(returnToLastQuestion).toHaveBeenCalledTimes(1);
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

  it("offers a shortcut to the bonus menu once only relearning questions remain", () => {
    const skipToBonusMenu = vi.fn();
    renderReviewSession({
      questions: [
        {
          id: 1,
          type_q: "text",
          question: "Capital?",
          answer: "Paris",
          _reviewRetryOfIndex: 0
        }
      ],
      currentIndex: 0,
      skipToBonusMenu
    });

    fireEvent.click(screen.getByRole("button", { name: "Questions bonus →" }));
    expect(skipToBonusMenu).toHaveBeenCalledTimes(1);
  });

  it("offers the bonus shortcut in the compact visual layout too", () => {
    const skipToBonusMenu = vi.fn();
    renderReviewSession({
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
      skipToBonusMenu
    });

    fireEvent.click(screen.getByRole("button", { name: "Questions bonus →" }));
    expect(skipToBonusMenu).toHaveBeenCalledTimes(1);
  });

  it("hides the bonus shortcut while any question ahead is still fresh", () => {
    renderReviewSession({
      questions: [
        { id: 1, type_q: "text", question: "Q1", answer: "A1", _reviewRetryOfIndex: 0 },
        { id: 2, type_q: "text", question: "Q2", answer: "A2" }
      ],
      currentIndex: 0
    });

    expect(screen.queryByRole("button", { name: "Questions bonus →" }))
      .not.toBeInTheDocument();
  });

  it("hides the bonus shortcut once bonus review is already active", () => {
    renderReviewSession({
      questions: [
        {
          id: 1,
          type_q: "text",
          question: "Capital?",
          answer: "Paris",
          _reviewRetryOfIndex: 0
        }
      ],
      currentIndex: 0,
      bonusReviewActive: true
    });

    expect(screen.queryByRole("button", { name: "Questions bonus →" }))
      .not.toBeInTheDocument();
  });
});
