import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImageReview from "./ImageReview";
import { useImageReview } from "../hooks/useImageReview";
import {
  IMAGE_MODE_CLICK_PROMPT,
  IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
  IMAGE_MODE_MULTIPLE_CHOICE_LABEL,
  IMAGE_MODE_TYPE_ALL,
  IMAGE_MODE_TYPE_PROMPT
} from "../imageModes";

vi.mock("../hooks/useImageReview", () => ({
  useImageReview: vi.fn()
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

function mockImageReviewState({
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

  useImageReview.mockReturnValue({
    activeQuestionId: row.isActive ? row.item.question_id : null,
    answeredCount: row.isFound ? 1 : 0,
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

function renderImageReview(props = {}) {
  return render(
    <ImageReview
      group={{ name: "Images" }}
      reviewItems={[{ question_id: 1 }]}
      onComplete={noop}
      submitAnswer={noop}
      {...props}
    />
  );
}

function renderImageReviewWithState(initialState) {
  let hookState = initialState;
  const props = {
    reviewItems: hookState.gridItems.map(row => row.item)
  };

  useImageReview.mockImplementation(() => hookState);

  const rendered = renderImageReview(props);

  return {
    ...rendered,
    setHookState(nextState) {
      hookState = nextState;
      rendered.rerender(
        <ImageReview
          group={{ name: "Images" }}
          reviewItems={props.reviewItems}
          onComplete={noop}
          submitAnswer={noop}
        />
      );
    }
  };
}

function typeAllHookState({ rows, foundQuestionIds = [] }) {
  return {
    activeQuestionId: null,
    answeredCount: foundQuestionIds.length,
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
    resultMode: false,
    selectItem: noop,
    selectNextItem: noop,
    sendResult: noop,
    setInput: noop,
    setQuality: noop,
    skipCurrentPrompt: noop,
    wrongAnsweredCount: 0
  };
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
  mode = IMAGE_MODE_CLICK_PROMPT,
  activeQuestionId = rows[0]?.item.question_id || null,
  hookOverrides = {}
}) {
  const gridItems = rows.map(row => ({
    ...row,
    isActive: row.item.question_id === activeQuestionId
  }));
  const activeRow = gridItems.find(row => row.isActive) || gridItems[0] || null;

  return {
    activeQuestionId,
    answeredCount: 0,
    choiceOptions: [],
    currentPromptItem: activeRow?.item || null,
    feedbackTone: "",
    finishReview: noop,
    foundQuestionIds: [],
    gridItems,
    handleChoiceSelect: noop,
    handleImageSelect: noop,
    handleSubmit: noop,
    input: "",
    interactionFeedback: null,
    mode,
    promptLabel: activeRow?.item?.label || activeRow?.item?.answer || "",
    progressPercent: 0,
    remainingCount: gridItems.length,
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

describe("ImageReview answer label preview", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the full answer on hover when the revealed label overflows", async () => {
    const row = mockImageReviewState();
    renderImageReview();
    const label = screen.getByText(row.item.label);

    setElementWidth(label, { clientWidth: 80, scrollWidth: 240 });
    fireEvent.pointerEnter(label);

    const tooltip = await screen.findByRole("tooltip");

    expect(tooltip).toHaveTextContent(row.item.label);
  });

  it("does not show a tooltip when the revealed label fits", async () => {
    const row = mockImageReviewState();
    renderImageReview();
    const label = screen.getByText(row.item.label);

    setElementWidth(label, { clientWidth: 240, scrollWidth: 240 });
    fireEvent.pointerEnter(label);

    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("does not reveal hidden answers even when the label would overflow", async () => {
    const row = mockImageReviewState({
      rowOverrides: {
        isFound: false
      }
    });
    const { container } = renderImageReview();
    const hiddenLabel = container.querySelector("[data-image-answer-label]");

    setElementWidth(hiddenLabel, { clientWidth: 80, scrollWidth: 240 });
    fireEvent.pointerEnter(hiddenLabel);

    expect(screen.queryByText(row.item.label)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("shows the training timer while answering image groups", () => {
    mockImageReviewState();
    renderImageReview({
      trainingElapsedMs: 12345,
      trainingBestTimeMs: 90000
    });

    expect(screen.getByText("Temps")).toBeInTheDocument();
    expect(screen.getByText("12s")).toBeInTheDocument();
    expect(screen.getByText("Meilleur")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();
  });

  it("shows image misses as a striped progress bar segment", () => {
    mockImageReviewState({
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
    const { container } = renderImageReview();

    expect(container.querySelector("[data-image-progress-correct]"))
      .toHaveStyle({ width: "0%" });
    expect(container.querySelector("[data-image-progress-wrong]"))
      .toHaveStyle({ width: "100%" });
    expect(container.querySelector("[data-image-progress-wrong]").style.background)
      .toContain("repeating-linear-gradient");
    expect(screen.getByRole("progressbar", { name: "Progression" }))
      .toHaveAttribute("aria-valuenow", "1");
  });

  it("does not show a next-image control in type_all mode", () => {
    mockImageReviewState({
      mode: IMAGE_MODE_TYPE_ALL,
      rowOverrides: {
        isActive: false,
        isFound: false
      }
    });
    renderImageReview();

    expect(screen.queryByText("Image suivante")).not.toBeInTheDocument();
    expect(screen.getByText("Terminer")).toBeInTheDocument();
  });

  it("uses a viewport-bounded shell with only the image pane scrolling", () => {
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3)
    ];
    const { container } = renderImageReviewWithState(
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

    useImageReview.mockReturnValue(typeAllHookState({ rows }));
    const { container } = renderImageReview({
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
    expect(header).toHaveTextContent("Progression");
    expect(header).not.toHaveTextContent("Flags");
    expect(header).not.toHaveTextContent("IMAGE");
    expect(header).not.toHaveTextContent("Tout taper");
    expect(header).not.toHaveTextContent("Temps");
    expect(screen.getByRole("progressbar", { name: "Progression" }))
      .toBeInTheDocument();
    expect(scrollPane).toHaveClass("app-scrollbar");
    expect(scrollPane).toHaveStyle({
      overflow: "auto",
      minHeight: "0"
    });
    expect(activeGrid.style.gridTemplateColumns)
      .toContain("minmax(190px, 1fr)");
    expect(firstTile).toHaveStyle({
      gridTemplateRows: "154px minmax(22px, auto) auto",
      minHeight: "212px"
    });
  });

  it("does not show the type_prompt prompt card", () => {
    renderImageReviewWithState(typePromptHookState({
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
    const { container } = renderImageReviewWithState(
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

  it("uses Tab to skip and Shift+Tab to select previous type_prompt images without moving focus", async () => {
    const selectNextItem = vi.fn();
    const skipCurrentPrompt = vi.fn();
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3)
    ];
    renderImageReviewWithState(
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
    expect(skipCurrentPrompt).toHaveBeenCalledTimes(1);
    expect(selectNextItem).not.toHaveBeenCalled();

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
    const { container } = renderImageReviewWithState(
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

  it.each([
    IMAGE_MODE_CLICK_PROMPT,
    IMAGE_MODE_MULTIPLE_CHOICE_IMAGE
  ])("keeps zoom separate from image selection in %s mode", (mode) => {
    const handleImageSelect = vi.fn();
    const rows = [
      imageGridRow(1),
      imageGridRow(2)
    ];
    const { container } = renderImageReviewWithState(
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
    const { container } = renderImageReviewWithState(
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
    expect(controlBand).toHaveTextContent("Image demandée");
    expect(controlBand).toHaveTextContent("Image 1");
    expect(scrollPane).not.toHaveTextContent("Image demandée");
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

  it("reveals skipped type_prompt image answers on their tiles", () => {
    const rows = [
      imageGridRow(1, {
        isMissed: true,
        isRevealed: true
      }),
      imageGridRow(2)
    ];
    const { container } = renderImageReviewWithState(
      typePromptHookState({
        rows,
        activeQuestionId: 2,
        resolvedQuestionIds: [1]
      })
    );
    const skippedTile = tileFor(container, 1);

    expect(skippedTile).toHaveAttribute("data-image-feedback", "missed");
    expect(skippedTile).toHaveAttribute("data-image-revealed", "true");
    expect(skippedTile).toHaveTextContent("Image 1");
  });

  it("reveals only the target image during wrong click_prompt feedback", () => {
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
    const { container } = renderImageReviewWithState(
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

  it("shows correct and wrong labels immediately in multiple_choice_label and scrolls to the target", async () => {
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
    const { container, setHookState } = renderImageReviewWithState(initialState);

    setTileLayout(container, {
      1: { left: 0, top: 0 },
      2: { left: 160, top: 0 },
      3: { left: 0, top: 200 },
      4: { left: 160, top: 200 }
    });

    fireEvent.click(screen.getByRole("button", { name: "Image 2" }));

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
      expect(tileFor(container, 1).scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      });
    });
    expect(screen.getByText("Correct").closest("button").style.border)
      .toContain("solid");
    expect(screen.getByText("Faux").closest("button").style.background)
      .toContain("repeating-linear-gradient");
    expect(screen.getByText("Faux").closest("button").style.border)
      .toContain("dashed");
    expect(tileFor(container, 1)).toHaveTextContent("Image 1");
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
    const { container } = renderImageReviewWithState(
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

  it("separates found images from the active grid while answering", () => {
    const rows = [
      imageGridRow(1, { isFound: true, quality: 2 }),
      imageGridRow(2),
      imageGridRow(3, { isFound: true, quality: 2 })
    ];
    useImageReview.mockReturnValue(
      typeAllHookState({ rows, foundQuestionIds: [1, 3] })
    );
    const { container } = renderImageReview({
      reviewItems: rows.map(row => row.item),
      separateFoundItems: true
    });
    const activeGrid = container.querySelector("[data-image-active-grid]");
    const foundSection = container.querySelector("[data-image-found-section]");

    expect(activeGrid.querySelector('[data-image-question-id="1"]'))
      .not.toBeInTheDocument();
    expect(activeGrid.querySelector('[data-image-question-id="2"]'))
      .toBeInTheDocument();
    expect(activeGrid.querySelector('[data-image-question-id="3"]'))
      .not.toBeInTheDocument();
    expect(foundSection.querySelector('[data-image-question-id="1"]'))
      .toBeInTheDocument();
    expect(foundSection.querySelector('[data-image-question-id="3"]'))
      .toBeInTheDocument();
  });

  it("keeps the full grid together in image result mode", () => {
    const rows = [
      imageGridRow(1, { isFound: true, quality: 2 }),
      imageGridRow(2, { isLockedMissed: true, quality: 0 })
    ];
    useImageReview.mockReturnValue({
      ...typeAllHookState({ rows, foundQuestionIds: [1] }),
      resultMode: true,
      wrongAnsweredCount: 1
    });
    const { container } = renderImageReview({
      reviewItems: rows.map(row => row.item),
      separateFoundItems: true
    });
    const activeGrid = container.querySelector("[data-image-active-grid]");

    expect(container.querySelector("[data-image-found-section]"))
      .not.toBeInTheDocument();
    expect(activeGrid.querySelector('[data-image-question-id="1"]'))
      .toBeInTheDocument();
    expect(activeGrid.querySelector('[data-image-question-id="2"]'))
      .toBeInTheDocument();
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
    const { container, setHookState } = renderImageReviewWithState(
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
    const { container, setHookState } = renderImageReviewWithState(
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
    const { container, setHookState } = renderImageReviewWithState(
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
    const { container } = renderImageReviewWithState(
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

  it("does not auto-scroll for wrong or duplicate type_all answers", async () => {
    const rows = [
      imageGridRow(1, { isFound: true, quality: 2 }),
      imageGridRow(2),
      imageGridRow(3),
      imageGridRow(4)
    ];
    const { container, setHookState } = renderImageReviewWithState(
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
