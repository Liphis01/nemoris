import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImageReview from "./ImageReview";
import { useImageReview } from "../hooks/useImageReview";
import {
  IMAGE_MODE_CLICK_PROMPT,
  IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
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
    isLockedMissed: false,
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

  it("uses Tab and Shift+Tab to select type_prompt images without moving focus", async () => {
    const selectNextItem = vi.fn();
    const rows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3)
    ];
    renderImageReviewWithState(
      typePromptHookState({
        rows,
        hookOverrides: {
          selectNextItem
        }
      })
    );
    const input = screen.getByPlaceholderText("Nom de l'image...");

    input.focus();

    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);
    expect(selectNextItem).toHaveBeenCalledWith(1);

    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });

    selectNextItem.mockClear();

    expect(fireEvent.keyDown(input, { key: "Tab", shiftKey: true })).toBe(false);
    expect(selectNextItem).toHaveBeenCalledWith(-1);
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

  it("scrolls to the next incomplete visual row when a type_all row is completed", async () => {
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
      expect(tileFor(container, 3).scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
        inline: "nearest"
      });
    });
    expect(tileFor(container, 1).scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not auto-scroll when a type_all row still has unfinished images", async () => {
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
      expect(tileFor(container, 1).scrollIntoView).not.toHaveBeenCalled();
      expect(tileFor(container, 3).scrollIntoView).not.toHaveBeenCalled();
    });
  });

  it("skips complete rows and wraps when auto-scrolling after type_all row completion", async () => {
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
      expect(tileFor(container, 5).scrollIntoView).toHaveBeenCalled();
    });

    const wrapInitialRows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3, { isFound: true, quality: 2 }),
      imageGridRow(4, { isFound: true, quality: 2 }),
      imageGridRow(5, { isFound: true, quality: 2 }),
      imageGridRow(6)
    ];
    const wrapCompletedRows = [
      imageGridRow(1),
      imageGridRow(2),
      imageGridRow(3, { isFound: true, quality: 2 }),
      imageGridRow(4, { isFound: true, quality: 2 }),
      imageGridRow(5, { isFound: true, quality: 2 }),
      imageGridRow(6, { isFound: true, quality: 2 })
    ];

    setHookState(typeAllHookState({
      rows: wrapInitialRows,
      foundQuestionIds: [3, 4, 5]
    }));
    setTileLayout(container, {
      1: { left: 0, top: 0 },
      2: { left: 160, top: 0 },
      3: { left: 0, top: 200 },
      4: { left: 160, top: 200 },
      5: { left: 0, top: 400 },
      6: { left: 160, top: 400 }
    });

    setHookState(typeAllHookState({
      rows: wrapCompletedRows,
      foundQuestionIds: [3, 4, 5, 6]
    }));

    await waitFor(() => {
      expect(tileFor(container, 1).scrollIntoView).toHaveBeenCalled();
    });
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
