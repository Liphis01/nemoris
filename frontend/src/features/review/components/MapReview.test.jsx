import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapReview from "./MapReview";

vi.mock("../../map/components/SvgMap", () => ({
  default: (props) => {
    const isRecap = props.zoneLabels === undefined;

    return (
      <button
        type="button"
        data-testid={isRecap ? "recap-map" : "active-map"}
        data-due-items={(props.dueItems || []).join("|")}
        data-flash-codes={(props.flashCodes || []).join("|")}
        data-focus-code={props.focusCode || ""}
        data-focus-version={props.focusVersion ?? ""}
        data-missed={(props.missed || []).join("|")}
        data-selected={props.selected || ""}
        data-zone-labels={JSON.stringify(props.zoneLabels || {})}
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

  it("collapses duplicate map chrome in compact visual layout", () => {
    const { container } = renderMapReview(false, {
      fillAvailableHeight: true,
      mode: "click_prompt",
      trainingElapsedMs: 12345,
      trainingBestTimeMs: 90000
    });
    const shell = container.querySelector("[data-map-review-shell]");
    const header = container.querySelector("[data-map-review-header]");

    expect(shell).toHaveStyle({
      height: "100%",
      minHeight: "0",
      overflow: "hidden"
    });
    expect(header).toHaveTextContent("Europe");
    expect(header).not.toHaveTextContent("Progression");
    expect(header).not.toHaveTextContent("MAP");
    expect(header).not.toHaveTextContent("Cliquer");
    expect(header).not.toHaveTextContent("Temps");
    expect(screen.getByRole("progressbar", { name: "Avancement" }))
      .toBeInTheDocument();
    expect(screen.getByText((content) => ["Alpha", "Beta"].includes(content)))
      .toBeInTheDocument();
    expect(screen.queryByText("Zone demandée")).not.toBeInTheDocument();
    expect(screen.queryByText("Clique la zone demandée.")).not.toBeInTheDocument();
  });

  it("uses the right-answer progress style in type_all mode", () => {
    const { container } = renderMapReview(false, {
      mode: "type_all"
    });

    fireEvent.change(screen.getByPlaceholderText("Tape une zone..."), {
      target: { value: "Alpha" }
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Tape une zone..."), {
      key: "Enter"
    });

    expect(container.querySelector("[data-map-progress-correct]"))
      .toHaveStyle({ width: "50%" });
    expect(container.querySelector("[data-map-progress-wrong]"))
      .toHaveStyle({ width: "0%" });
    expect(screen.getByRole("progressbar", { name: "Avancement" }))
      .toHaveAttribute("aria-valuenow", "1");
  });

  it("focuses the next remaining zone from Zone suivante in type_all", async () => {
    renderMapReview(false, {
      mode: "type_all"
    });

    fireEvent.click(screen.getByRole("button", { name: "Zone suivante" }));

    await waitFor(() => {
      expect(screen.getByTestId("active-map"))
        .toHaveAttribute("data-focus-code", "alpha");
      expect(screen.getByTestId("active-map"))
        .toHaveAttribute("data-focus-version", "1");
    });
    expect(screen.getByPlaceholderText("Tape une zone..."))
      .toHaveFocus();
  });

  it("uses Tab as Zone suivante in type_all", async () => {
    renderMapReview(false, {
      mode: "type_all"
    });
    const input = screen.getByPlaceholderText("Tape une zone...");

    input.focus();
    fireEvent.keyDown(window, { key: "Tab" });

    await waitFor(() => {
      expect(screen.getByTestId("active-map"))
        .toHaveAttribute("data-focus-code", "alpha");
      expect(screen.getByTestId("active-map"))
        .toHaveAttribute("data-focus-version", "1");
    });
    expect(input).toHaveFocus();
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
    expect(screen.getByRole("progressbar", { name: "Avancement" }))
      .toHaveAttribute("aria-valuenow", "1");
  });

  it("flashes a wrong click and reveals the requested click_prompt zone", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);

    try {
      renderMapReview(false, {
        mode: "click_prompt"
      });
      const map = screen.getByTestId("active-map");

      expect(screen.getByText("Alpha")).toBeInTheDocument();

      fireEvent.click(map);

      await waitFor(() => {
        expect(screen.getByTestId("active-map"))
          .toHaveAttribute("data-flash-codes", "beta");
        expect(screen.getByTestId("active-map"))
          .toHaveAttribute("data-missed", "alpha");
      });
      expect(JSON.parse(screen.getByTestId("active-map").dataset.zoneLabels))
        .toMatchObject({ alpha: "Alpha" });
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("shows type_prompt skips as a separate progress bar segment", async () => {
    const { container } = renderMapReview(false, {
      mode: "type_prompt"
    });
    const targetCode = screen.getByTestId("active-map")
      .getAttribute("data-due-items");
    const targetLabel = reviewZones.find(zone => zone.code === targetCode)?.label;

    fireEvent.click(screen.getByRole("button", { name: "Passer" }));

    await waitFor(() => {
      expect(container.querySelector("[data-map-progress-correct]"))
        .toHaveStyle({ width: "0%" });
      expect(container.querySelector("[data-map-progress-wrong]"))
        .toHaveStyle({ width: "50%" });
    });
    expect(container.querySelector("[data-map-progress-wrong]").style.background)
      .toContain("repeating-linear-gradient");
    expect(screen.getByRole("progressbar", { name: "Avancement" }))
      .toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByTestId("active-map"))
      .toHaveAttribute("data-missed", targetCode);
    const labels = JSON.parse(screen.getByTestId("active-map").dataset.zoneLabels);

    expect(labels[targetCode]).toBe(targetLabel);
  });

  it("skips type_prompt map zones with Tab", async () => {
    const { container } = renderMapReview(false, {
      mode: "type_prompt"
    });
    const targetCode = screen.getByTestId("active-map")
      .getAttribute("data-due-items");
    const input = screen.getByPlaceholderText("Nom de la zone...");

    input.focus();

    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);

    await waitFor(() => {
      expect(container.querySelector("[data-map-progress-wrong]"))
        .toHaveStyle({ width: "50%" });
      expect(screen.getByTestId("active-map"))
        .toHaveAttribute("data-missed", targetCode);
    });
    expect(screen.getByRole("progressbar", { name: "Avancement" }))
      .toHaveAttribute("aria-valuenow", "1");
    expect(input).toHaveFocus();
  });

  it("shows multiple-choice misses as a separate progress bar segment", async () => {
    const qcmZones = [
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
    const { container } = renderMapReview(false, {
      mode: "multiple_choice",
      reviewZones: qcmZones
    });
    const targetCode = screen.getByTestId("active-map")
      .getAttribute("data-due-items");
    const wrongChoice = qcmZones.find(zone => zone.code !== targetCode);

    fireEvent.click(screen.getByRole("button", { name: wrongChoice.label }));

    await waitFor(() => {
      expect(screen.getByText("Faux").closest("button"))
        .toHaveAttribute("data-map-choice-feedback", "wrong");
      expect(screen.getByText("Correct").closest("button"))
        .toHaveAttribute("data-map-choice-feedback", "correct");
      expect(screen.getByTestId("active-map"))
        .toHaveAttribute("data-missed", targetCode);
      expect(container.querySelector("[data-map-progress-correct]"))
        .toHaveStyle({ width: "0%" });
      expect(container.querySelector("[data-map-progress-wrong]"))
        .toHaveStyle({ width: "50%" });
    });
    expect(JSON.parse(screen.getByTestId("active-map").dataset.zoneLabels))
      .toHaveProperty(targetCode);
    expect(container.querySelector("[data-map-progress-wrong]").style.background)
      .toContain("repeating-linear-gradient");
    expect(screen.getByRole("progressbar", { name: "Avancement" }))
      .toHaveAttribute("aria-valuenow", "1");
  });

  it("shows correct multiple-choice feedback before moving on visually", async () => {
    const { container } = renderMapReview(false, {
      mode: "multiple_choice"
    });
    const targetCode = screen.getByTestId("active-map")
      .getAttribute("data-due-items");
    const targetChoice = reviewZones.find(zone => zone.code === targetCode);

    fireEvent.click(screen.getByRole("button", { name: targetChoice.label }));

    await waitFor(() => {
      expect(screen.getByText("Correct").closest("button"))
        .toHaveAttribute("data-map-choice-feedback", "correct");
      expect(screen.getByText("Correct").closest("button")).toBeDisabled();
      expect(container.querySelector("[data-map-progress-correct]"))
        .toHaveStyle({ width: "50%" });
      expect(container.querySelector("[data-map-progress-wrong]"))
        .toHaveStyle({ width: "0%" });
    });
  });

  it("does not show the multiple-choice prompt card", () => {
    renderMapReview(false, {
      mode: "multiple_choice"
    });

    expect(screen.queryByText("Zone surlignée")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
  });

  it("restores Recentrer and Tab focus for multiple_choice", async () => {
    renderMapReview(false, {
      mode: "multiple_choice"
    });
    const targetCode = screen.getByTestId("active-map")
      .getAttribute("data-due-items");
    const recenter = screen.getByRole("button", { name: "Recentrer" });

    fireEvent.click(recenter);

    await waitFor(() => {
      expect(screen.getByTestId("active-map"))
        .toHaveAttribute("data-focus-code", targetCode);
      expect(screen.getByTestId("active-map"))
        .toHaveAttribute("data-focus-version", "1");
    });

    fireEvent.keyDown(window, { key: "Tab" });

    await waitFor(() => {
      expect(screen.getByTestId("active-map"))
        .toHaveAttribute("data-focus-version", "2");
    });
  });

  it.each(["click_prompt", "type_prompt"])(
    "does not show the recenter control in %s mode",
    (mode) => {
      renderMapReview(false, {
        mode
      });

      expect(screen.queryByRole("button", { name: "Recentrer" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Zone suivante" })).not.toBeInTheDocument();
    }
  );

  it("does not show the type_prompt prompt card", () => {
    renderMapReview(false, {
      mode: "type_prompt"
    });

    expect(screen.queryByText("Nom attendu")).not.toBeInTheDocument();
    expect(screen.queryByText("Zone surlignée")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Nom de la zone...")).toBeInTheDocument();
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
