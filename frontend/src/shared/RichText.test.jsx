import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RichText from "./RichText";

describe("RichText", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders inline LaTeX with KaTeX", () => {
    const { container } = render(
      <RichText>Énergie \(E = mc^2\)</RichText>
    );

    expect(container).toHaveTextContent("Énergie");
    expect(container.querySelector(".katex")).toBeInTheDocument();
    expect(container).toHaveTextContent("E=mc2");
  });

  it("renders display LaTeX", () => {
    const { container } = render(
      <RichText>$$\int_0^1 x^2 dx$$</RichText>
    );

    expect(container.querySelector(".katex-display")).toBeInTheDocument();
  });

  it("leaves unmatched delimiters as normal text", () => {
    render(<RichText>Prix $10 sans formule</RichText>);

    expect(screen.getByText("Prix $10 sans formule")).toBeInTheDocument();
  });
});
