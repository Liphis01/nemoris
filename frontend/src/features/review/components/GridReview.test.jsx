import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GridReview from "./GridReview";

const group = {
  group_id: 4,
  name: "Conjugaison",
  mode: "fill_row",
  grid: {
    rows: [{ key: "je", label: "je" }],
    columns: [{ key: "present", label: "présent" }, { key: "imparfait", label: "imparfait" }],
    cells: [
      { key: "a", row_key: "je", column_key: "present", value: null },
      { key: "b", row_key: "je", column_key: "imparfait", value: null }
    ]
  },
  items: [
    { question_id: 8, row_key: "je", column_key: "present" },
    { question_id: 9, row_key: "je", column_key: "imparfait" }
  ]
};

describe("GridReview", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("focuses the first cell, previews the whole due row, then schedules its chosen difficulty", async () => {
    const submitAnswer = vi.fn()
      .mockResolvedValueOnce({ items: [
        { question_id: 8, correct: true, expected: "parle" },
        { question_id: 9, correct: true, expected: "parlais" }
      ] })
      .mockResolvedValueOnce({ items: [
        { question_id: 8, correct: true, expected: "parle" },
        { question_id: 9, correct: true, expected: "parlais" }
      ] });
    const onComplete = vi.fn();
    render(<GridReview group={group} submitAnswer={submitAnswer} onComplete={onComplete} />);

    const present = screen.getByLabelText("je × présent");
    await waitFor(() => expect(document.activeElement).toBe(present));
    fireEvent.change(present, { target: { value: "parle" } });
    fireEvent.change(screen.getByLabelText("je × imparfait"), { target: { value: "parlais" } });
    fireEvent.submit(present.closest("form"));

    await screen.findByText("Bonnes réponses");
    fireEvent.click(screen.getByRole("button", { name: "Bien" }));
    await waitFor(() => expect(submitAnswer).toHaveBeenLastCalledWith({
      groupId: 4,
      items: { 8: { answer: "parle" }, 9: { answer: "parlais" } },
      mode: "fill_row",
      quality: 2,
      commit: true
    }));
    expect(onComplete).toHaveBeenCalledWith([], expect.any(Object));
  });

  it("keeps only failed cells in the retry presentation", async () => {
    const submitAnswer = vi.fn()
      .mockResolvedValueOnce({ items: [
        { question_id: 8, correct: true, expected: "parle" },
        { question_id: 9, correct: false, expected: "parlais" }
      ] })
      .mockResolvedValueOnce({ items: [
        { question_id: 8, correct: true, expected: "parle" },
        { question_id: 9, correct: false, expected: "parlais" }
      ] });
    const onComplete = vi.fn();
    render(<GridReview group={group} submitAnswer={submitAnswer} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: "Vérifier" }));
    await screen.findByText("Correction affichée");
    fireEvent.click(screen.getByRole("button", { name: "Bien" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const [failedIds, retry] = onComplete.mock.calls[0];
    expect(failedIds).toEqual([9]);
    expect(retry.mode).toBe("fill_cell");
    expect(retry.grid.cells.find(cell => cell.key === "a").value).toBe("parle");
    expect(retry.grid.cells.find(cell => cell.key === "b").value).toBeNull();
  });
});
