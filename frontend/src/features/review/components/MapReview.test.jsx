import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapReview from "./MapReview";

const mapAutoZoomStorageKey = "quizApp.mapReview.autoZoomEnabled";

vi.mock("../../map/components/SvgMap", () => ({
  default: (props) => {
    // Both maps are labelled now (the recap names every zone on hover), so tell
    // them apart by flashCodes, which only the answering map drives.
    const isRecap = props.flashCodes === undefined;
    const clickableCodes = props.clickableCodes;
    const canSelectBeta = !Array.isArray(clickableCodes) || clickableCodes.includes("beta");

    return (
      <button
        type="button"
        data-testid={isRecap ? "recap-map" : "active-map"}
        data-clickable-codes={(clickableCodes || []).join("|")}
        data-due-items={(props.dueItems || []).join("|")}
        data-flash-codes={(props.flashCodes || []).join("|")}
        data-focus-code={props.focusCode || ""}
        data-focus-version={props.focusVersion ?? ""}
        data-missed={(props.missed || []).join("|")}
        data-selected={props.selected || ""}
        data-zone-labels={JSON.stringify(props.zoneLabels || {})}
        onClick={() => {
          if (canSelectBeta) props.onSelect?.("beta");
        }}
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
    window.localStorage.clear();
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
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

      fireEvent.click(screen.getByRole("button", { name: /Beta/ }));

      await waitFor(() => {
        expect(screen.getByTestId("recap-map")).toHaveAttribute("data-focus-code", "beta");
      });
      expect(screen.getByTestId("recap-map")).toHaveAttribute("data-focus-version", "1");
    }
  );

  it("names every zone on hover in the recap, but not while answering", async () => {
    renderMapReview(true);

    // While answering, only found/missed zones are labelled — hovering an
    // untouched zone must not give its name away.
    expect(JSON.parse(screen.getByTestId("active-map").dataset.zoneLabels)).toEqual({});

    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));

    // By the recap every zone is revealed, so all of them are hoverable by name.
    const recapMap = await screen.findByTestId("recap-map");

    expect(JSON.parse(recapMap.dataset.zoneLabels)).toEqual({
      alpha: "Alpha",
      beta: "Beta"
    });
  });

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
    // The group name already lives in the session bar above this card, so the
    // compact header itself carries no title chrome at all — just the count.
    expect(header).not.toHaveTextContent("Europe");
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

  it.each([
    ["type_all", "Tape une zone..."],
    ["type_prompt", "Nom de la zone..."]
  ])(
    "keeps the answer input focused after clicking the active map in %s mode",
    (mode, placeholder) => {
      renderMapReview(false, {
        mode,
        trainingElapsedMs: 12345
      });
      const input = screen.getByPlaceholderText(placeholder);
      const map = screen.getByTestId("active-map");

      map.focus();
      expect(map).toHaveFocus();

      fireEvent.mouseDown(map);

      expect(input).toHaveFocus();

      map.focus();
      fireEvent.click(map);

      expect(input).toHaveFocus();
    }
  );

  it.each(["type_prompt", "multiple_choice"])(
    "uses automatic SVG focus by default in %s mode",
    (mode) => {
      renderMapReview(false, {
        mode
      });
      const targetCode = screen.getByTestId("active-map")
        .getAttribute("data-due-items");

      expect(targetCode).toBeTruthy();
      expect(screen.getByRole("button", { name: "Désactiver le zoom automatique" }))
        .toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("active-map"))
        .toHaveAttribute("data-focus-code", targetCode);
    }
  );

  it("disables automatic SVG focus and stores the preference", () => {
    renderMapReview(false, {
      mode: "type_prompt"
    });
    const targetCode = screen.getByTestId("active-map")
      .getAttribute("data-due-items");

    expect(screen.getByTestId("active-map"))
      .toHaveAttribute("data-focus-code", targetCode);

    fireEvent.click(screen.getByRole("button", { name: "Désactiver le zoom automatique" }));

    expect(window.localStorage.getItem(mapAutoZoomStorageKey)).toBe("false");
    expect(screen.getByRole("button", { name: "Activer le zoom automatique" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("active-map"))
      .toHaveAttribute("data-focus-code", "");
  });

  it("loads a stored disabled auto-zoom preference", () => {
    window.localStorage.setItem(mapAutoZoomStorageKey, "false");

    renderMapReview(false, {
      mode: "type_prompt"
    });

    expect(screen.getByTestId("active-map"))
      .toHaveAttribute("data-due-items");
    expect(screen.getByRole("button", { name: "Activer le zoom automatique" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("active-map"))
      .toHaveAttribute("data-focus-code", "");
  });

  it("keeps manual Recentrer zoom when automatic zoom is disabled", async () => {
    window.localStorage.setItem(mapAutoZoomStorageKey, "false");

    renderMapReview(false, {
      mode: "multiple_choice"
    });
    const targetCode = screen.getByTestId("active-map")
      .getAttribute("data-due-items");

    expect(screen.getByTestId("active-map"))
      .toHaveAttribute("data-focus-code", "");

    fireEvent.click(screen.getByRole("button", { name: "Recentrer" }));

    await waitFor(() => {
      expect(screen.getByTestId("active-map"))
        .toHaveAttribute("data-focus-code", targetCode);
      expect(screen.getByTestId("active-map"))
        .toHaveAttribute("data-focus-version", "1");
    });
  });

  it.each(["type_all", "click_prompt"])(
    "does not show the auto-zoom toggle in %s mode",
    (mode) => {
      renderMapReview(false, {
        mode
      });

      expect(screen.queryByRole("button", { name: /zoom automatique/i }))
        .not.toBeInTheDocument();
    }
  );

  it("shows click prompt misses as a separate progress bar segment", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);

    try {
      const { container } = renderMapReview(false, {
        mode: "click_prompt"
      });

      fireEvent.click(screen.getByTestId("active-map"));

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
    } finally {
      randomSpy.mockRestore();
    }
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

  it("advances type_prompt without a wrong segment when skipping", async () => {
    const { container } = renderMapReview(false, {
      mode: "type_prompt"
    });
    const targetCode = screen.getByTestId("active-map")
      .getAttribute("data-due-items");

    fireEvent.click(screen.getByRole("button", { name: "Passer" }));

    await waitFor(() => {
      expect(screen.getByTestId("active-map"))
        .not.toHaveAttribute("data-due-items", targetCode);
    });
    // Skipping no longer marks the zone missed, so there is no wrong segment.
    expect(container.querySelector("[data-map-progress-correct]"))
      .toHaveStyle({ width: "0%" });
    expect(container.querySelector("[data-map-progress-wrong]"))
      .toHaveStyle({ width: "0%" });
    expect(screen.getByTestId("active-map"))
      .not.toHaveAttribute("data-missed", targetCode);
  });

  it("skips type_prompt map zones with Tab without marking them missed", async () => {
    const { container } = renderMapReview(false, {
      mode: "type_prompt"
    });
    const targetCode = screen.getByTestId("active-map")
      .getAttribute("data-due-items");
    const input = screen.getByPlaceholderText("Nom de la zone...");

    input.focus();

    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);

    await waitFor(() => {
      expect(screen.getByTestId("active-map"))
        .not.toHaveAttribute("data-due-items", targetCode);
    });
    expect(container.querySelector("[data-map-progress-wrong]"))
      .toHaveStyle({ width: "0%" });
    expect(screen.getByTestId("active-map"))
      .not.toHaveAttribute("data-missed", targetCode);
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

  it("multiple_choice replaces the decoys with the quality buttons", async () => {
    renderMapReview(true, { mode: "multiple_choice" });
    const targetCode = screen.getByTestId("active-map")
      .getAttribute("data-due-items");
    const targetChoice = reviewZones.find(zone => zone.code === targetCode);

    fireEvent.click(screen.getByRole("button", { name: targetChoice.label }));

    // Only the correct zone stays; the decoy slots become Dur/Bon/Facile.
    await waitFor(() => {
      expect(document.querySelectorAll("[data-map-choice-quality]")).toHaveLength(3);
    });
    expect(document.querySelectorAll("[data-map-choice-feedback]")).toHaveLength(1);
    // A correct pick is never "Faux".
    expect(document.querySelector("[data-map-choice-quality='0']")).toBeNull();

    fireEvent.keyDown(window, { key: "3" });

    // Grading dismisses the reveal and moves the session on.
    await waitFor(() => {
      expect(document.querySelectorAll("[data-map-choice-quality]")).toHaveLength(0);
    });
  });

  it("multiple_choice centers the reveal with no quality buttons in training", async () => {
    renderMapReview(false, { mode: "multiple_choice" });
    const targetCode = screen.getByTestId("active-map")
      .getAttribute("data-due-items");
    const targetChoice = reviewZones.find(zone => zone.code === targetCode);

    fireEvent.click(screen.getByRole("button", { name: targetChoice.label }));

    // Training: no quality buttons, and the lone correct zone is centered.
    await waitFor(() => {
      expect(document.querySelectorAll("[data-map-choice-feedback]")).toHaveLength(1);
    });
    expect(document.querySelectorAll("[data-map-choice-quality]")).toHaveLength(0);

    const grid = document.querySelector("[data-map-choice-grid]");
    expect(grid.style.justifyContent).toBe("center");
    expect(grid.style.gridTemplateColumns).toBe("repeat(1, minmax(160px, 260px))");
  });

  it("multiple_choice picks the option under its number-key shortcut", async () => {
    renderMapReview(false, { mode: "multiple_choice" });
    const targetCode = screen.getByTestId("active-map")
      .getAttribute("data-due-items");
    const targetChoice = reviewZones.find(zone => zone.code === targetCode);
    const choiceButtons = Array.from(
      document.querySelectorAll("[data-map-choice-feedback]")
    );

    // Each choice shows a discoverable keycap hint.
    expect(document.querySelectorAll("[data-map-choice-key]"))
      .toHaveLength(choiceButtons.length);

    const targetIndex = choiceButtons.findIndex(button =>
      button.textContent.includes(targetChoice.label)
    );

    expect(targetIndex).toBeGreaterThanOrEqual(0);

    fireEvent.keyDown(window, { key: String(targetIndex + 1) });

    await waitFor(() => {
      expect(screen.getByText("Correct").closest("button"))
        .toHaveAttribute("data-map-choice-feedback", "correct");
    });
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

  it("collapses the bulk 'found zones' row to Encore/Acquis when every found zone is relearning", async () => {
    renderMapReview(true, {
      mode: "type_all",
      reviewZones: reviewZones.map(zone => ({
        ...zone,
        progress: { relearning: true }
      }))
    });

    const input = screen.getByPlaceholderText("Tape une zone...");

    fireEvent.change(input, { target: { value: "Alpha" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));

    await screen.findByRole("button", { name: "Valider" });

    const bulkRow = screen.getByText("Zones trouvées").closest(".map-recap-bulk-row");
    const bulkButtons = within(bulkRow).getAllByRole("button");

    // Only the binary relearning choice is offered, never the four-way
    // Faux/Dur/Bon/Facile scale — none of that nuance is ever re-sent as a grade.
    expect(bulkButtons.map(button => button.title)).toEqual([
      "Appliquer aux zones trouvées : Encore",
      "Appliquer aux zones trouvées : Acquis"
    ]);
    expect(bulkButtons.every(button => !button.disabled)).toBe(true);
  });
});
