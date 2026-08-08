import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import SequenceReview from "./SequenceReview";

function item(questionId, label, position) {
  return {
    question_id: questionId,
    question: label,
    answer: label,
    label,
    position,
    aliases: [],
    tags: [],
    progress: {}
  };
}

function slot(position, kind, questionId, label) {
  return {
    position,
    kind,
    question_id: questionId,
    ...(label ? { label } : {})
  };
}

function gradedResponse(results) {
  return { status: "ok", committed: false, results };
}

const defaultItems = [
  item(1, "Alpha", 1),
  item(2, "Bêta", 2),
  item(3, "Gamma", 3)
];

function renderSequence({
  mode = "type_position",
  reviewItems = defaultItems,
  contextItems = defaultItems,
  rail = [
    slot(1, "blank", 1),
    slot(2, "blank", 2),
    slot(3, "blank", 3)
  ],
  submitAnswer = vi.fn().mockResolvedValue(gradedResponse([])),
  onAnsweringComplete = vi.fn(),
  onComplete = vi.fn(),
  showQualityControls = true
} = {}) {
  render(
    <SequenceReview
      group={{ group_id: 7, name: "Alphabet grec", length: 3, rail }}
      reviewItems={reviewItems}
      contextItems={contextItems}
      mode={mode}
      onAnsweringComplete={onAnsweringComplete}
      onComplete={onComplete}
      submitAnswer={submitAnswer}
      showQualityControls={showQualityControls}
    />
  );

  return { submitAnswer, onAnsweringComplete, onComplete };
}

describe("SequenceReview", () => {
  it("posts the rank of the item the player names in type_position", async () => {
    const { submitAnswer } = renderSequence();

    fireEvent.change(screen.getByLabelText("Élément au rang 1"), {
      target: { value: "Alpha" }
    });
    fireEvent.change(screen.getByLabelText("Élément au rang 2"), {
      target: { value: "Gamma" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());

    const [payload, mode] = submitAnswer.mock.calls[0];

    expect(mode).toBe("type_position");
    expect(payload.items).toEqual({
      1: { position: 1 },
      2: { position: 3 },
      3: { position: null }
    });
  });

  it("matches answers case- and accent-insensitively", async () => {
    const { submitAnswer } = renderSequence();

    fireEvent.change(screen.getByLabelText("Élément au rang 2"), {
      target: { value: "  beta " }
    });
    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
    expect(submitAnswer.mock.calls[0][0].items[2]).toEqual({ position: 2 });
  });

  it("grades without scheduling, then commits on Continuer", async () => {
    // Two phases exist so the learner can refine a hit before anything is
    // written. The first call must not schedule.
    const submitAnswer = vi.fn().mockResolvedValue(
      gradedResponse([
        { question_id: 1, quality: 2, expected_position: 1, distance: 0, label: "Alpha" }
      ])
    );
    const { onComplete } = renderSequence({ submitAnswer });

    fireEvent.change(screen.getByLabelText("Élément au rang 1"), {
      target: { value: "Alpha" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    await screen.findByRole("button", { name: /Continuer/ });
    expect(submitAnswer.mock.calls[0][0].commit).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(submitAnswer.mock.calls[1][0].commit).toBe(true);
  });

  it("lets a hit be bumped to Facile and posts the chosen quality", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(
      gradedResponse([
        { question_id: 1, quality: 2, expected_position: 1, distance: 0, label: "Alpha" }
      ])
    );
    renderSequence({ submitAnswer });

    fireEvent.change(screen.getByLabelText("Élément au rang 1"), {
      target: { value: "Alpha" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    fireEvent.click(await screen.findByRole("button", { name: "Facile" }));
    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }));

    await waitFor(() => expect(submitAnswer).toHaveBeenCalledTimes(2));
    expect(submitAnswer.mock.calls[1][0].items[1].quality).toBe(3);
  });

  it("offers no quality control on a miss", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(
      gradedResponse([
        { question_id: 1, quality: 0, expected_position: 1, distance: 2, label: "Alpha" }
      ])
    );
    renderSequence({ submitAnswer });

    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    await screen.findByRole("button", { name: /Continuer/ });
    expect(document.querySelector("[data-sequence-quality-bar]")).toBeNull();
  });

  it("keeps the recap on screen when the commit fails", async () => {
    // The old behaviour swallowed the error and reported a clean sweep,
    // silently losing the whole chunk's answers.
    const submitAnswer = vi
      .fn()
      .mockResolvedValueOnce(
        gradedResponse([
          { question_id: 1, quality: 2, expected_position: 1, distance: 0, label: "Alpha" }
        ])
      )
      .mockRejectedValueOnce(new Error("offline"));
    const { onComplete } = renderSequence({ submitAnswer });

    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Continuer/ }));

    await screen.findByText(/L'enregistrement a échoué/);
    expect(onComplete).not.toHaveBeenCalled();
  });

  describe("the rail", () => {
    const railWithContext = [
      slot(1, "blank", 1),
      slot(2, "anchor", 9, "Delta"),
      slot(3, "hidden", 10)
    ];

    it("never shows the label of an item awaiting its first review", () => {
      renderSequence({ mode: "gap_fill", rail: railWithContext });

      expect(screen.getByText("Delta")).toBeInTheDocument();
      expect(document.querySelectorAll("[data-sequence-slot]").length).toBe(3);
      expect(
        [...document.querySelectorAll("[data-sequence-slot]")].map(
          node => node.dataset.sequenceSlot
        )
      ).toEqual(["blank", "anchor", "hidden"]);
    });

    it("makes a decoy indistinguishable from a real blank while answering", () => {
      // The entire anti-elimination measure rests on this: if the DOM says
      // which blanks count, the learner reads it and subtraction is back.
      renderSequence({
        mode: "gap_fill",
        rail: [slot(1, "blank", 1), slot(2, "decoy", 9, "Delta")]
      });

      expect(
        [...document.querySelectorAll("[data-sequence-slot]")].map(
          node => node.dataset.sequenceSlot
        )
      ).toEqual(["blank", "blank"]);
    });

    it("posts only the real blanks, never the decoys", async () => {
      const { submitAnswer } = renderSequence({
        mode: "gap_fill",
        rail: [slot(1, "blank", 1), slot(2, "decoy", 9, "Bêta")]
      });

      fireEvent.change(screen.getByLabelText("Élément au rang 1"), {
        target: { value: "Alpha" }
      });
      fireEvent.change(screen.getByLabelText("Élément au rang 2"), {
        target: { value: "Bêta" }
      });
      fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

      await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
      expect(Object.keys(submitAnswer.mock.calls[0][0].items)).toEqual(["1"]);
    });

    it("marks a break between windowed runs", () => {
      renderSequence({
        mode: "gap_fill",
        rail: [slot(1, "blank", 1), slot(8, "blank", 8)]
      });

      expect(document.querySelector("[data-sequence-rail-gap]")).not.toBeNull();
    });

    it("posts the rail so the server can grade the ordering", async () => {
      const rail = [slot(1, "blank", 1), slot(2, "anchor", 9, "Delta")];
      const { submitAnswer } = renderSequence({ mode: "gap_fill", rail });

      fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

      await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
      expect(submitAnswer.mock.calls[0][0].rail).toEqual([
        { position: 1, kind: "blank" },
        { position: 2, kind: "anchor" }
      ]);
    });
  });

  it("posts the slot each item was placed in for reorder", async () => {
    // jsdom cannot drive HTML5 drag events, so the click-to-place fallback is
    // what is exercised here -- and it is the only reason this is testable.
    const { submitAnswer } = renderSequence({ mode: "reorder" });

    const place = (label, position) => {
      fireEvent.click(screen.getByRole("button", { name: label }));
      fireEvent.click(
        document.querySelector(`[data-sequence-slot-position="${position}"]`)
      );
    };

    place("Alpha", 1);
    place("Bêta", 3);
    place("Gamma", 2);

    fireEvent.click(screen.getByRole("button", { name: /Valider/ }));

    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
    expect(submitAnswer.mock.calls[0][0].items).toEqual({
      1: { position: 1 },
      2: { position: 3 },
      3: { position: 2 }
    });
  });

  it("posts the rank of the option picked in multiple_choice", async () => {
    const { submitAnswer } = renderSequence({ mode: "multiple_choice" });

    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(document.querySelectorAll("[data-sequence-choice]")[0]);
    }

    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());

    const posted = submitAnswer.mock.calls[0][0].items;

    expect(Object.keys(posted)).toHaveLength(3);
    Object.values(posted).forEach(entry => {
      expect(entry.position).toBeGreaterThanOrEqual(1);
      expect(entry.position).toBeLessThanOrEqual(3);
    });
  });

  describe("recite", () => {
    const reciteRail = [
      slot(1, "anchor", 9, "Delta"),
      slot(2, "blank", 2),
      slot(3, "blank", 3)
    ];

    it("posts the produced run and where it started", async () => {
      const { submitAnswer } = renderSequence({
        mode: "recite",
        rail: reciteRail
      });

      fireEvent.change(screen.getByLabelText("Élément suivant"), {
        target: { value: "Bêta" }
      });
      fireEvent.keyDown(screen.getByLabelText("Élément suivant"), {
        key: "Enter"
      });
      fireEvent.change(screen.getByLabelText("Élément suivant"), {
        target: { value: "Gamma" }
      });
      fireEvent.keyDown(screen.getByLabelText("Élément suivant"), {
        key: "Enter"
      });

      await waitFor(() => expect(submitAnswer).toHaveBeenCalled());

      const payload = submitAnswer.mock.calls[0][0];

      expect(payload.run).toEqual([2, 3]);
      expect(payload.runStart).toBe(1);
      expect(payload.groupId).toBe(7);
    });

    it("stops at the first stall rather than asking for the rest", async () => {
      const { submitAnswer } = renderSequence({
        mode: "recite",
        rail: reciteRail
      });

      fireEvent.change(screen.getByLabelText("Élément suivant"), {
        target: { value: "pas dans la liste" }
      });
      fireEvent.keyDown(screen.getByLabelText("Élément suivant"), {
        key: "Enter"
      });

      await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
      expect(submitAnswer.mock.calls[0][0].run).toEqual([-1]);
    });

    it("lets the learner declare the stall", async () => {
      const { submitAnswer } = renderSequence({
        mode: "recite",
        rail: reciteRail
      });

      fireEvent.click(screen.getByRole("button", { name: "Je bloque" }));

      await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
      expect(submitAnswer.mock.calls[0][0].run).toEqual([]);
    });
  });
});
