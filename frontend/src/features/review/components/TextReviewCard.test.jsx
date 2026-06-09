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
