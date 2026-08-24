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

describe("TextGroupReview inline typed quality", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderTypedGroup(submitAnswer) {
    return render(
      <TextGroupReview
        group={{ type_group: "text" }}
        reviewItems={[{
          question_id: 1,
          question: "chat",
          answer: "cat",
          answer_policy: { preset: "relaxed" },
          progress: {}
        }]}
        mode="type_all"
        submitAnswer={submitAnswer}
        onComplete={vi.fn()}
      />
    );
  }

  it("asks inline quality after a correct typed answer and keeps recap editable", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    const { container } = renderTypedGroup(submitAnswer);

    const input = screen.getByPlaceholderText("Réponse…");
    fireEvent.change(input, { target: { value: "cat" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(container.querySelector("[data-text-typed-rating]")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-text-typed-quality]")).toHaveLength(3);
    expect(submitAnswer).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector("[data-text-typed-quality='3']"));

    expect(await screen.findByRole("button", { name: "Valider" }))
      .toBeInTheDocument();

    fireEvent.click(container.querySelector("[data-text-recap-quality='1']"));
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    await waitFor(() => {
      expect(submitAnswer).toHaveBeenCalledWith(
        { 1: 1 },
        "type_all",
        1,
        { 1: "cat" },
        { 1: [1] }
      );
    });
  });

  it("uses Enter as the inline Bon default", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    renderTypedGroup(submitAnswer);

    const input = screen.getByPlaceholderText("Réponse…");
    fireEvent.change(input, { target: { value: "cat" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: "Valider" }));

    await waitFor(() => {
      expect(submitAnswer).toHaveBeenCalledWith(
        { 1: 2 },
        "type_all",
        1,
        { 1: "cat" },
        { 1: [1] }
      );
    });
  });
});


describe("TextGroupReview completion guard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderGroup(submitAnswer) {
    return render(
      <TextGroupReview
        group={{ type_group: "text" }}
        reviewItems={[
          {
            question_id: 1,
            question: "chat",
            answer: "cat",
            answer_policy: { preset: "relaxed" },
            progress: {}
          },
          {
            question_id: 2,
            question: "chien",
            answer: "dog",
            answer_policy: { preset: "relaxed" },
            progress: {}
          }
        ]}
        mode="type_all"
        showQualityControls={false}
        submitAnswer={submitAnswer}
        onComplete={vi.fn()}
      />
    );
  }

  // M0 trust breaker: pressing a generic completion button before touching
  // anything used to grade every item in the group as a failure at once.
  it("blocks Terminer until the learner has attempted something", () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    renderGroup(submitAnswer);

    const finish = screen.getByRole("button", { name: "Terminer le groupe" });

    expect(finish).toBeDisabled();

    fireEvent.click(finish);

    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it("enables Terminer after a wrong attempt, not only a correct one", async () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    renderGroup(submitAnswer);

    const input = screen.getAllByPlaceholderText("Réponse…")[0];
    fireEvent.change(input, { target: { value: "totalement faux" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const finish = screen.getByRole("button", { name: "Terminer le groupe" });

    await waitFor(() => expect(finish).toBeEnabled());

    fireEvent.click(finish);

    // The wrong attempt is still graded 0 -- the guard only stops an
    // interaction-free submit, it never rescues a real miss.
    await waitFor(() => {
      expect(submitAnswer).toHaveBeenCalledWith(
        { 1: 0, 2: 0 },
        "type_all",
        expect.anything(),
        { 1: "totalement faux" },
        expect.anything()
      );
    });
  });

  it("selects a wrong typed answer after Enter so it can be edited", () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    renderGroup(submitAnswer);

    const inputs = screen.getAllByPlaceholderText("Réponse…");
    const wrongInput = inputs[0];

    wrongInput.focus();
    fireEvent.change(wrongInput, { target: { value: "totalement faux" } });
    fireEvent.keyDown(wrongInput, { key: "Enter" });

    expect(document.activeElement).toBe(wrongInput);
    expect(wrongInput).toHaveClass("review-input-shake");
    expect(wrongInput.selectionStart).toBe(0);
    expect(wrongInput.selectionEnd).toBe("totalement faux".length);
    expect(document.activeElement).not.toBe(inputs[1]);
  });

  it("labels a repeated typed text answer as already answered", () => {
    const submitAnswer = vi.fn().mockResolvedValue(undefined);
    renderGroup(submitAnswer);

    let inputs = screen.getAllByPlaceholderText("Réponse…");

    fireEvent.change(inputs[0], { target: { value: "cat" } });
    fireEvent.keyDown(inputs[0], { key: "Enter" });

    inputs = screen.getAllByPlaceholderText("Réponse…");
    const duplicateInput = inputs[0];

    fireEvent.change(duplicateInput, { target: { value: "cat" } });
    fireEvent.keyDown(duplicateInput, { key: "Enter" });

    expect(screen.getByText("Déjà répondu.")).toBeInTheDocument();
    expect(document.activeElement).toBe(duplicateInput);
    expect(duplicateInput).not.toHaveClass("review-input-shake");
    expect(duplicateInput.selectionStart).toBe(0);
    expect(duplicateInput.selectionEnd).toBe("cat".length);
  });
});
