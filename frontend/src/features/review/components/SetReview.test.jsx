import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SetReview from "./SetReview";

const group = { group_id: 5, name: "Gaz nobles", mode: "collect_members", items: [{ question_id: 8 }, { question_id: 9 }] };

describe("SetReview", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("collects unordered chips, previews them, then schedules each due member", async () => {
    const submitAnswer = vi.fn()
      .mockResolvedValueOnce({ items: [{ question_id: 8, correct: true, expected: "Hélium" }, { question_id: 9, correct: true, expected: "Néon" }], recognized: [], unmatched: [] })
      .mockResolvedValueOnce({ items: [{ question_id: 8, correct: true, expected: "Hélium" }, { question_id: 9, correct: true, expected: "Néon" }], recognized: [], unmatched: [] });
    const onComplete = vi.fn();
    render(<SetReview group={group} submitAnswer={submitAnswer} onComplete={onComplete} />);

    const input = screen.getByLabelText("Ajouter un membre");
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "Néon" } }); fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "Hélium" } }); fireEvent.submit(input.closest("form"));
    await screen.findByText("Tous les membres dus sont trouvés");
    expect(submitAnswer).toHaveBeenCalledWith({ groupId: 5, questionIds: [8, 9], answers: ["Néon", "Hélium"], mode: "collect_members", commit: false });
    fireEvent.click(screen.getByRole("button", { name: "Bien" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith([]));
  });

  it("reveals missed members and retries only their atomic cards", async () => {
    const submitAnswer = vi.fn()
      .mockResolvedValueOnce({ items: [{ question_id: 8, correct: true, expected: "Hélium" }, { question_id: 9, correct: false, expected: "Néon" }], recognized: [], unmatched: [] })
      .mockResolvedValueOnce({ items: [{ question_id: 8, correct: true, expected: "Hélium" }, { question_id: 9, correct: false, expected: "Néon" }], recognized: [], unmatched: [] });
    const onComplete = vi.fn();
    render(<SetReview group={group} submitAnswer={submitAnswer} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "Vérifier" }));
    await screen.findByText("Manquait : Néon");
    fireEvent.click(screen.getByRole("button", { name: "Bien" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith([9]));
  });
});
