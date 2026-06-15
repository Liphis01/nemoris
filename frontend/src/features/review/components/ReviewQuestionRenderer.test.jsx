import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_MODE_CLICK_PROMPT,
  IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
  IMAGE_MODE_TYPE_PROMPT
} from "../imageModes";
import ImageReview from "./ImageReview";
import ReviewQuestionRenderer from "./ReviewQuestionRenderer";

vi.mock("./ImageReview", () => ({
  default: vi.fn(() => null)
}));

vi.mock("./MapReview", () => ({
  default: vi.fn(() => null)
}));

vi.mock("./TimelineReview", () => ({
  default: vi.fn(() => null)
}));

vi.mock("./TextReviewCard", () => ({
  default: vi.fn(() => null)
}));

const noop = vi.fn();

function imageQuestion(mode) {
  return {
    type_q: "image",
    mode,
    items: [
      {
        question_id: 1,
        answer: "France",
        label: "France",
        media: "/static/france.png"
      }
    ]
  };
}

function renderRenderer(props = {}) {
  return render(
    <ReviewQuestionRenderer
      q={imageQuestion(IMAGE_MODE_TYPE_PROMPT)}
      currentIndex={0}
      showAnswer={false}
      setShowAnswer={noop}
      handleTextAnswer={noop}
      currentTextQuality={null}
      selectedTextQuality={null}
      handleMapComplete={noop}
      handleImageComplete={noop}
      handleTimelineComplete={noop}
      submitMapAnswer={noop}
      submitImageAnswer={noop}
      submitTimelineAnswer={noop}
      {...props}
    />
  );
}

function lastImageReviewProps() {
  return ImageReview.mock.calls.at(-1)[0];
}

describe("ReviewQuestionRenderer image review props", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    IMAGE_MODE_CLICK_PROMPT,
    IMAGE_MODE_TYPE_PROMPT
  ])("enables the resolved split for %s in review and training", (mode) => {
    renderRenderer({
      q: imageQuestion(mode),
      trainingMode: false
    });

    expect(lastImageReviewProps()).toMatchObject({
      mode,
      separateResolvedItems: true,
      showQualityControls: true
    });

    cleanup();
    ImageReview.mockClear();

    renderRenderer({
      q: imageQuestion(mode),
      trainingMode: true
    });

    expect(lastImageReviewProps()).toMatchObject({
      mode,
      separateResolvedItems: true,
      showQualityControls: false
    });
  });

  it("keeps multiple_choice_image choices together", () => {
    renderRenderer({
      q: imageQuestion(IMAGE_MODE_MULTIPLE_CHOICE_IMAGE),
      trainingMode: true
    });

    expect(lastImageReviewProps()).toMatchObject({
      mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
      separateResolvedItems: false
    });
  });
});
