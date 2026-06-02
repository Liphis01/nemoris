import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTrainingItems,
  gradeTrainingTimeline,
  listTrainingScopes,
  recordGroupTrainingAttempt
} from "../../../api/training";
import TrainingSession from "./TrainingSession";

vi.mock("../../../api/training", () => ({
  getTrainingItems: vi.fn(),
  gradeTrainingTimeline: vi.fn(),
  listTrainingScopes: vi.fn(),
  recordGroupTrainingAttempt: vi.fn()
}));


describe("TrainingSession", () => {
  beforeEach(() => {
    listTrainingScopes.mockResolvedValue({
      groups: [{
        id: 5,
        type_group: "map",
        name: "Europe",
        media: "europe.svg",
        tags: ["Geo"],
        question_count: 8,
        training_record: {
          best_found_percent: 87.5,
          best_found_count: 7,
          best_found_elapsed_ms: 92000,
          best_found_at: "2026-06-02T10:00:00+00:00",
          best_time_ms: 90000,
          best_time_at: "2026-06-02T10:00:00+00:00",
          question_count: 8
        }
      }],
      tags: []
    });
    getTrainingItems.mockResolvedValue([]);
    gradeTrainingTimeline.mockResolvedValue({ status: "ok", results: [] });
    recordGroupTrainingAttempt.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows group best percent before clean time in the selector", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    expect(await screen.findByText("88%")).toBeInTheDocument();
    expect(screen.getByText("meilleur score")).toBeInTheDocument();
    expect(screen.getByText(/temps parfait 1:30/)).toBeInTheDocument();
  });
});
