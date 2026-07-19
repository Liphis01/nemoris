import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SequenceReview from "./SequenceReview";

function item(questionId, label, position, previousLabel = null) {
  return {
    question_id: questionId,
    question: label,
    answer: label,
    label,
    position,
    previous_label: previousLabel,
    aliases: [],
    tags: [],
    progress: {}
  };
}

const alpha = item(1, "Alpha", 1);
const beta = item(2, "Bêta", 2, "Alpha");
const gamma = item(3, "Gamma", 3, "Bêta");

function gradedResponse(results) {
  return { status: "ok", results };
}

function renderSequence(props = {}) {
  const submitAnswer = props.submitAnswer || vi.fn().mockResolvedValue(
    gradedResponse([])
  );

  render(
    <SequenceReview
      group={{ name: "Alphabet grec", length: 3, anchors: [] }}
      reviewItems={[alpha, beta, gamma]}
      contextItems={[alpha, beta, gamma]}
      mode="type_position"
      onAnsweringComplete={vi.fn()}
      onComplete={vi.fn()}
      {...props}
      submitAnswer={submitAnswer}
    />
  );

  return { submitAnswer };
}

afterEach(cleanup);

describe("SequenceReview", () => {
  it("posts the rank of the item the player names in type_position", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(
      gradedResponse([
        { question_id: 1, quality: 2, expected_position: 1, distance: 0 },
        { question_id: 2, quality: 1, expected_position: 2, distance: 1 },
        { question_id: 3, quality: 0, expected_position: 3, distance: null }
      ])
    );

    renderSequence({ submitAnswer });

    // Correct at rank 1; at rank 2 the player names the item that actually sits
    // at rank 3 (an off-by-one); rank 3 is left blank.
    fireEvent.change(screen.getByLabelText("Élément au rang 1"), {
      target: { value: "Alpha" }
    });
    fireEvent.change(screen.getByLabelText("Élément au rang 2"), {
      target: { value: "Gamma" }
    });

    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    await waitFor(() =>
      expect(submitAnswer).toHaveBeenCalledWith(
        {
          1: { position: 1 },
          2: { position: 3 },
          3: { position: null }
        },
        "type_position",
        3
      )
    );
  });

  it("matches answers case- and accent-insensitively", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(gradedResponse([]));

    renderSequence({ submitAnswer });

    fireEvent.change(screen.getByLabelText("Élément au rang 2"), {
      target: { value: "  beta " }
    });
    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    await waitFor(() =>
      expect(submitAnswer).toHaveBeenCalledWith(
        expect.objectContaining({ 2: { position: 2 } }),
        "type_position",
        3
      )
    );
  });

  it("prompts with the predecessor in next_in_sequence", () => {
    renderSequence({ mode: "next_in_sequence" });

    expect(screen.getByText("premier élément")).toBeInTheDocument();
    expect(screen.getByText("après « Alpha »")).toBeInTheDocument();
    expect(screen.getByText("après « Bêta »")).toBeInTheDocument();
  });

  it("reports the graded result and only fails the missed items", async () => {
    const onAnsweringComplete = vi.fn();
    const onComplete = vi.fn();
    const submitAnswer = vi.fn().mockResolvedValue(
      gradedResponse([
        { question_id: 1, quality: 2, expected_position: 1, distance: 0 },
        { question_id: 2, quality: 0, expected_position: 2, distance: 4 },
        { question_id: 3, quality: 1, expected_position: 3, distance: 1 }
      ])
    );

    renderSequence({ onAnsweringComplete, onComplete, submitAnswer });

    fireEvent.change(screen.getByLabelText("Élément au rang 1"), {
      target: { value: "Alpha" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    await waitFor(() => expect(onAnsweringComplete).toHaveBeenCalledWith([2]));

    expect(screen.getByText(/Exact !/)).toBeInTheDocument();
    expect(screen.getByText(/Presque.*1 rang d'écart/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));

    expect(onComplete).toHaveBeenCalledWith([2]);
  });

  it("posts the rank of the option picked in multiple_choice", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(gradedResponse([]));

    renderSequence({ mode: "multiple_choice", submitAnswer });

    // One card per due item; answering the last one auto-submits.
    for (let index = 0; index < 3; index += 1) {
      const options = document.querySelectorAll("[data-sequence-choice]");

      expect(options.length).toBeGreaterThan(1);
      fireEvent.click(options[0]);
    }

    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());

    const [positions, mode] = submitAnswer.mock.calls.at(-1);

    expect(mode).toBe("multiple_choice");
    expect(Object.keys(positions)).toHaveLength(3);
    Object.values(positions).forEach(guess => {
      expect(guess.position).toBeGreaterThanOrEqual(1);
      expect(guess.position).toBeLessThanOrEqual(3);
    });
  });

  it("draws every slot in reorder, showing anchors but never new items", () => {
    renderSequence({
      mode: "reorder",
      group: {
        name: "Alphabet grec",
        length: 5,
        // Rank 4 is a known peer; rank 5 belongs to an item that has never been
        // reviewed and must stay hidden.
        anchors: [{ question_id: 9, label: "Delta", position: 4 }]
      }
    });

    const slots = document.querySelectorAll("[data-sequence-slot]");
    const kinds = [...slots].map(slot => slot.dataset.sequenceSlot);

    expect(kinds).toEqual(["free", "free", "free", "anchor", "hidden"]);
    expect(screen.getByText("Delta")).toBeInTheDocument();
    // The unstarted item's label appears nowhere on the rail.
    expect(screen.queryByText("Epsilon")).not.toBeInTheDocument();
  });

  it("posts the slot each item was placed in", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(gradedResponse([]));

    renderSequence({ mode: "reorder", submitAnswer });

    // jsdom cannot drive HTML5 drag events, so the click-to-place fallback is
    // what is exercised here -- and it is the only reason this is testable.
    function place(label, position) {
      fireEvent.click(
        screen.getByRole("button", { name: label })
      );
      fireEvent.click(
        document.querySelector(`[data-sequence-slot-position="${position}"]`)
      );
    }

    place("Alpha", 1);
    place("Bêta", 3);
    place("Gamma", 2);

    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    await waitFor(() =>
      expect(submitAnswer).toHaveBeenCalledWith(
        {
          1: { position: 1 },
          2: { position: 3 },
          3: { position: 2 }
        },
        "reorder",
        3
      )
    );
  });
});
