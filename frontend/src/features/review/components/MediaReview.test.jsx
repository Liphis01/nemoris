import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MediaReview from "./MediaReview";
import { useMediaReview } from "../hooks/useMediaReview";
import {
  IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
  IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
  IMAGE_MODE_MULTIPLE_CHOICE_MEDIA,
  IMAGE_MODE_TYPE_ALL,
  IMAGE_MODE_TYPE_PROMPT,
  normalizeImageMode
} from "../imageModes";

vi.mock("../hooks/useMediaReview", () => ({
  IMAGE_RECAP_UNANSWERED: "unanswered",
  useMediaReview: vi.fn()
}));

const noop = vi.fn();

function imageItem(questionId, answer = `Image ${questionId}`) {
  return {
    question_id: questionId,
    answer,
    label: answer,
    media: `/static/image-${questionId}.png`
  };
}

function imageGridRow(questionId, options = {}) {
  const item = imageItem(questionId, options.answer);

  return {
    isActive: false,
    isFound: false,
    isMissed: false,
    isLockedMissed: false,
    isRevealed: false,
    feedbackState: "",
    quality: null,
    ...options,
    item: options.item || item
  };
}

function setElementWidth(element, { clientWidth, scrollWidth }) {
  Object.defineProperties(element, {
    clientWidth: {
      configurable: true,
      value: clientWidth
    },
    scrollWidth: {
      configurable: true,
      value: scrollWidth
    }
  });
}

function setTileLayout(container, layoutByQuestionId) {
  Object.entries(layoutByQuestionId).forEach(([questionId, layout]) => {
    const tile = container.querySelector(
      `[data-image-question-id="${questionId}"]`
    );

    Object.defineProperties(tile, {
      offsetLeft: {
        configurable: true,
        value: layout.left
      },
      offsetTop: {
        configurable: true,
        value: layout.top
      },
      scrollIntoView: {
        configurable: true,
        value: vi.fn()
      }
    });
  });
}

function tileFor(container, questionId) {
  return container.querySelector(`[data-image-question-id="${questionId}"]`);
}

function mockMediaReviewState({
  mode = IMAGE_MODE_TYPE_PROMPT,
  resultMode = false,
  rowOverrides = {},
  hookOverrides = {}
} = {}) {
  const item = {
    question_id: 1,
    answer: "Very long answer that should need a prettier preview",
    label: "Very long answer that should need a prettier preview",
    media: "/static/image.png"
  };
  const row = {
    item,
    isActive: true,
    isFound: true,
    isLockedMissed: false,
    quality: 2,
    ...rowOverrides
  };

  useMediaReview.mockReturnValue({
    activeQuestionId: row.isActive ? row.item.question_id : null,
    answeredCount: row.isFound ? 1 : 0,
    canFinishReview: true,
    choiceOptions: [],
    currentPromptItem: item,
    feedbackTone: "",
    finishReview: noop,
    foundQuestionIds: row.isFound ? [row.item.question_id] : [],
    gridItems: [row],
    handleChoiceSelect: noop,
    handleImageSelect: noop,
    handleSubmit: noop,
    input: "",
    interactionFeedback: null,
    mode,
    promptLabel: item.label,
    progressPercent: row.isFound ? 100 : 0,
    remainingCount: row.isFound ? 0 : 1,
    resolvedQuestionIds: row.isFound || row.isMissed || row.isLockedMissed
      ? [row.item.question_id]
      : [],
    resolvedQuestionIdsRecentFirst: row.isFound || row.isMissed || row.isLockedMissed
      ? [row.item.question_id]
      : [],
    resultMode,
    selectItem: noop,
    selectNextItem: noop,
    sendResult: noop,
    setInput: noop,
    setQuality: noop,
    skipCurrentPrompt: noop,
    wrongAnsweredCount: row.isLockedMissed ? 1 : 0,
    ...hookOverrides
  });

  return row;
}

function renderMediaReview(props = {}) {
  return render(
    <MediaReview
      group={{ name: "Images" }}
      reviewItems={[{ question_id: 1 }]}
      onComplete={noop}
      submitAnswer={noop}
      {...props}
    />
  );
}

function renderMediaReviewWithState(initialState, extraProps = {}) {
  let hookState = initialState;
  const props = {
    reviewItems: hookState.gridItems.map(row => row.item),
    ...extraProps
  };

  useMediaReview.mockImplementation(() => hookState);

  const rendered = renderMediaReview(props);

  return {
    ...rendered,
    setHookState(nextState) {
      hookState = nextState;
      rendered.rerender(
        <MediaReview
          group={{ name: "Images" }}
          reviewItems={props.reviewItems}
          onComplete={noop}
          submitAnswer={noop}
          {...extraProps}
        />
      );
    }
  };
}

function typeAllHookState({ rows, foundQuestionIds = [], hookOverrides = {} }) {
  return {
    activeQuestionId: null,
    answeredCount: foundQuestionIds.length,
    canFinishReview: true,
    choiceOptions: [],
    currentPromptItem: null,
    feedbackTone: "",
    finishReview: noop,
    foundQuestionIds,
    gridItems: rows,
    handleChoiceSelect: noop,
    handleImageSelect: noop,
    handleSubmit: noop,
    input: "",
    interactionFeedback: null,
    mode: IMAGE_MODE_TYPE_ALL,
    promptLabel: "",
    progressPercent: rows.length ? (foundQuestionIds.length / rows.length) * 100 : 0,
    remainingCount: Math.max(0, rows.length - foundQuestionIds.length),
    resolvedQuestionIds: [],
    resolvedQuestionIdsRecentFirst: [],
    resultMode: false,
    selectItem: noop,
    selectNextItem: noop,
    sendResult: noop,
    setInput: noop,
    setQuality: noop,
    skipCurrentPrompt: noop,
    wrongAnsweredCount: 0,
    ...hookOverrides
  };
}

function imageResultHookState({
  rows,
  foundQuestionIds = rows.filter(row => row.isFound).map(row => row.item.question_id),
  hookOverrides = {}
}) {
  const qualityByQuestionId = Object.fromEntries(
    rows.map(row => [
      row.item.question_id,
      row.isFound ? row.quality ?? 2 : 0
    ])
  );
  const foundQualities = foundQuestionIds.map(id => qualityByQuestionId[id]);
  const foundBulkQuality = foundQualities.length > 0 &&
    foundQualities.every(quality => quality === foundQualities[0])
      ? foundQualities[0]
      : null;
  const recapRows = rows.map(row => {
    const selectedQuality = qualityByQuestionId[row.item.question_id];

    return {
      item: row.item,
      isFound: row.isFound,
      historyStats: row.item.historyStats || {
        reviews: row.item.progress?.reps || 0,
        successRate: row.item.progress?.reps ? 100 : null
      },
      selectedQuality,
      projectedInterval:
        row.item.projected_intervals?.[selectedQuality] ??
        row.item.progress?.interval ??
        0
    };
  });

  return typeAllHookState({
    rows,
    foundQuestionIds,
    hookOverrides: {
      foundBulkQuality,
      qualityByQuestionId,
      recapMissCount: rows.length - foundQuestionIds.length,
      recapRows,
      recapSort: { key: null, direction: "asc" },
      recapSuccessCount: foundQuestionIds.length,
      recapSuccessRate: rows.length
        ? Math.round((foundQuestionIds.length / rows.length) * 100)
        : 0,
      remainingCount: 0,
      resultMode: true,
      wrongAnsweredCount: rows.length - foundQuestionIds.length,
      ...hookOverrides
    }
  });
}

function typePromptHookState({
  rows,
  activeQuestionId = rows[0]?.item.question_id || null,
  foundQuestionIds = [],
  resolvedQuestionIds = [],
  hookOverrides = {}
}) {
  const gridItems = rows.map(row => ({
    ...row,
    isActive: row.item.question_id === activeQuestionId
  }));
  const activeRow = gridItems.find(row => row.isActive) || gridItems[0] || null;

  return {
    activeQuestionId,
    answeredCount: foundQuestionIds.length,
    canFinishReview: true,
    choiceOptions: [],
    currentPromptItem: activeRow?.item || null,
    feedbackTone: "",
    finishReview: noop,
    foundQuestionIds,
    gridItems,
    handleChoiceSelect: noop,
    handleImageSelect: noop,
    handleSubmit: noop,
    input: "",
    interactionFeedback: null,
    mode: IMAGE_MODE_TYPE_PROMPT,
    promptLabel: "",
    progressPercent: gridItems.length
      ? (resolvedQuestionIds.length / gridItems.length) * 100
      : 0,
    remainingCount: Math.max(0, gridItems.length - resolvedQuestionIds.length),
    resolvedQuestionIds,
    resolvedQuestionIdsRecentFirst: [...resolvedQuestionIds].reverse(),
    resultMode: false,
    selectItem: noop,
    selectNextItem: noop,
    sendResult: noop,
    setInput: noop,
    setQuality: noop,
    skipCurrentPrompt: noop,
    wrongAnsweredCount: Math.max(0, resolvedQuestionIds.length - foundQuestionIds.length),
    ...hookOverrides
  };
}

function imageClickHookState({
  rows,
  mode = IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
  activeQuestionId = rows[0]?.item.question_id || null,
  foundQuestionIds = [],
  resolvedQuestionIds = [],
  hookOverrides = {}
}) {
  const gridItems = rows.map(row => ({
    ...row,
    isActive: row.item.question_id === activeQuestionId
  }));
  const activeRow = gridItems.find(row => row.isActive) || gridItems[0] || null;

  return {
    activeQuestionId,
    answeredCount: foundQuestionIds.length,
    canFinishReview: true,
    choiceOptions: [],
    currentPromptItem: activeRow?.item || null,
    feedbackTone: "",
    finishReview: noop,
    foundQuestionIds,
    gridItems,
    handleChoiceSelect: noop,
    handleImageSelect: noop,
    handleSubmit: noop,
    input: "",
    interactionFeedback: null,
    mode,
    promptLabel: activeRow?.item?.label || activeRow?.item?.answer || "",
    progressPercent: gridItems.length
      ? (resolvedQuestionIds.length / gridItems.length) * 100
      : 0,
    remainingCount: Math.max(0, gridItems.length - resolvedQuestionIds.length),
    resolvedQuestionIds,
    resolvedQuestionIdsRecentFirst: [...resolvedQuestionIds].reverse(),
    resultMode: false,
    selectItem: noop,
    selectNextItem: noop,
    sendResult: noop,
    setInput: noop,
    setQuality: noop,
    skipCurrentPrompt: noop,
    wrongAnsweredCount: Math.max(0, resolvedQuestionIds.length - foundQuestionIds.length),
    ...hookOverrides
  };
}

describe("MediaReview answer label preview", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the full answer on hover when the revealed label overflows", async () => {
    const row = mockMediaReviewState();
    renderMediaReview();
    const label = screen.getByText(row.item.label);

    setElementWidth(label, { clientWidth: 80, scrollWidth: 240 });
    fireEvent.pointerEnter(label);

    const tooltip = await screen.findByRole("tooltip");

    expect(tooltip).toHaveTextContent(row.item.label);
  });

  it("does not show a tooltip when the revealed label fits", async () => {
    const row = mockMediaReviewState();
    renderMediaReview();
    const label = screen.getByText(row.item.label);

    setElementWidth(label, { clientWidth: 240, scrollWidth: 240 });
    fireEvent.pointerEnter(label);

    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("does not reveal hidden answers even when the label would overflow", async () => {
    const row = mockMediaReviewState({
      rowOverrides: {
        isFound: false
      }
    });
    const { container } = renderMediaReview();
    const hiddenLabel = container.querySelector("[data-image-answer-label]");

    setElementWidth(hiddenLabel, { clientWidth: 80, scrollWidth: 240 });
    fireEvent.pointerEnter(hiddenLabel);

    expect(screen.queryByText(row.item.label)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("shows the training timer while answering image groups", () => {
    mockMediaReviewState();
    renderMediaReview({
      trainingElapsedMs: 12345,
      trainingBestTimeMs: 90000
    });

    expect(screen.getByText("Temps")).toBeInTheDocument();
    expect(screen.getByText("12s")).toBeInTheDocument();
    expect(screen.getByText("Meilleur")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();
  });

  it("shows image misses as a striped progress bar segment", () => {
    mockMediaReviewState({
      resultMode: true,
      rowOverrides: {
        isActive: false,
        isFound: false,
        isLockedMissed: true,
        quality: 0
      },
      hookOverrides: {
        answeredCount: 0,
        remainingCount: 0,
        wrongAnsweredCount: 1
      }
    });
    const { container } = renderMediaReview();

    expect(container.querySelector("[data-image-progress-correct]"))
      .toHaveStyle({ width: "0%" });
    expect(container.querySelector("[data-image-progress-wrong]"))
      .toHaveStyle({ width: "100%" });
    expect(container.querySelector("[data-image-progress-wrong]").style.background)
      .toContain("repeating-linear-gradient");
    expect(screen.getByRole("progressbar", { name: "Avancement" }))
      .toHaveAttribute("aria-valuenow", "1");
  });

  it("does not show a next-image control in type_all mode", () => {
    mockMediaReviewState({
      mode: IMAGE_MODE_TYPE_ALL,
      rowOverrides: {
        isActive: false,
        isFound: false
      }
    });
    renderMediaReview();

    expect(screen.queryByText("Image suivante")).not.toBeInTheDocument();
    expect(screen.getByText("Terminer")).toBeInTheDocument();
  });

  it("disables finish before the hook reports a real interaction", () => {
    const finishReview = vi.fn();
    mockMediaReviewState({
      mode: IMAGE_MODE_TYPE_ALL,
      rowOverrides: {
        isActive: false,
        isFound: false
      },
      hookOverrides: {
        canFinishReview: false,
        finishReview
      }
    });
    renderMediaReview();

    const button = screen.getByRole("button", { name: "Terminer la série" });

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(finishReview).not.toHaveBeenCalled();
  });

  it("uses a viewport-bounded shell with only the image pane scrolling", () => {
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3)
    ];
    const { container } = renderMediaReviewWithState(
      typeAllHookState({ rows })
    );
    const shell = container.querySelector("[data-image-review-shell]");
    const scrollPane = container.querySelector("[data-image-grid-scroll]");
    const controlBand = container.querySelector("[data-image-control-band]");

    expect(shell).toHaveStyle({
      height: "calc(100dvh - 220px)",
      minHeight: "420px",
      overflow: "hidden"
    });
    expect(scrollPane).toHaveClass("app-scrollbar");
    expect(scrollPane).toHaveStyle({
      overflow: "auto",
      minHeight: "0"
    });
    expect(scrollPane.style.flex).toBe("1 1 0%");
    expect(scrollPane.style.scrollbarGutter).toBe("stable");
    expect(scrollPane.querySelector("[data-image-active-grid]"))
      .toBeInTheDocument();
    expect(scrollPane.querySelector("input")).not.toBeInTheDocument();
    expect(controlBand).toContainElement(screen.getByPlaceholderText("Tape une image..."));
    expect(controlBand).toContainElement(screen.getByText("Terminer"));
  });

  it("fills a compact visual parent while keeping the image pane scrollable", () => {
    const rows = [
      imageGridRow(1),
      imageGridRow(2)
    ];

    useMediaReview.mockReturnValue(typeAllHookState({ rows }));
    const { container } = renderMediaReview({
      fillAvailableHeight: true,
      group: { name: "Flags" },
      reviewItems: rows.map(row => row.item),
      trainingBestTimeMs: 90000,
      trainingElapsedMs: 12345
    });
    const shell = container.querySelector("[data-image-review-shell]");
    const header = container.querySelector("[data-image-review-header]");
    const scrollPane = container.querySelector("[data-image-grid-scroll]");
    const activeGrid = container.querySelector("[data-image-active-grid]");
    const firstTile = tileFor(container, 1);

    expect(shell).toHaveStyle({
      height: "100%",
      minHeight: "0",
      overflow: "hidden"
    });
    // The group name already lives in the session bar above this card, so the
    // compact header itself carries no title chrome at all — just the count.
    expect(header).not.toHaveTextContent("Flags");
    expect(header).not.toHaveTextContent("Progression");
    expect(header).not.toHaveTextContent("IMAGE");
    expect(header).not.toHaveTextContent("Tout taper");
    expect(header).not.toHaveTextContent("Temps");
    expect(screen.getByRole("progressbar", { name: "Avancement" }))
      .toBeInTheDocument();
    expect(scrollPane).toHaveClass("app-scrollbar");
    expect(scrollPane).toHaveStyle({
      overflow: "auto",
      minHeight: "0"
    });
    expect(activeGrid.style.gridTemplateColumns)
      .toContain("minmax(190px, 1fr)");
    expect(firstTile).toHaveStyle({
      gridTemplateRows: "154px minmax(22px, auto)",
      minHeight: "212px"
    });
  });

  it("does not show the type_prompt prompt card", () => {
    renderMediaReviewWithState(typePromptHookState({
      rows: [imageGridRow(1)]
    }));

    expect(screen.queryByText("Image surlignée")).not.toBeInTheDocument();
    expect(screen.queryByText("Trouve son nom")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Nom de l'image...")).toBeInTheDocument();
  });

  it("selects a type_prompt image tile by click and restores input focus", async () => {
    const selectItem = vi.fn();
    const rows = [
      imageGridRow(1),
      imageGridRow(2)
    ];
    const { container } = renderMediaReviewWithState(
      typePromptHookState({
        rows,
        hookOverrides: {
          selectItem
        }
      })
    );
    const input = screen.getByPlaceholderText("Nom de l'image...");

    input.blur();
    fireEvent.click(tileFor(container, 2));

    expect(selectItem).toHaveBeenCalledWith(2);
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("uses Tab and Shift+Tab to select type_prompt images without moving focus", async () => {
    const selectNextItem = vi.fn();
    const skipCurrentPrompt = vi.fn();
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3)
    ];
    renderMediaReviewWithState(
      typePromptHookState({
        rows,
        hookOverrides: {
          selectNextItem,
          skipCurrentPrompt
        }
      })
    );
    const input = screen.getByPlaceholderText("Nom de l'image...");

    input.focus();

    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);
    expect(selectNextItem).toHaveBeenCalledWith(1);
    expect(skipCurrentPrompt).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });

    selectNextItem.mockClear();
    skipCurrentPrompt.mockClear();

    expect(fireEvent.keyDown(input, { key: "Tab", shiftKey: true })).toBe(false);
    expect(selectNextItem).toHaveBeenCalledWith(-1);
    expect(skipCurrentPrompt).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("opens type_prompt image preview from the zoom control without selecting", () => {
    const selectItem = vi.fn();
    const rows = [
      imageGridRow(1)
    ];
    const { container } = renderMediaReviewWithState(
      typePromptHookState({
        rows,
        hookOverrides: {
          selectItem
        }
      })
    );
    const zoomControl = container.querySelector("[data-image-zoom-control]");

    fireEvent.click(zoomControl);

    expect(selectItem).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Fermer l'image agrandie" }))
      .toBeInTheDocument();
  });

  it("keeps zoom separate from image selection in multiple_choice_image mode", () => {
    const mode = IMAGE_MODE_MULTIPLE_CHOICE_IMAGE;
    const handleImageSelect = vi.fn();
    const rows = [
      imageGridRow(1),
      imageGridRow(2)
    ];
    const { container } = renderMediaReviewWithState(
      imageClickHookState({
        rows,
        mode,
        hookOverrides: {
          handleImageSelect
        }
      })
    );

    fireEvent.click(tileFor(container, 2));

    expect(handleImageSelect).toHaveBeenCalledWith(2);

    handleImageSelect.mockClear();
    fireEvent.click(container.querySelector("[data-image-zoom-control]"));

    expect(handleImageSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Fermer l'image agrandie" }))
      .toBeInTheDocument();
  });

  it("uses a dedicated centered 2x2 board for multiple_choice_image", () => {
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3),
      imageGridRow(4)
    ];
    const { container } = renderMediaReviewWithState(
      imageClickHookState({
        rows,
        mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
      })
    );
    const choiceBoard = container.querySelector("[data-image-choice-board]");
    const scrollPane = container.querySelector("[data-image-grid-scroll]");
    const controlBand = container.querySelector("[data-image-control-band]");
    const choiceTiles = choiceBoard.querySelectorAll("[data-image-choice-tile]");
    const choiceImage = choiceTiles[0].querySelector("[data-image-choice-img]");
    const imageViewport = choiceImage.parentElement;

    expect(container.querySelector("[data-image-active-grid]"))
      .not.toBeInTheDocument();
    expect(choiceBoard).toBeInTheDocument();
    expect(scrollPane).toContainElement(choiceBoard);
    expect(controlBand).toHaveTextContent("Média demandé");
    expect(controlBand).toHaveTextContent("Image 1");
    expect(scrollPane).not.toHaveTextContent("Média demandé");
    expect(choiceBoard).toHaveStyle({
      display: "grid",
      height: "100%",
      maxWidth: "720px"
    });
    expect(choiceBoard.style.gridTemplateColumns)
      .toBe("repeat(2, minmax(0, 1fr))");
    expect(choiceBoard.style.gridTemplateRows)
      .toBe("repeat(2, minmax(0, 1fr))");
    expect(choiceTiles).toHaveLength(4);
    expect(choiceTiles[0]).toHaveStyle({ height: "100%" });
    expect(imageViewport).toHaveStyle({
      alignItems: "center",
      justifyContent: "center"
    });
    expect(choiceImage).toHaveStyle({
      objectFit: "contain",
      objectPosition: "center"
    });
  });

  it("keeps passed type_prompt image answers hidden on their tiles", () => {
    const rows = [
      imageGridRow(1),
      imageGridRow(2)
    ];
    const { container } = renderMediaReviewWithState(
      typePromptHookState({
        rows,
        activeQuestionId: 2
      })
    );
    const passedTile = tileFor(container, 1);

    expect(passedTile).toHaveAttribute("data-image-feedback", "");
    expect(passedTile).toHaveAttribute("data-image-revealed", "false");
    expect(passedTile).not.toHaveTextContent("Image 1");
  });

  it("reveals only the target image during wrong image-choice feedback", () => {
    const rows = [
      imageGridRow(1, {
        feedbackState: "missed",
        isMissed: true,
        isRevealed: true
      }),
      imageGridRow(2, {
        feedbackState: "wrong"
      })
    ];
    const { container } = renderMediaReviewWithState(
      imageClickHookState({
        rows,
        activeQuestionId: 1,
        hookOverrides: {
          feedbackTone: "incorrect",
          interactionFeedback: {
            correctQuestionId: 1,
            isCorrect: false,
            selectedQuestionId: 2
          },
          wrongAnsweredCount: 1
        }
      })
    );

    expect(tileFor(container, 1)).toHaveAttribute("data-image-feedback", "missed");
    expect(tileFor(container, 1).querySelector("[data-image-feedback-badge]"))
      .toHaveTextContent("Réponse");
    expect(tileFor(container, 1)).toHaveTextContent("Image 1");
    expect(tileFor(container, 2)).toHaveAttribute("data-image-feedback", "wrong");
    expect(tileFor(container, 2).querySelector("[data-image-feedback-badge]"))
      .toHaveTextContent("Faux");
    expect(tileFor(container, 2)).toHaveAttribute("data-image-revealed", "false");
    expect(tileFor(container, 2)).not.toHaveTextContent("Image 2");
  });

  it("shows one prompt image with bottom labels in multiple_choice_label", async () => {
    const handleChoiceSelect = vi.fn();
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3),
      imageGridRow(4)
    ];
    const initialState = imageClickHookState({
      rows,
      mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
      activeQuestionId: 1,
      hookOverrides: {
        choiceOptions: rows.map(row => row.item),
        handleChoiceSelect
      }
    });
    const { container, setHookState } = renderMediaReviewWithState(initialState);
    const promptBoard = container.querySelector("[data-image-prompt-board]");
    const controlBand = container.querySelector("[data-image-control-band]");
    const promptTiles = promptBoard.querySelectorAll("[data-image-prompt-tile]");
    const promptImage = promptTiles[0].querySelector("[data-image-prompt-img]");

    setTileLayout(container, {
      1: { left: 0, top: 0 }
    });

    expect(container.querySelector("[data-image-active-grid]"))
      .not.toBeInTheDocument();
    expect(container.querySelector("[data-image-choice-board]"))
      .not.toBeInTheDocument();
    expect(promptBoard).toBeInTheDocument();
    expect(promptBoard).toHaveStyle({
      display: "flex",
      maxHeight: "100%",
      maxWidth: "min(100%, 900px)"
    });
    expect(promptTiles).toHaveLength(1);
    expect(promptTiles[0]).toHaveAttribute("data-image-question-id", "1");
    expect(promptImage).toHaveStyle({
      objectFit: "contain",
      objectPosition: "center"
    });
    expect(controlBand).toContainElement(
      screen.getByRole("button", { name: "Choix 2 : Image 2" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Choix 2 : Image 2" }));

    expect(handleChoiceSelect).toHaveBeenCalledWith(2);

    setHookState(imageClickHookState({
      rows: [
        imageGridRow(1, {
          feedbackState: "missed",
          isMissed: true,
          isRevealed: true
        }),
        imageGridRow(2),
        imageGridRow(3),
        imageGridRow(4)
      ],
      mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
      activeQuestionId: 1,
      hookOverrides: {
        choiceOptions: rows.map(row => row.item),
        feedbackTone: "incorrect",
        interactionFeedback: {
          correctQuestionId: 1,
          isCorrect: false,
          selectedQuestionId: 2
        },
        wrongAnsweredCount: 1
      }
    }));

    await waitFor(() => {
      expect(screen.getByText("Correct").closest("button"))
        .toHaveAttribute("data-image-choice-feedback", "correct");
      expect(screen.getByText("Faux").closest("button"))
        .toHaveAttribute("data-image-choice-feedback", "wrong");
      expect(container.querySelectorAll("[data-image-prompt-tile]"))
        .toHaveLength(1);
      expect(tileFor(container, 1).scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      });
    });
    // Unified reveal: green = correct answer, red = the wrong pick.
    expect(screen.getByText("Correct").closest("button").style.border)
      .toContain("134, 239, 172");
    expect(screen.getByRole("button", { name: "Choix 2 : Image 2, Faux" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Faux").closest("button").style.background)
      .toContain("repeating-linear-gradient");
    expect(screen.getByText("Faux").closest("button").style.border)
      .toContain("248, 113, 113");
    expect(tileFor(container, 1)).toHaveTextContent("Image 1");
  });

  it("multiple_choice_label picks the matching option on a number-key shortcut", () => {
    const handleChoiceSelect = vi.fn();
    const rows = [imageGridRow(1), imageGridRow(2), imageGridRow(3), imageGridRow(4)];
    const { container } = renderMediaReviewWithState(imageClickHookState({
      rows,
      mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
      activeQuestionId: 1,
      hookOverrides: {
        choiceOptions: rows.map(row => row.item),
        handleChoiceSelect
      }
    }));

    // Each choice shows a discoverable keycap hint.
    expect(container.querySelectorAll("[data-image-choice-key]")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Choix 1 : Image 1" }))
      .toHaveAttribute("aria-pressed", "false");

    fireEvent.keyDown(window, { key: "3" });

    expect(handleChoiceSelect).toHaveBeenCalledWith(3);
  });

  it("multiple_choice_image picks the matching tile on a number-key shortcut", () => {
    const handleImageSelect = vi.fn();
    const rows = [imageGridRow(1), imageGridRow(2), imageGridRow(3), imageGridRow(4)];
    const { container } = renderMediaReviewWithState(imageClickHookState({
      rows,
      mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
      activeQuestionId: 1,
      hookOverrides: {
        choiceOptions: rows.map(row => row.item),
        handleImageSelect
      }
    }));

    expect(container.querySelectorAll("[data-image-choice-key]")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Choix 2 : média" }))
      .toHaveAttribute("aria-pressed", "false");

    fireEvent.keyDown(window, { key: "2" });

    expect(handleImageSelect).toHaveBeenCalledWith(2);
  });

  it("keeps audio players playable before a QCM media choice is selected", () => {
    const handleImageSelect = vi.fn();
    const rows = [1, 2, 3, 4].map(questionId => imageGridRow(questionId, {
      item: {
        ...imageItem(questionId, `Son ${questionId}`),
        media: `/static/sound-${questionId}.mp3`
      }
    }));
    const { container } = renderMediaReviewWithState(imageClickHookState({
      rows,
      mode: IMAGE_MODE_MULTIPLE_CHOICE_MEDIA,
      activeQuestionId: 1,
      hookOverrides: {
        choiceOptions: rows.map(row => row.item),
        handleImageSelect
      }
    }));

    expect(normalizeImageMode("multiple_choice_image"))
      .toBe(IMAGE_MODE_MULTIPLE_CHOICE_MEDIA);
    expect(container.querySelectorAll("audio")).toHaveLength(4);

    fireEvent.click(container.querySelector("audio"));
    expect(handleImageSelect).not.toHaveBeenCalled();

    fireEvent.click(tileFor(container, 2));
    expect(handleImageSelect).toHaveBeenCalledWith(2);
  });

  it("replaces the decoys with the quality buttons after a correct pick", () => {
    const rateChoice = vi.fn();
    const rows = [imageGridRow(1), imageGridRow(2), imageGridRow(3), imageGridRow(4)];
    const { container } = renderMediaReviewWithState(imageClickHookState({
      rows,
      mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
      activeQuestionId: 1,
      hookOverrides: {
        choiceOptions: rows.map(row => row.item),
        rateChoice,
        interactionFeedback: {
          correctQuestionId: 1,
          isCorrect: true,
          selectedQuestionId: 1
        }
      }
    }));

    // Only the correct answer stays; the three decoy slots become Dur/Bon/Facile.
    expect(container.querySelectorAll("[data-image-choice-feedback]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-image-choice-quality]")).toHaveLength(3);
    // A correct pick is never "Faux".
    expect(container.querySelector("[data-image-choice-quality='0']")).toBeNull();

    fireEvent.keyDown(window, { key: "3" });
    expect(rateChoice).toHaveBeenCalledWith(3);

    fireEvent.keyDown(window, { key: "2" });
    expect(rateChoice).toHaveBeenCalledWith(2);
  });

  it("collapses the choice rating to a single Acquis for a relearning card", () => {
    const rateChoice = vi.fn();
    const rows = [imageGridRow(1), imageGridRow(2), imageGridRow(3), imageGridRow(4)];
    const { container } = renderMediaReviewWithState(
      imageClickHookState({
        rows,
        mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
        activeQuestionId: 1,
        hookOverrides: {
          choiceOptions: rows.map(row => row.item),
          rateChoice,
          interactionFeedback: {
            correctQuestionId: 1,
            isCorrect: true,
            selectedQuestionId: 1
          }
        }
      }),
      { group: { name: "Flags", _reviewRetryOfIndex: 0 } }
    );

    // A relearning card never re-grades, so the three grades become one "Acquis".
    expect(container.querySelectorAll("[data-image-choice-quality]")).toHaveLength(1);
    expect(container.querySelector("[data-image-choice-quality='2']")).toBeNull();
    expect(container.querySelector("[data-image-choice-quality='3']")).toBeNull();

    fireEvent.click(container.querySelector("[data-image-choice-quality='1']"));
    expect(rateChoice).toHaveBeenCalledWith(1);
  });

  it("centers the correct answer with no quality buttons in training", () => {
    const rows = [imageGridRow(1), imageGridRow(2), imageGridRow(3), imageGridRow(4)];
    const { container } = renderMediaReviewWithState(imageClickHookState({
      rows,
      mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
      activeQuestionId: 1,
      hookOverrides: {
        choiceOptions: rows.map(row => row.item),
        interactionFeedback: {
          correctQuestionId: 1,
          isCorrect: true,
          selectedQuestionId: 1
        }
      }
    }), { showQualityControls: false });

    // Training has no quality buttons; the lone correct answer is centered.
    expect(container.querySelectorAll("[data-image-choice-quality]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-image-choice-feedback]")).toHaveLength(1);

    const grid = container.querySelector("[data-image-choice-grid]");
    expect(grid.style.justifyContent).toBe("center");
    expect(grid.style.gridTemplateColumns).toBe("repeat(1, minmax(150px, 250px))");
  });

  it("centers both answers after a wrong pick in training", () => {
    const rows = [imageGridRow(1), imageGridRow(2), imageGridRow(3), imageGridRow(4)];
    const { container } = renderMediaReviewWithState(imageClickHookState({
      rows,
      mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
      activeQuestionId: 1,
      hookOverrides: {
        choiceOptions: rows.map(row => row.item),
        interactionFeedback: {
          correctQuestionId: 1,
          isCorrect: false,
          selectedQuestionId: 2
        }
      }
    }), { showQualityControls: false });

    // Both the correct answer and the wrong pick stay, centered, no Continuer.
    expect(container.querySelectorAll("[data-image-choice-feedback]")).toHaveLength(2);
    expect(container.querySelector("[data-image-choice-continue]")).toBeNull();

    const grid = container.querySelector("[data-image-choice-grid]");
    expect(grid.style.justifyContent).toBe("center");
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(150px, 250px))");
  });

  it("centers the image board reveal in training", () => {
    const rows = [imageGridRow(1), imageGridRow(2), imageGridRow(3), imageGridRow(4)];
    const { container } = renderMediaReviewWithState(imageClickHookState({
      rows,
      mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
      activeQuestionId: 1,
      hookOverrides: {
        choiceOptions: rows.map(row => row.item),
        interactionFeedback: {
          correctQuestionId: 1,
          isCorrect: true,
          selectedQuestionId: 1
        }
      }
    }), { showQualityControls: false });

    expect(container.querySelectorAll("[data-image-choice-quality]")).toHaveLength(0);

    const board = container.querySelector("[data-image-choice-board]");
    expect(board.style.placeContent).toBe("center");
    // One surviving tile, sized like a 2x2 cell so FLIP slides it without resizing.
    expect(board.style.gridTemplateColumns).toContain("repeat(1,");
    expect(board.style.gridTemplateColumns).toContain("calc(50%");
  });

  it("continues past a revealed wrong choice with Enter", () => {
    const rateChoice = vi.fn();
    const rows = [imageGridRow(1), imageGridRow(2), imageGridRow(3), imageGridRow(4)];
    const { container } = renderMediaReviewWithState(imageClickHookState({
      rows,
      mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
      activeQuestionId: 1,
      hookOverrides: {
        choiceOptions: rows.map(row => row.item),
        rateChoice,
        interactionFeedback: {
          correctQuestionId: 1,
          isCorrect: false,
          selectedQuestionId: 2
        }
      }
    }));

    // The correct answer and your pick stay; the two freed slots become Continuer.
    expect(container.querySelectorAll("[data-image-choice-feedback]")).toHaveLength(2);
    // A wrong pick is a lapse: no quality choice, just continue.
    expect(container.querySelectorAll("[data-image-choice-quality]")).toHaveLength(0);
    expect(container.querySelector("[data-image-choice-continue]")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Enter" });

    expect(rateChoice).toHaveBeenCalledWith();
  });

  it("ignores the number-key shortcut once a choice is revealed", () => {
    const handleChoiceSelect = vi.fn();
    const rows = [imageGridRow(1), imageGridRow(2), imageGridRow(3), imageGridRow(4)];
    renderMediaReviewWithState(imageClickHookState({
      rows,
      mode: IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
      activeQuestionId: 1,
      hookOverrides: {
        choiceOptions: rows.map(row => row.item),
        handleChoiceSelect,
        interactionFeedback: { correctQuestionId: 1, isCorrect: true, selectedQuestionId: 1 }
      }
    }));

    fireEvent.keyDown(window, { key: "3" });

    expect(handleChoiceSelect).not.toHaveBeenCalled();
  });

  it("reveals the target and clicked wrong image during multiple_choice_image feedback", () => {
    const rows = [
      imageGridRow(1, {
        feedbackState: "missed",
        isMissed: true,
        isRevealed: true
      }),
      imageGridRow(2, {
        feedbackState: "wrong",
        isRevealed: true
      }),
      imageGridRow(3),
      imageGridRow(4)
    ];
    const { container } = renderMediaReviewWithState(
      imageClickHookState({
        rows,
        mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
        activeQuestionId: 1,
        hookOverrides: {
          feedbackTone: "incorrect",
          interactionFeedback: {
            correctQuestionId: 1,
            isCorrect: false,
            selectedQuestionId: 2
          },
          wrongAnsweredCount: 1
        }
      })
    );

    expect(tileFor(container, 1)).toHaveAttribute("data-image-feedback", "missed");
    expect(tileFor(container, 1).querySelector("[data-image-feedback-badge]"))
      .toHaveTextContent("Réponse");
    expect(tileFor(container, 1)).toHaveTextContent("Image 1");
    expect(tileFor(container, 2)).toHaveAttribute("data-image-feedback", "wrong");
    expect(tileFor(container, 2).querySelector("[data-image-feedback-badge]"))
      .toHaveTextContent("Faux");
    expect(tileFor(container, 2)).toHaveTextContent("Image 2");
  });

  it("separates resolved type_prompt images newest first while answering", () => {
    const selectItem = vi.fn();
    const rows = [
      imageGridRow(1, { isFound: true, quality: 2 }),
      imageGridRow(2),
      imageGridRow(3, {
        isMissed: true,
        isRevealed: true
      })
    ];
    useMediaReview.mockReturnValue(
      typePromptHookState({
        rows,
        activeQuestionId: 2,
        foundQuestionIds: [1],
        resolvedQuestionIds: [1, 3],
        hookOverrides: { selectItem }
      })
    );
    const { container } = renderMediaReview({
      reviewItems: rows.map(row => row.item),
      separateResolvedItems: true
    });
    const activeGrid = container.querySelector("[data-image-active-grid]");
    const resolvedSection = container.querySelector("[data-image-resolved-section]");
    const resolvedTiles = Array.from(
      resolvedSection.querySelectorAll("[data-image-question-id]")
    );

    expect(activeGrid.querySelector('[data-image-question-id="1"]'))
      .not.toBeInTheDocument();
    expect(activeGrid.querySelector('[data-image-question-id="2"]'))
      .toBeInTheDocument();
    expect(activeGrid.querySelector('[data-image-question-id="3"]'))
      .not.toBeInTheDocument();
    expect(resolvedSection).toHaveTextContent("Traitées");
    expect(resolvedTiles.map(tile => tile.getAttribute("data-image-question-id")))
      .toEqual(["3", "1"]);
    expect(resolvedSection.querySelector('[data-image-question-id="3"]'))
      .toHaveTextContent("Image 3");

    fireEvent.click(resolvedSection.querySelector('[data-image-question-id="3"]'));

    expect(selectItem).not.toHaveBeenCalled();
  });

  it("keeps the full grid together in image result mode", () => {
    const rows = [
      imageGridRow(1, { isFound: true, quality: 2 }),
      imageGridRow(2, { isLockedMissed: true, quality: 0 })
    ];
    useMediaReview.mockReturnValue({
      ...typeAllHookState({ rows, foundQuestionIds: [1] }),
      resultMode: true,
      wrongAnsweredCount: 1
    });
    const { container } = renderMediaReview({
      reviewItems: rows.map(row => row.item),
      separateResolvedItems: true
    });
    const activeGrid = container.querySelector("[data-image-active-grid]");

    expect(container.querySelector("[data-image-resolved-section]"))
      .not.toBeInTheDocument();
    expect(activeGrid.querySelector('[data-image-question-id="1"]'))
      .toBeInTheDocument();
    expect(activeGrid.querySelector('[data-image-question-id="2"]'))
      .toBeInTheDocument();
  });

  it("moves image result quality controls into the recap", () => {
    const setFoundImageQualities = vi.fn();
    const sendResult = vi.fn();
    const setQuality = vi.fn();
    const rows = [
      imageGridRow(1, {
        isFound: true,
        item: {
          ...imageItem(1),
          projected_intervals: { 1: 4, 2: 12, 3: 30 },
          progress: { reps: 2, lapses: 1, interval: 12 }
        },
        quality: 2
      }),
      imageGridRow(2, {
        isLockedMissed: true,
        item: {
          ...imageItem(2),
          projected_intervals: { 0: 0, 1: 2, 2: 8, 3: 16 }
        },
        quality: 0
      })
    ];
    useMediaReview.mockReturnValue(
      imageResultHookState({
        rows,
        hookOverrides: {
          sendResult,
          setFoundImageQualities,
          setQuality
        }
      })
    );
    const { container } = renderMediaReview({
      reviewItems: rows.map(row => row.item)
    });

    expect(container.querySelector("[data-image-recap-overlay]"))
      .toBeInTheDocument();
    expect(tileFor(container, 1)).not.toHaveTextContent("Bon");
    expect(screen.getByText("Images trouvées")).toBeInTheDocument();
    expect(screen.getByText("Trouvées")).toBeInTheDocument();
    expect(screen.getAllByText("À revoir").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    expect(screen.queryByText("0 · Faux")).not.toBeInTheDocument();
    expect(container.querySelector(
      ".image-recap-bulk-row [data-image-recap-quality=\"0\"]"
    )).toBeDisabled();
    expect(container.querySelectorAll(
      ".image-recap-row[data-image-recap-row=\"found\"] [data-image-recap-quality]"
    )).toHaveLength(4);
    expect(container.querySelectorAll(
      ".image-recap-row[data-image-recap-row=\"missed\"] [data-image-recap-quality]"
    )).toHaveLength(4);
    expect(container.querySelector(
      ".image-recap-row[data-image-recap-row=\"missed\"] [data-image-recap-quality=\"0\"]"
    )).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(
      container.querySelector(
        ".image-recap-bulk-row [data-image-recap-quality=\"3\"]"
      )
    );
    expect(setFoundImageQualities).toHaveBeenCalledWith(3);

    fireEvent.click(
      container.querySelector(
        ".image-recap-row[data-image-recap-row=\"found\"] [data-image-recap-quality=\"1\"]"
      )
    );
    expect(setQuality).toHaveBeenCalledWith(1, 1);

    fireEvent.click(
      container.querySelector(
        ".image-recap-row[data-image-recap-row=\"missed\"] [data-image-recap-quality=\"2\"]"
      )
    );
    expect(setQuality).toHaveBeenCalledWith(2, 2);

    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    expect(sendResult).toHaveBeenCalledTimes(1);
  });

  it("collapses the recap to binary Encore/Acquis for a relearning group", () => {
    const setFoundImageQualities = vi.fn();
    const setQuality = vi.fn();
    const rows = [
      imageGridRow(1, {
        isFound: true,
        item: {
          ...imageItem(1),
          projected_intervals: { 1: 4, 2: 12, 3: 30 },
          progress: { reps: 2, lapses: 1, interval: 12, relearning: true }
        },
        quality: 2
      }),
      imageGridRow(2, {
        isLockedMissed: true,
        item: {
          ...imageItem(2),
          projected_intervals: { 0: 0, 1: 2, 2: 8, 3: 16 },
          progress: { relearning: true }
        },
        quality: 0
      })
    ];
    useMediaReview.mockReturnValue(
      imageResultHookState({
        rows,
        hookOverrides: { setFoundImageQualities, setQuality }
      })
    );
    const { container } = renderMediaReview({
      reviewItems: rows.map(row => row.item),
      group: { name: "Flags", _reviewRetryOfIndex: 0 }
    });

    // Each relearning row offers only the two grades, not the four.
    expect(container.querySelectorAll(
      ".image-recap-row[data-image-recap-row=\"found\"] [data-image-recap-quality]"
    )).toHaveLength(2);
    expect(container.querySelectorAll(
      ".image-recap-row[data-image-recap-row=\"missed\"] [data-image-recap-quality]"
    )).toHaveLength(2);
    expect(container.querySelector(
      ".image-recap-row[data-image-recap-row=\"found\"] [data-image-recap-quality=\"2\"]"
    )).toBeNull();

    // A found relearning row stores quality 2 by default but highlights "Acquis" (1).
    expect(container.querySelector(
      ".image-recap-row[data-image-recap-row=\"found\"] [data-image-recap-quality=\"1\"]"
    )).toHaveAttribute("aria-pressed", "true");
    // A missed relearning row highlights "Encore" (0).
    expect(container.querySelector(
      ".image-recap-row[data-image-recap-row=\"missed\"] [data-image-recap-quality=\"0\"]"
    )).toHaveAttribute("aria-pressed", "true");

    // The bulk control keeps the global X (Encore) visible but unclickable,
    // exactly like the regular recap, and only "Acquis" applies (quality 1).
    expect(container.querySelectorAll(
      ".image-recap-bulk-row [data-image-recap-quality]"
    )).toHaveLength(2);
    expect(container.querySelector(
      ".image-recap-bulk-row [data-image-recap-quality=\"0\"]"
    )).toBeDisabled();
    const bulkAcquis = container.querySelector(
      ".image-recap-bulk-row [data-image-recap-quality=\"1\"]"
    );
    expect(bulkAcquis).not.toBeDisabled();
    fireEvent.click(bulkAcquis);
    expect(setFoundImageQualities).toHaveBeenCalledWith(1);
  });

  it("uses the right recap table to select the large left preview", () => {
    const rows = [
      imageGridRow(1, {
        isFound: true,
        item: {
          ...imageItem(1, "France"),
          projected_intervals: { 1: 4, 2: 12, 3: 30 }
        },
        quality: 2
      }),
      imageGridRow(2, {
        isLockedMissed: true,
        item: {
          ...imageItem(2, "Germany"),
          projected_intervals: { 0: 0, 1: 2, 2: 8, 3: 16 }
        },
        quality: 0
      })
    ];
    useMediaReview.mockReturnValue(imageResultHookState({ rows }));
    const { container } = renderMediaReview({
      reviewItems: rows.map(row => row.item)
    });
    const preview = container.querySelector("[data-image-recap-selected-preview]");
    const germanyRow = container.querySelector(
      ".image-recap-row[data-image-recap-row=\"missed\"]"
    );

    expect(preview).toHaveTextContent("France");
    expect(container.querySelector(
      ".image-recap-row[data-image-recap-selected=\"true\"]"
    )).toHaveTextContent("France");

    fireEvent.click(germanyRow);

    expect(preview).toHaveTextContent("Germany");
    expect(container.querySelector(
      ".image-recap-row[data-image-recap-selected=\"true\"]"
    )).toHaveTextContent("Germany");
  });

  it("updates the displayed image recap interval when selected quality changes", () => {
    const rows = [
      imageGridRow(1, {
        isFound: true,
        item: {
          ...imageItem(1),
          projected_intervals: { 1: 5, 2: 15, 3: 45 }
        },
        quality: 2
      })
    ];
    const initialState = imageResultHookState({ rows });
    const { setHookState } = renderMediaReviewWithState(initialState);

    expect(screen.getAllByText("15").length).toBeGreaterThan(0);

    setHookState(
      imageResultHookState({
        rows: [
          imageGridRow(1, {
            isFound: true,
            item: rows[0].item,
            quality: 3
          })
        ]
      })
    );

    expect(screen.getAllByText("45").length).toBeGreaterThan(0);
    expect(screen.queryByText("15")).not.toBeInTheDocument();
  });

  it("scrolls to the exact typed image after a correct type_all answer", async () => {
    const initialRows = [
      imageGridRow(1, { isFound: true, quality: 2 }),
      imageGridRow(2),
      imageGridRow(3),
      imageGridRow(4)
    ];
    const completedRows = [
      imageGridRow(1, { isFound: true, quality: 2 }),
      imageGridRow(2, { isFound: true, quality: 2 }),
      imageGridRow(3),
      imageGridRow(4)
    ];
    const { container, setHookState } = renderMediaReviewWithState(
      typeAllHookState({ rows: initialRows, foundQuestionIds: [1] })
    );

    setTileLayout(container, {
      1: { left: 0, top: 0 },
      2: { left: 160, top: 0 },
      3: { left: 0, top: 200 },
      4: { left: 160, top: 200 }
    });

    setHookState(typeAllHookState({
      rows: completedRows,
      foundQuestionIds: [1, 2]
    }));

    await waitFor(() => {
      expect(tileFor(container, 2).scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      });
    });
    expect(tileFor(container, 1).scrollIntoView).not.toHaveBeenCalled();
    expect(tileFor(container, 3).scrollIntoView).not.toHaveBeenCalled();
  });

  it("still scrolls to the typed image when its row has unfinished images", async () => {
    const initialRows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3),
      imageGridRow(4)
    ];
    const partiallyCompletedRows = [
      imageGridRow(1, { isFound: true, quality: 2 }),
      imageGridRow(2),
      imageGridRow(3),
      imageGridRow(4)
    ];
    const { container, setHookState } = renderMediaReviewWithState(
      typeAllHookState({ rows: initialRows })
    );

    setTileLayout(container, {
      1: { left: 0, top: 0 },
      2: { left: 160, top: 0 },
      3: { left: 0, top: 200 },
      4: { left: 160, top: 200 }
    });

    setHookState(typeAllHookState({
      rows: partiallyCompletedRows,
      foundQuestionIds: [1]
    }));

    await waitFor(() => {
      expect(tileFor(container, 1).scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      });
    });
    expect(tileFor(container, 3).scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not wrap to another row after a type_all answer is typed", async () => {
    const initialRows = [
      imageGridRow(1, { isFound: true, quality: 2 }),
      imageGridRow(2),
      imageGridRow(3, { isFound: true, quality: 2 }),
      imageGridRow(4, { isFound: true, quality: 2 }),
      imageGridRow(5),
      imageGridRow(6)
    ];
    const completedRows = [
      imageGridRow(1, { isFound: true, quality: 2 }),
      imageGridRow(2, { isFound: true, quality: 2 }),
      imageGridRow(3, { isFound: true, quality: 2 }),
      imageGridRow(4, { isFound: true, quality: 2 }),
      imageGridRow(5),
      imageGridRow(6)
    ];
    const { container, setHookState } = renderMediaReviewWithState(
      typeAllHookState({ rows: initialRows, foundQuestionIds: [1, 3, 4] })
    );

    setTileLayout(container, {
      1: { left: 0, top: 0 },
      2: { left: 160, top: 0 },
      3: { left: 0, top: 200 },
      4: { left: 160, top: 200 },
      5: { left: 0, top: 400 },
      6: { left: 160, top: 400 }
    });

    setHookState(typeAllHookState({
      rows: completedRows,
      foundQuestionIds: [1, 2, 3, 4]
    }));

    await waitFor(() => {
      expect(tileFor(container, 2).scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      });
    });
    expect(tileFor(container, 5).scrollIntoView).not.toHaveBeenCalled();
  });

  it("uses Tab and Shift+Tab to scroll between incomplete type_all rows without moving focus", async () => {
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3),
      imageGridRow(4),
      imageGridRow(5),
      imageGridRow(6)
    ];
    const { container } = renderMediaReviewWithState(
      typeAllHookState({ rows })
    );
    const scrollArea = container.querySelector("[data-image-grid-scroll]");
    const input = screen.getByPlaceholderText("Tape une image...");

    setTileLayout(container, {
      1: { left: 0, top: 0 },
      2: { left: 160, top: 0 },
      3: { left: 0, top: 200 },
      4: { left: 160, top: 200 },
      5: { left: 0, top: 400 },
      6: { left: 160, top: 400 }
    });

    input.focus();

    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);

    await waitFor(() => {
      expect(tileFor(container, 3).scrollIntoView).toHaveBeenCalled();
    });
    expect(document.activeElement).toBe(input);

    scrollArea.scrollTop = 200;

    expect(fireEvent.keyDown(input, { key: "Tab", shiftKey: true })).toBe(false);

    await waitFor(() => {
      expect(tileFor(container, 1).scrollIntoView).toHaveBeenCalled();
    });
    expect(document.activeElement).toBe(input);
  });

  it("wraps Tab from the last incomplete row back to the first", async () => {
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3, { isFound: true, quality: 2 }),
      imageGridRow(4, { isFound: true, quality: 2 }),
      imageGridRow(5),
      imageGridRow(6)
    ];
    const { container } = renderMediaReviewWithState(
      typeAllHookState({ rows, foundQuestionIds: [3, 4] })
    );
    const scrollArea = container.querySelector("[data-image-grid-scroll]");
    const input = screen.getByPlaceholderText("Tape une image...");

    setTileLayout(container, {
      1: { left: 0, top: 0 },
      2: { left: 160, top: 0 },
      3: { left: 0, top: 200 },
      4: { left: 160, top: 200 },
      5: { left: 0, top: 400 },
      6: { left: 160, top: 400 }
    });

    // Simulate already being scrolled to the last incomplete row (row 5/6).
    scrollArea.scrollTop = 400;
    input.focus();

    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);

    await waitFor(() => {
      expect(tileFor(container, 1).scrollIntoView).toHaveBeenCalled();
    });
    expect(tileFor(container, 5).scrollIntoView).not.toHaveBeenCalled();
  });

  it("wraps Shift+Tab from the first incomplete row back to the last", async () => {
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3, { isFound: true, quality: 2 }),
      imageGridRow(4, { isFound: true, quality: 2 }),
      imageGridRow(5),
      imageGridRow(6)
    ];
    const { container } = renderMediaReviewWithState(
      typeAllHookState({ rows, foundQuestionIds: [3, 4] })
    );
    const scrollArea = container.querySelector("[data-image-grid-scroll]");
    const input = screen.getByPlaceholderText("Tape une image...");

    setTileLayout(container, {
      1: { left: 0, top: 0 },
      2: { left: 160, top: 0 },
      3: { left: 0, top: 200 },
      4: { left: 160, top: 200 },
      5: { left: 0, top: 400 },
      6: { left: 160, top: 400 }
    });

    // Already scrolled to the top, sitting on the first incomplete row.
    scrollArea.scrollTop = 0;
    input.focus();

    expect(fireEvent.keyDown(input, { key: "Tab", shiftKey: true })).toBe(false);

    await waitFor(() => {
      expect(tileFor(container, 5).scrollIntoView).toHaveBeenCalled();
    });
    expect(tileFor(container, 1).scrollIntoView).not.toHaveBeenCalled();
  });

  it("wraps to the first row instead of getting stuck once scrollTop hits its real maximum", async () => {
    // A scroll container can never reach `scrollTop === lastRow.top` when the
    // last row doesn't fill a full viewport height below it — scrollTop caps
    // out at scrollHeight - clientHeight, which sits short of that row's own
    // offset. Reproduces the reported "spam Tab, stuck at the bottom" bug.
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3),
      imageGridRow(4),
      imageGridRow(5),
      imageGridRow(6)
    ];
    const { container } = renderMediaReviewWithState(
      typeAllHookState({ rows })
    );
    const scrollArea = container.querySelector("[data-image-grid-scroll]");
    const input = screen.getByPlaceholderText("Tape une image...");

    setTileLayout(container, {
      1: { left: 0, top: 0 },
      2: { left: 160, top: 0 },
      3: { left: 0, top: 200 },
      4: { left: 160, top: 200 },
      5: { left: 0, top: 400 },
      6: { left: 160, top: 400 }
    });

    // maxScrollTop (204) sits short of row 5/6's top (400), the physically
    // unreachable last row, but ALSO clears row 3/4's top (200) — so the old
    // top-comparison scan masked the true last row behind the one before it
    // and could never anchor on the actual bottom.
    Object.defineProperties(scrollArea, {
      clientHeight: { configurable: true, value: 396 },
      scrollHeight: { configurable: true, value: 600 }
    });
    scrollArea.scrollTop = 204;
    input.focus();

    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);

    await waitFor(() => {
      expect(tileFor(container, 1).scrollIntoView).toHaveBeenCalled();
    });
  });

  it("uses Tab to scroll between type_all rows even when a thumbnail has focus", async () => {
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3),
      imageGridRow(4),
      imageGridRow(5),
      imageGridRow(6)
    ];
    const { container } = renderMediaReviewWithState(
      typeAllHookState({ rows })
    );
    const input = screen.getByPlaceholderText("Tape une image...");
    const thumbnail = tileFor(container, 1).querySelector('[tabindex="0"]');

    setTileLayout(container, {
      1: { left: 0, top: 0 },
      2: { left: 160, top: 0 },
      3: { left: 0, top: 200 },
      4: { left: 160, top: 200 },
      5: { left: 0, top: 400 },
      6: { left: 160, top: 400 }
    });

    thumbnail.focus();
    expect(document.activeElement).toBe(thumbnail);

    expect(fireEvent.keyDown(thumbnail, { key: "Tab" })).toBe(false);

    await waitFor(() => {
      expect(tileFor(container, 3).scrollIntoView).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("uses Tab to scroll between type_all rows when focus sits on a tile", async () => {
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3),
      imageGridRow(4),
      imageGridRow(5),
      imageGridRow(6)
    ];
    const { container } = renderMediaReviewWithState(
      typeAllHookState({ rows })
    );
    const input = screen.getByPlaceholderText("Tape une image...");

    setTileLayout(container, {
      1: { left: 0, top: 0 },
      2: { left: 160, top: 0 },
      3: { left: 0, top: 200 },
      4: { left: 160, top: 200 },
      5: { left: 0, top: 400 },
      6: { left: 160, top: 400 }
    });

    // A click inside a tile leaves focus on the grid rather than the input.
    expect(fireEvent.keyDown(tileFor(container, 1), { key: "Tab" })).toBe(false);

    await waitFor(() => {
      expect(tileFor(container, 3).scrollIntoView).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("leaves type_all tiles out of the tab order entirely", () => {
    const rows = [imageGridRow(1), imageGridRow(2)];
    const { container } = renderMediaReviewWithState(
      typeAllHookState({ rows })
    );

    expect(tileFor(container, 1).hasAttribute("tabindex")).toBe(false);
  });

  it("suppresses the default mousedown focus so clicking a thumbnail leaves no focus ring", () => {
    const rows = [imageGridRow(1), imageGridRow(2)];
    const { container } = renderMediaReviewWithState(
      typeAllHookState({ rows })
    );
    const thumbnail = tileFor(container, 1).querySelector('[tabindex="0"]');

    expect(fireEvent.mouseDown(thumbnail)).toBe(false);
  });

  it("does not auto-scroll for wrong or duplicate type_all answers", async () => {
    const rows = [
      imageGridRow(1, { isFound: true, quality: 2 }),
      imageGridRow(2),
      imageGridRow(3),
      imageGridRow(4)
    ];
    const { container, setHookState } = renderMediaReviewWithState(
      typeAllHookState({ rows, foundQuestionIds: [1] })
    );
    const input = screen.getByPlaceholderText("Tape une image...");

    setTileLayout(container, {
      1: { left: 0, top: 0 },
      2: { left: 160, top: 0 },
      3: { left: 0, top: 200 },
      4: { left: 160, top: 200 }
    });

    fireEvent.change(input, { target: { value: "wrong" } });
    fireEvent.keyDown(input, { key: "Enter" });
    setHookState(typeAllHookState({ rows, foundQuestionIds: [1] }));

    await waitFor(() => {
      expect(tileFor(container, 3).scrollIntoView).not.toHaveBeenCalled();
    });

    fireEvent.change(input, { target: { value: "Image 1" } });
    fireEvent.keyDown(input, { key: "Enter" });
    setHookState(typeAllHookState({ rows, foundQuestionIds: [1] }));

    await waitFor(() => {
      expect(tileFor(container, 3).scrollIntoView).not.toHaveBeenCalled();
    });
  });
});
