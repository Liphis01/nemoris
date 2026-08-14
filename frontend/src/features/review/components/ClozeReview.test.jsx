import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClozeReview from "./ClozeReview";

const group = {
  group_id: 4,
  name: "Géographie",
  masked_source: "La capitale est [ … ].",
  items: [{ question_id: 8 }]
};

describe("ClozeReview", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("focuses the typed answer, previews on Enter, then commits the chosen difficulty", async () => {
    const submitAnswer = vi.fn()
      .mockResolvedValueOnce({ correct: true, expected: "Paris", source: "La capitale est [ … ]." })
      .mockResolvedValueOnce({ correct: true, progress: {} });
    const onComplete = vi.fn();

    render(<ClozeReview group={group} submitAnswer={submitAnswer} onComplete={onComplete} />);

    const input = screen.getByPlaceholderText("Ta réponse");
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "Paris" } });
    fireEvent.submit(input.closest("form"));

    await screen.findByText("Bonne réponse");
    expect(submitAnswer).toHaveBeenCalledWith({ groupId: 4, questionId: 8, answer: "Paris", commit: false });

    fireEvent.click(screen.getByRole("button", { name: "Facile" }));
    await waitFor(() => expect(submitAnswer).toHaveBeenLastCalledWith({
      groupId: 4,
      questionId: 8,
      answer: "Paris",
      quality: 3,
      commit: true
    }));
    expect(onComplete).toHaveBeenCalledWith([]);
  });

  it("reveals a server correction and queues an incorrect card for another pass", async () => {
    const submitAnswer = vi.fn()
      .mockResolvedValueOnce({ correct: false, expected: "Paris", source: "La capitale est [ … ]." })
      .mockResolvedValueOnce({ correct: false, progress: {} });
    const onComplete = vi.fn();

    render(<ClozeReview group={group} submitAnswer={submitAnswer} onComplete={onComplete} />);
    fireEvent.change(screen.getByPlaceholderText("Ta réponse"), { target: { value: "Lyon" } });
    fireEvent.click(screen.getByRole("button", { name: "Vérifier" }));

    await screen.findByText("Réponse attendue : Paris");
    fireEvent.click(screen.getByRole("button", { name: "Again" }));

    await waitFor(() => expect(submitAnswer).toHaveBeenLastCalledWith({
      groupId: 4,
      questionId: 8,
      answer: "Lyon",
      quality: 0,
      commit: true
    }));
    expect(onComplete).toHaveBeenCalledWith([8]);
  });
});
