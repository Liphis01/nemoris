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

function renderMapReview(showQualityControls, props = {}) {
  return render(
    <MapReview
      group={{ name: "Europe", media: "europe.svg" }}
      reviewZones={reviewZones}
      onComplete={vi.fn()}
      submitAnswer={vi.fn().mockResolvedValue({})}
      showQualityControls={showQualityControls}
      {...props}
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

  it("shows the training timer while answering map groups", async () => {
    renderMapReview(false, {
      trainingElapsedMs: 12345,
      trainingBestTimeMs: 90000
    });

    expect(screen.getByText("Temps")).toBeInTheDocument();
    expect(screen.getByText("12s")).toBeInTheDocument();
    expect(screen.getByText("Meilleur")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));

    expect(await screen.findByRole("button", { name: "Continuer" })).toBeInTheDocument();
    expect(screen.queryByText("Temps")).not.toBeInTheDocument();
  });

  it("shows click prompt misses as a separate progress bar segment", async () => {
    const { container } = renderMapReview(false, {
      mode: "click_prompt",
      reviewZones: [
        {
          question_id: 1,
          code: "alpha",
          label: "Alpha",
          progress: {}
        }
      ]
    });

    fireEvent.click(screen.getByTestId("active-map"));

    await waitFor(() => {
      expect(container.querySelector("[data-map-progress-correct]"))
        .toHaveStyle({ width: "0%" });
      expect(container.querySelector("[data-map-progress-wrong]"))
        .toHaveStyle({ width: "100%" });
    });
    expect(container.querySelector("[data-map-progress-wrong]").style.background)
      .toContain("repeating-linear-gradient");
    expect(screen.getByRole("progressbar", { name: "Progression" }))
      .toHaveAttribute("aria-valuenow", "1");
  });

  it("shows colorblind-friendly recap status treatments", async () => {
    const { container } = renderMapReview(true, {
      mode: "type_all"
    });

    const input = screen.getByPlaceholderText("Tape une zone...");

    fireEvent.change(input, { target: { value: "Alpha" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));

    await screen.findByRole("button", { name: "Valider" });

    const foundStatus = container.querySelector('[data-map-recap-status="found"]');
    const missedStatus = container.querySelector('[data-map-recap-status="missed"]');

    expect(foundStatus).toHaveTextContent("Trouvée");
    expect(missedStatus).toHaveTextContent("À revoir");
    expect(foundStatus.closest(".map-recap-row"))
      .toHaveAttribute("data-map-recap-row", "found");
    expect(missedStatus.closest(".map-recap-row"))
      .toHaveAttribute("data-map-recap-row", "missed");
    expect(missedStatus.style.background).toContain("repeating-linear-gradient");
    expect(missedStatus.closest(".map-recap-row").style.background)
      .toContain("repeating-linear-gradient");
  });
});
