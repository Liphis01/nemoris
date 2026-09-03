import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReviewSession from "./ReviewSession";

vi.mock("../../map/components/SvgMap", () => ({
  default: (props) => {
    const isRecap = props.flashCodes === undefined;
    const selectableCode = (props.clickableCodes || props.dueItems || [])[0];

    return (
      <button
        type="button"
        data-testid={isRecap ? "recap-map" : "active-map"}
        onClick={() => selectableCode && props.onSelect?.(selectableCode)}
      >
        {isRecap ? "Recap map" : "Active map"}
      </button>
    );
  }
}));

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
    // The group name now lives in the session bar's status block, once,
    // instead of being repeated inside MediaReview's own compact header.
    expect(status).toHaveTextContent("Flags");
    expect(status).toHaveTextContent("Question 1 / 1");
    expect(shell).toHaveTextContent("Flags");
    // Tags are metadata for browsing, not for answering a question already on
    // screen, so the compact header leaves them out.
    expect(status).not.toHaveTextContent("#Geo");
    expect(bar).not.toHaveTextContent("Image");
    expect(screen.queryByRole("heading", { name: "Révision" }))
      .not.toBeInTheDocument();
  });

  it("validates a click-prompt map recap through the session completion handler", async () => {
    const handleMapComplete = vi.fn();
    const submitMapAnswer = vi.fn().mockResolvedValue({ status: "ok", items: [] });

    renderReviewSession({
      questions: [
        {
          presentation_kind: "map_group",
          type_q: "map",
          name: "Numéro des départements français",
          media: "/static/departements.svg",
          mode: "click_prompt",
          items: [
            {
              question_id: 667,
              code: "16",
              label: "16",
              answer: "16",
              progress: {}
            }
          ]
        }
      ],
      currentIndex: 0,
      handleMapComplete,
      submitMapAnswer
    });

    fireEvent.click(screen.getByTestId("active-map"));
    fireEvent.click(await screen.findByRole("button", { name: "Bon" }));

    const validateButton = await screen.findByRole("button", { name: "Valider" });
    fireEvent.click(validateButton);

    await waitFor(() => {
      expect(submitMapAnswer).toHaveBeenCalledWith(
        { 667: 2 },
        "click_prompt",
        1,
        { 667: 667 },
        { 667: [667] }
      );
      expect(handleMapComplete).toHaveBeenCalledWith([]);
    });
  });

  it("uses presentation_kind to detect grouped visual review", () => {
    const { container } = renderReviewSession({
      questions: [
        {
          presentation_kind: "media_group",
          type_q: "text",
          name: "Audio",
          mode: "type_prompt",
          items: [
            {
              question_id: 1,
              answer: "France",
              label: "France",
              media: "/static/france.mp3"
            }
          ]
        }
      ],
      currentIndex: 0
    });

    expect(container.querySelector("[data-visual-session-shell]"))
      .toBeInTheDocument();
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

  it("does not show Question 0 / 0 for a retry-only queue", () => {
    renderReviewSession({
      questions: [
        {
          id: 1,
          type_q: "text",
          question: "Q1",
          answer: "A1",
          _reviewRetryOfIndex: 0
        }
      ],
      currentIndex: 0
    });

    expect(screen.getByText("Question 1 / 1")).toBeInTheDocument();
    expect(screen.queryByText("Question 0 / 0")).not.toBeInTheDocument();
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
      screen.getByRole("heading", { name: "Bilan de session" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retour au menu" })
    ).toBeInTheDocument();
  });

  it("renders learner debrief metrics and the recommended action", () => {
    const setMode = vi.fn();
    renderReviewSession({
      setMode,
      questions: [],
      currentIndex: 0,
      sessionComplete: true,
      sessionDebrief: {
        completedCount: 3,
        successCount: 1,
        missCount: 1,
        tomorrowCount: 1,
        tomorrow: "2026-08-15",
        recommendation: {
          label: "Travailler les erreurs",
          mode: "training",
          text: "Commence par 1 erreur récurrente."
        },
        typeStats: [
          {
            key: "map",
            label: "Carte",
            total: 2,
            success: 1,
            close: 0,
            miss: 1,
            unattempted: 0
          }
        ],
        groupStats: [
          {
            key: "group:7",
            label: "Europe",
            total: 2,
            success: 1,
            close: 0,
            miss: 1,
            unattempted: 0
          }
        ],
        newMisses: [],
        recurringMisses: [
          {
            attemptKey: "group:7:2",
            label: "Germany",
            groupName: "Europe",
            typeLabel: "Carte"
          }
        ],
        intervalChanges: [
          {
            attemptKey: "group:7:1",
            label: "France"
          }
        ],
        tomorrowRecords: [
          {
            attemptKey: "group:7:2",
            label: "Germany"
          }
        ],
        confusions: [
          {
            questionId: 2,
            expected: "Germany",
            selected: "Spain",
            typeLabel: "Carte"
          }
        ],
        records: [
          {
            attemptKey: "group:7:1",
            label: "France",
            groupName: "Europe",
            typeLabel: "Carte",
            type_q: "map",
            quality: 2,
            status: "success",
            previousInterval: 3,
            nextInterval: 8,
            nextReview: "2026-08-22"
          },
          {
            attemptKey: "group:7:2",
            label: "Germany",
            groupName: "Europe",
            typeLabel: "Carte",
            type_q: "map",
            quality: 0,
            status: "miss",
            previousInterval: 5,
            nextInterval: 0,
            nextReview: "2026-08-15"
          }
        ]
      }
    });

    expect(screen.getByText("Commence par 1 erreur récurrente.")).toBeInTheDocument();
    expect(screen.getByText("Terminées")).toBeInTheDocument();
    expect(screen.getByText("Par type")).toBeInTheDocument();
    expect(screen.getAllByText("Carte").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Europe").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Germany").length).toBeGreaterThan(0);
    expect(screen.getByText("Répondu : Spain")).toBeInTheDocument();
    expect(screen.getByText("5 j -> 0 j")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Travailler les erreurs" }));

    expect(setMode).toHaveBeenCalledWith("training");
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

    fireEvent.click(screen.getByRole("button", { name: "Abandonner la session" }));

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
      screen.queryByRole("button", { name: "Abandonner la session" })
    ).not.toBeInTheDocument();
  });
});
