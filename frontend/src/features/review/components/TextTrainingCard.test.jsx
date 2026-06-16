import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TextTrainingCard from "./TextTrainingCard";
import {
  matchesTextTrainingAnswer,
  normalizeTextTrainingAnswer
} from "../textTrainingUtils";


const question = {
  question_id: 1,
  type_q: "text",
  question: "Capitale de la France",
  answer: "Paris",
  aliases: ["Ville lumière"]
};


function renderCard(props = {}) {
  const onComplete = vi.fn();

  render(
    <TextTrainingCard
      q={question}
      currentIndex={0}
      onComplete={onComplete}
      {...props}
    />
  );

  return { onComplete };
}


describe("TextTrainingCard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("normalizes training text answers", () => {
    expect(normalizeTextTrainingAnswer(" Côte-d Ivoire ")).toBe("cote d ivoire");
    expect(matchesTextTrainingAnswer(question, "ville-lumiere")).toBe(true);
    expect(matchesTextTrainingAnswer(question, "Lyon")).toBe(false);
  });

  it("advances immediately on a correct answer", () => {
    const { onComplete } = renderCard();

    fireEvent.change(screen.getByLabelText("Réponse"), {
      target: { value: " ville-lumiere " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    expect(onComplete).toHaveBeenCalledWith({ failedQuestionIds: [] });
  });

  it("reveals wrong answers and continues as missed", () => {
    const { onComplete } = renderCard();

    fireEvent.change(screen.getByLabelText("Réponse"), {
      target: { value: "Lyon" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    expect(screen.getByRole("status")).toHaveTextContent("Réponse incorrecte.");
    expect(screen.getByRole("status")).toHaveTextContent("Paris");

    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

    expect(onComplete).toHaveBeenCalledWith({ failedQuestionIds: [1] });
  });

  it("submits an empty answer as skipped and continues as missed", () => {
    const { onComplete } = renderCard();

    expect(screen.queryByRole("button", { name: "Passer" }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    expect(screen.getByRole("status")).toHaveTextContent("Question passée.");

    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

    expect(onComplete).toHaveBeenCalledWith({ failedQuestionIds: [1] });
  });
});
