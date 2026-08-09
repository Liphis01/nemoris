import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TextGroupReview from "./TextGroupReview";


describe("TextGroupReview reverse mode", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses the stored answer as the cue and submits the original prompt", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();

    render(
      <TextGroupReview
        group={{ type_group: "text" }}
        reviewItems={[{
          question_id: 1,
          question: "pupil",
          answer: "élève",
          answer_policy: { preset: "relaxed" },
          progress: {}
        }]}
        mode="type_reverse"
        showQualityControls={false}
        submitAnswer={submitAnswer}
        onComplete={onComplete}
      />
    );

    expect(screen.getByText("élève")).toBeInTheDocument();
    expect(screen.queryByText("pupil")).not.toBeInTheDocument();

    const input = screen.getByPlaceholderText("Indice d’origine…");
    fireEvent.change(input, { target: { value: "PUPIL" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(submitAnswer).toHaveBeenCalledWith(
        { 1: 2 },
        "type_reverse",
        1,
        { 1: "PUPIL" },
        { 1: [1] }
      );
    });
    expect(onComplete).toHaveBeenCalledWith([]);
  });
});
