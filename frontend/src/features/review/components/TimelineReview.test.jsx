import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TimelineReview from "./TimelineReview";

const dayItem = {
  progress: {},
  question: "Révolution française",
  question_id: 1,
  timeline: {
    kind: "point",
    start: { day: 14, month: 7, precision: "day", year: 1789 }
  }
};

function yearItem(year, question = "Évènement", questionId = 9) {
  return {
    progress: {},
    question,
    question_id: questionId,
    timeline: {
      kind: "point",
      start: { day: null, month: null, precision: "year", year }
    }
  };
}

function renderReview(props = {}) {
  const submitAnswer = props.submitAnswer || vi.fn();

  render(
    <TimelineReview
      fillAvailableHeight
      group={props.group || {}}
      onAnsweringComplete={props.onAnsweringComplete || vi.fn()}
      onComplete={props.onComplete || vi.fn()}
      reviewItems={props.reviewItems || [dayItem]}
      submitAnswer={submitAnswer}
    />
  );

  return { submitAnswer };
}

describe("TimelineReview", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders only the rails the question's precision requires", () => {
    renderReview({ reviewItems: [yearItem(1850)] });

    expect(screen.getByTestId("timeline-year-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-month-rail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timeline-day-rail")).not.toBeInTheDocument();
  });

  it("renders the full year/month/day cascade for a day-precision question", () => {
    renderReview();

    expect(screen.getByTestId("timeline-year-rail")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-month-rail")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-day-rail")).toBeInTheDocument();
  });

  it("refuses to validate until every required unit has been chosen", () => {
    const { submitAnswer } = renderReview();

    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    expect(submitAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Valider/ })).toBeDisabled();
  });

  it("reveals on validate but only records the final quality on continue", async () => {
    const submitAnswer = vi.fn().mockResolvedValue({});

    renderReview({ submitAnswer });

    const input = screen.getByLabelText("Saisir la date");

    fireEvent.change(input, { target: { value: "14/07/1789" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("timeline-answer")).toHaveTextContent("14/07/1789");

    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    // The reveal is client-graded; nothing is recorded until the card is advanced.
    await screen.findByText("Exact !");
    expect(submitAnswer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));

    // 14/07/1789 is exactly the answer -> auto Good (2), sent on continue.
    await waitFor(() => expect(submitAnswer).toHaveBeenCalledWith({
      1: { start: { day: 14, month: 7, precision: "day", year: 1789 }, quality: 2 }
    }));
  });

  it("reveals the correction from a client-side grade and records the miss on continue", async () => {
    const onAnsweringComplete = vi.fn();
    const onComplete = vi.fn();
    const submitAnswer = vi.fn().mockResolvedValue({});

    renderReview({
      onAnsweringComplete,
      onComplete,
      reviewItems: [yearItem(1850)],
      submitAnswer
    });

    fireEvent.change(screen.getByLabelText("Saisir la date"), { target: { value: "1800" } });
    fireEvent.keyDown(screen.getByLabelText("Saisir la date"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    const feedback = await waitFor(() => {
      const bar = document.querySelector("[data-timeline-feedback]");

      expect(bar).not.toBeNull();

      return bar;
    });

    // Both the verdict and the directioned gap are computed on the client now.
    expect(feedback).toHaveAttribute("data-timeline-feedback", "wrong");
    expect(feedback).toHaveTextContent("Raté");
    expect(feedback).toHaveTextContent("1850");
    expect(feedback).toHaveTextContent("50 ans trop tôt");
    // A miss offers no quality adjustment.
    expect(document.querySelector("[data-timeline-quality-bar]")).toBeNull();
    expect(onAnsweringComplete).toHaveBeenCalledWith([9]);

    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));

    await waitFor(() => expect(submitAnswer).toHaveBeenCalledWith({
      9: { start: { day: null, month: null, precision: "year", year: 1800 }, quality: 0 }
    }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith([9]));
  });

  it("lets a hit be bumped to Facile and records the chosen quality", async () => {
    const submitAnswer = vi.fn().mockResolvedValue({});

    renderReview({ reviewItems: [yearItem(1850)], submitAnswer });

    fireEvent.change(screen.getByLabelText("Saisir la date"), { target: { value: "1850" } });
    fireEvent.keyDown(screen.getByLabelText("Saisir la date"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    // An exact answer auto-grades Good; the learner upgrades it to Facile.
    fireEvent.click(await screen.findByRole("button", { name: /Facile/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));

    await waitFor(() => expect(submitAnswer).toHaveBeenCalledWith({
      9: { start: { day: null, month: null, precision: "year", year: 1850 }, quality: 3 }
    }));
  });

  it("renders curated landmark anchors on the global track", () => {
    renderReview({ reviewItems: [yearItem(1850)] });

    expect(screen.getByText("Révolution française")).toBeInTheDocument();
  });

  it("never shows a landmark anchor that coincides with a session answer", () => {
    renderReview();

    // The only "Révolution française" text is the question title — the coinciding
    // 1789 anchor is filtered out so the answer is never revealed.
    expect(screen.getAllByText("Révolution française")).toHaveLength(1);
  });

  it("renders mastered-card anchors from the group payload", () => {
    renderReview({
      group: {
        anchors: [{
          id: "mastered-50",
          label: "Mon évènement maîtrisé",
          source: "mastered",
          start: { day: null, month: null, precision: "year", year: 1850 },
          tier: 1
        }]
      },
      reviewItems: [yearItem(1500, "Question de session")]
    });

    expect(screen.getByText("Mon évènement maîtrisé")).toBeInTheDocument();
  });

  it("dedupes a mastered anchor that coincides with a curated landmark", () => {
    renderReview({
      group: {
        anchors: [{
          id: "mastered-51",
          label: "Ma carte de 1789",
          source: "mastered",
          start: { day: null, month: null, precision: "year", year: 1789 },
          tier: 1
        }]
      },
      reviewItems: [yearItem(1500, "Question de session")]
    });

    expect(screen.queryByText("Ma carte de 1789")).not.toBeInTheDocument();
    expect(screen.getByText("Révolution française")).toBeInTheDocument();
  });

  it("suppresses a mastered anchor that coincides with a session answer", () => {
    renderReview({
      group: {
        anchors: [{
          id: "mastered-52",
          label: "Carte sur la réponse",
          source: "mastered",
          start: { day: null, month: null, precision: "year", year: 1500 },
          tier: 1
        }]
      },
      reviewItems: [yearItem(1500, "Question de session")]
    });

    expect(screen.queryByText("Carte sur la réponse")).not.toBeInTheDocument();
  });
});
