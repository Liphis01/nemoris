import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapReview from "./MapReview";

vi.mock("../../map/components/SvgMap", () => ({
  default: (props) => {
    const isRecap = props.selected !== undefined;

    return (
      <button
        type="button"
        data-testid={isRecap ? "recap-map" : "active-map"}
        data-focus-code={props.focusCode || ""}
        data-focus-version={props.focusVersion ?? ""}
        data-selected={props.selected || ""}
        onClick={() => props.onSelect?.("beta")}
      >
        {isRecap ? "Recap map" : "Active map"}
      </button>
    );
  }
}));

const reviewZones = [
  {
    question_id: 1,
    code: "alpha",
    label: "Alpha",
    progress: {}
  },
  {
    question_id: 2,
    code: "beta",
    label: "Beta",
    progress: {}
  }
];

function renderMapReview(showQualityControls) {
  return render(
    <MapReview
      group={{ name: "Europe", media: "europe.svg" }}
      reviewZones={reviewZones}
      onComplete={vi.fn()}
      submitAnswer={vi.fn().mockResolvedValue({})}
      showQualityControls={showQualityControls}
    />
  );
}

describe("MapReview recap map focus", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([true, false])(
    "selects zones without zooming, while answer rows still zoom when quality controls are %s",
    async (showQualityControls) => {
      renderMapReview(showQualityControls);

      fireEvent.click(screen.getByRole("button", { name: "Terminer" }));

      expect(await screen.findByTestId("recap-map")).toHaveAttribute("data-focus-code", "");

      fireEvent.click(screen.getByTestId("recap-map"));

      await waitFor(() => {
        expect(screen.getByTestId("recap-map")).toHaveAttribute("data-selected", "beta");
      });
      expect(screen.getByTestId("recap-map")).toHaveAttribute("data-focus-code", "");

      fireEvent.click(screen.getByTitle("Voir Beta sur la carte"));

      await waitFor(() => {
        expect(screen.getByTestId("recap-map")).toHaveAttribute("data-focus-code", "beta");
      });
      expect(screen.getByTestId("recap-map")).toHaveAttribute("data-focus-version", "1");
    }
  );
});
