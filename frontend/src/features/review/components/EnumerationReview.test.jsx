import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EnumerationReview from "./EnumerationReview";

const question = {
  question_id: 12,
  type_q: "enumeration",
  question: "Donne deux sens de run.",
  enumeration: { required_count: 2 }
};

describe("EnumerationReview", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("collects answers, previews the quota and commits the selected difficulty", async () => {
    const submitAnswer = vi.fn()
      .mockResolvedValueOnce({ correct: true, unmatched: [] })
      .mockResolvedValueOnce({ correct: true, progress: {} });
    const onComplete = vi.fn();
    render(<EnumerationReview q={question} submitAnswer={submitAnswer} onComplete={onComplete} />);

    const input = screen.getByLabelText("Ajouter une réponse");
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "course" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "fonctionner" } });
    fireEvent.click(screen.getByRole("button", { name: "Vérifier" }));

    await screen.findByText("Quota atteint");
    expect(submitAnswer).toHaveBeenCalledWith({
      questionId: 12,
      answers: ["course", "fonctionner"],
      commit: false
    });
    fireEvent.click(screen.getByRole("button", { name: "Bien" }));
    await waitFor(() => expect(submitAnswer).toHaveBeenLastCalledWith({
      questionId: 12,
      answers: ["course", "fonctionner"],
      quality: 2,
      commit: true
    }));
    expect(onComplete).toHaveBeenCalledWith([]);
  });

  it("commits a failed quota as Again and retries the one card", async () => {
    const submitAnswer = vi.fn()
      .mockResolvedValueOnce({ correct: false, unmatched: ["inconnu"] })
      .mockResolvedValueOnce({ correct: false, progress: {} });
    const onComplete = vi.fn();
    render(<EnumerationReview q={question} submitAnswer={submitAnswer} onComplete={onComplete} />);

    fireEvent.change(screen.getByLabelText("Ajouter une réponse"), { target: { value: "inconnu" } });
    fireEvent.click(screen.getByRole("button", { name: "Vérifier" }));
    await screen.findByText("Il manque 1 réponse");
    fireEvent.click(screen.getByRole("button", { name: "Again" }));

    await waitFor(() => expect(submitAnswer).toHaveBeenLastCalledWith({
      questionId: 12,
      answers: ["inconnu"],
      quality: 0,
      commit: true
    }));
    expect(onComplete).toHaveBeenCalledWith([12]);
  });

  it("shows duplicate feedback and allows a close miss", async () => {
    const submitAnswer = vi.fn()
      .mockResolvedValueOnce({
        correct: false,
        matched: [{ answer: "politique", expected: "politique" }],
        duplicates: ["political"],
        unmatched: [],
        missing_count: 1
      })
      .mockResolvedValueOnce({ correct: false, user_marked_close: true, progress: {} });
    const onComplete = vi.fn();
    render(<EnumerationReview q={question} submitAnswer={submitAnswer} onComplete={onComplete} />);

    const input = screen.getByLabelText("Ajouter une réponse");
    fireEvent.change(input, { target: { value: "politique" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "politique" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "political" } });
    fireEvent.click(screen.getByRole("button", { name: "Vérifier" }));

    await screen.findByText("Doublon : political");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(submitAnswer).toHaveBeenLastCalledWith({
      questionId: 12,
      answers: ["politique", "political"],
      quality: 1,
      commit: true
    }));
    expect(onComplete).toHaveBeenCalledWith([]);
  });
});
