import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
  IMAGE_MODE_TYPE_PROMPT
} from "../imageModes";
import MediaReview from "./MediaReview";
import ReviewQuestionRenderer from "./ReviewQuestionRenderer";

vi.mock("./MediaReview", () => ({
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
    type_q: "media",
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
      submitMediaAnswer={noop}
      submitTimelineAnswer={noop}
      {...props}
    />
  );
}

function lastMediaReviewProps() {
  return MediaReview.mock.calls.at(-1)[0];
}

describe("ReviewQuestionRenderer image review props", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("enables the resolved split for type_prompt in review and training", () => {
    const mode = IMAGE_MODE_TYPE_PROMPT;

    renderRenderer({
      q: imageQuestion(mode),
      trainingMode: false
    });

    expect(lastMediaReviewProps()).toMatchObject({
      mode,
      separateResolvedItems: true,
      showQualityControls: true
    });

    cleanup();
    MediaReview.mockClear();

    renderRenderer({
      q: imageQuestion(mode),
      trainingMode: true
    });

    expect(lastMediaReviewProps()).toMatchObject({
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

    expect(lastMediaReviewProps()).toMatchObject({
      mode: IMAGE_MODE_MULTIPLE_CHOICE_IMAGE,
      separateResolvedItems: false
    });
  });

  it("prefers presentation_kind when choosing the renderer", () => {
    renderRenderer({
      q: {
        ...imageQuestion(IMAGE_MODE_TYPE_PROMPT),
        presentation_kind: "media_group",
        type_q: "text"
      }
    });

    expect(MediaReview).toHaveBeenCalled();
    expect(lastMediaReviewProps()).toMatchObject({
      mode: IMAGE_MODE_TYPE_PROMPT
    });
  });
});
