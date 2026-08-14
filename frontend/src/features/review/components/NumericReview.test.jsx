import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NumericReview from "./NumericReview";

const question = {
  question_id: 9,
  type_q: "numeric",
  question: "Quelle distance ?",
  numeric: { unit: "km" }
};

describe("NumericReview", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("focuses, previews server correction, then commits a chosen difficulty", async () => {
    const submitAnswer = vi.fn()
      .mockResolvedValueOnce({ correct: true, expected: "12,5 km" })
      .mockResolvedValueOnce({ correct: true, progress: {} });
    const onComplete = vi.fn();
    render(<NumericReview q={question} submitAnswer={submitAnswer} onComplete={onComplete} />);

    const input = screen.getByPlaceholderText("Ta réponse");
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "12,5" } });
    fireEvent.submit(input.closest("form"));

    await screen.findByText("Solution : 12,5 km");
    fireEvent.click(screen.getByRole("button", { name: "Bien" }));
    await waitFor(() => expect(submitAnswer).toHaveBeenLastCalledWith({
      questionId: 9,
      answer: "12,5",
      quality: 2,
      commit: true
    }));
    expect(onComplete).toHaveBeenCalledWith([]);
  });

  it("records an incorrect response as Again and requests a retry", async () => {
    const submitAnswer = vi.fn()
      .mockResolvedValueOnce({ correct: false, expected: "12,5 km" })
      .mockResolvedValueOnce({ correct: false, progress: {} });
    const onComplete = vi.fn();
    render(<NumericReview q={question} submitAnswer={submitAnswer} onComplete={onComplete} />);

    fireEvent.change(screen.getByPlaceholderText("Ta réponse"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Vérifier" }));
    await screen.findByText("Réponse attendue : 12,5 km");
    fireEvent.click(screen.getByRole("button", { name: "Again" }));

    await waitFor(() => expect(submitAnswer).toHaveBeenLastCalledWith({
      questionId: 9,
      answer: "20",
      quality: 0,
      commit: true
    }));
    expect(onComplete).toHaveBeenCalledWith([9]);
  });

  it("allows a close miss without scheduling a full success", async () => {
    const submitAnswer = vi.fn()
      .mockResolvedValueOnce({ correct: false, expected: "12,5 km" })
      .mockResolvedValueOnce({ correct: false, user_marked_close: true, progress: {} });
    const onComplete = vi.fn();
    render(<NumericReview q={question} submitAnswer={submitAnswer} onComplete={onComplete} />);

    fireEvent.change(screen.getByPlaceholderText("Ta réponse"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Vérifier" }));
    await screen.findByText("Réponse attendue : 12,5 km");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(submitAnswer).toHaveBeenLastCalledWith({
      questionId: 9,
      answer: "12",
      quality: 1,
      commit: true
    }));
    expect(onComplete).toHaveBeenCalledWith([]);
  });
});
