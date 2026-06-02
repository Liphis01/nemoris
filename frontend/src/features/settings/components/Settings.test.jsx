import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getReviewSettings,
  rebalanceReviewCalendar,
  updateReviewSettings
} from "../../../api/review";
import Settings from "./Settings";

vi.mock("../../../api/review", () => ({
  getReviewSettings: vi.fn(),
  rebalanceReviewCalendar: vi.fn(),
  updateReviewSettings: vi.fn()
}));

describe("Settings", () => {
  beforeEach(() => {
    getReviewSettings.mockResolvedValue({ catchup_daily_target: 35 });
    updateReviewSettings.mockResolvedValue({ catchup_daily_target: 40 });
    rebalanceReviewCalendar.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the current daily target", async () => {
    render(<Settings setMode={vi.fn()} />);

    expect(await screen.findByDisplayValue("35")).toBeInTheDocument();
    expect(getReviewSettings).toHaveBeenCalledTimes(1);
  });

  it("saves a normalized target and rebalances the calendar", async () => {
    render(<Settings setMode={vi.fn()} />);

    const input = await screen.findByLabelText("Objectif quotidien");
    fireEvent.change(input, {
      target: {
        value: "40.8"
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      expect(updateReviewSettings).toHaveBeenCalledWith({
        catchup_daily_target: 40
      });
    });

    expect(rebalanceReviewCalendar).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("40")).toBeInTheDocument();
    expect(
      screen.getByText("Paramètres enregistrés. Calendrier rééquilibré.")
    ).toBeInTheDocument();
  });

  it("does not save or rebalance an unchanged target", async () => {
    render(<Settings setMode={vi.fn()} />);

    await screen.findByDisplayValue("35");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(updateReviewSettings).not.toHaveBeenCalled();
    expect(rebalanceReviewCalendar).not.toHaveBeenCalled();
  });

  it("shows save errors and restores the previous target draft", async () => {
    updateReviewSettings.mockRejectedValue(new Error("Save failed"));
    render(<Settings setMode={vi.fn()} />);

    const input = await screen.findByLabelText("Objectif quotidien");
    fireEvent.change(input, {
      target: {
        value: "42"
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByDisplayValue("35")).toBeInTheDocument();
    expect(rebalanceReviewCalendar).not.toHaveBeenCalled();
  });
});
