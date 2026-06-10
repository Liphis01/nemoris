import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      groups: [
        {
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
        },
        {
          id: 6,
          type_group: "image",
          name: "Flags",
          media: null,
          tags: ["Geo"],
          question_count: 5,
          training_records: {
            multiple_choice_image: {
              best_found_percent: 100,
              best_found_count: 5,
              best_found_elapsed_ms: 30000,
              best_found_at: "2026-06-02T10:00:00+00:00",
              best_time_ms: 30000,
              best_time_at: "2026-06-02T10:00:00+00:00",
              question_count: 5
            }
          }
        }
      ],
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

    expect(await screen.findAllByText("88%")).toHaveLength(2);
    expect(screen.getAllByText("meilleur score par defaut")).toHaveLength(2);
    expect(screen.getByText(/temps parfait 1:30/)).toBeInTheDocument();
  });

  it("opens adaptive mode lists for map and image groups", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByText("Europe"));

    expect(screen.getByText("Tape toutes les zones dans l'ordre que tu veux.")).toBeInTheDocument();
    expect(screen.getByText("Regarde la zone surlignée, puis choisis le nom.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Retour"));
    fireEvent.click(screen.getByText("Flags"));

    expect(screen.getByText("Tape toutes les images dans l'ordre que tu veux.")).toBeInTheDocument();
    expect(screen.getByText("Lis le nom, puis choisis la bonne image.")).toBeInTheDocument();
  });
});
