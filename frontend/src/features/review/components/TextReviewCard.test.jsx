import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TextReviewCard from "./TextReviewCard";

const baseQuestion = {
    question_id: 1,
    type_q: "text",
    question: "Question avec image",
    answer: "Réponse",
    media: "/static/question.png"
};

function textReviewCardProps(props = {}) {
    return {
        q: baseQuestion,
        currentIndex: 0,
        showAnswer: false,
        setShowAnswer: vi.fn(),
        handleAnswer: vi.fn(),
        currentQuality: null,
        selectedQuality: null,
        ...props
    };
}

function renderTextReviewCard(props = {}) {
    return render(<TextReviewCard {...textReviewCardProps(props)} />);
}

describe("TextReviewCard media preview", () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("renders text question images as small clickable thumbnails", () => {
        renderTextReviewCard();

        const thumbnail = screen.getByRole("button", {
            name: "Agrandir l'image de la question"
        });
        const image = within(thumbnail).getByAltText("question");

        expect(thumbnail).toHaveStyle("height: 154px; max-width: 260px;");
        expect(image).toHaveStyle("max-height: 132px; object-fit: contain;");
    });

    it("opens and closes an enlarged image preview", async () => {
        renderTextReviewCard();

        fireEvent.click(screen.getByRole("button", {
            name: "Agrandir l'image de la question"
        }));

        const dialog = screen.getByRole("dialog", { name: "Image agrandie" });
        const previewImage = within(dialog).getByAltText("question");

        expect(previewImage).toHaveStyle("height: 68vh; max-height: 620px; width: 100%;");

        fireEvent.keyDown(window, { key: "Escape" });

        await waitFor(() => {
            expect(screen.queryByRole("dialog", { name: "Image agrandie" }))
                .not.toBeInTheDocument();
        });
    });

    it("scrolls to the quality buttons when the answer appears", async () => {
        const scrollIntoView = vi
            .spyOn(HTMLElement.prototype, "scrollIntoView")
            .mockImplementation(() => {});
        const { rerender } = renderTextReviewCard();

        rerender(
            <TextReviewCard {...textReviewCardProps({ showAnswer: true })} />
        );

        await waitFor(() => {
            expect(scrollIntoView).toHaveBeenCalledWith({
                behavior: "smooth",
                block: "end",
                inline: "nearest"
            });
        });
    });
});

describe("TextReviewCard relearning", () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    const plainQuestion = {
        question_id: 1,
        type_q: "text",
        question: "Capitale ?",
        answer: "Paris"
    };

    it("keeps the four grades for a normal question", () => {
        render(<TextReviewCard {...textReviewCardProps({
            q: plainQuestion,
            showAnswer: true
        })} />);

        expect(screen.getByText(/Faux/)).toBeInTheDocument();
        expect(screen.getByText(/Facile/)).toBeInTheDocument();
        expect(screen.queryByText(/Encore/)).not.toBeInTheDocument();
    });

    it("shows the binary Encore/Acquis on an in-session retry", () => {
        render(<TextReviewCard {...textReviewCardProps({
            q: { ...plainQuestion, _reviewRetryOfIndex: 0 },
            showAnswer: true
        })} />);

        expect(screen.getByText(/Encore/)).toBeInTheDocument();
        expect(screen.getByText(/Acquis/)).toBeInTheDocument();
        expect(screen.queryByText(/Bon/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Facile/)).not.toBeInTheDocument();
    });

    it("shows the binary choice for a card reloaded in relearning (refresh case)", () => {
        // No in-session marker: the persisted progress.relearning flag drives it,
        // which is what survives an app refresh.
        render(<TextReviewCard {...textReviewCardProps({
            q: { ...plainQuestion, progress: { relearning: true } },
            showAnswer: true
        })} />);

        expect(screen.getByText(/Encore/)).toBeInTheDocument();
        expect(screen.getByText(/Acquis/)).toBeInTheDocument();
        expect(screen.queryByText(/Facile/)).not.toBeInTheDocument();
    });

    it("sends Encore as 0 and Acquis as 1", () => {
        const handleAnswer = vi.fn();
        render(<TextReviewCard {...textReviewCardProps({
            q: { ...plainQuestion, _reviewRetryOfIndex: 0 },
            showAnswer: true,
            handleAnswer
        })} />);

        fireEvent.click(screen.getByText(/Encore/));
        expect(handleAnswer).toHaveBeenLastCalledWith(0);

        fireEvent.click(screen.getByText(/Acquis/));
        expect(handleAnswer).toHaveBeenLastCalledWith(1);
    });
});
