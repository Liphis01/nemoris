import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImageReview from "./ImageReview";
import { useImageReview } from "../hooks/useImageReview";

vi.mock("../hooks/useImageReview", () => ({
  useImageReview: vi.fn()
}));

const noop = vi.fn();

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

function mockImageReviewState({ resultMode = false, rowOverrides = {} } = {}) {
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
    activeQuestionId: row.item.question_id,
    answeredCount: row.isFound ? 1 : 0,
    feedbackTone: "",
    finishReview: noop,
    gridItems: [row],
    handleSubmit: noop,
    input: "",
    progressPercent: row.isFound ? 100 : 0,
    remainingCount: row.isFound ? 0 : 1,
    resultMode,
    selectItem: noop,
    selectNextItem: noop,
    sendResult: noop,
    setInput: noop,
    setQuality: noop
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
});
