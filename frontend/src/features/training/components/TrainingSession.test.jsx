import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      tags: [
        {
          name: "Geo",
          count: 13
        }
      ]
    });
    getTrainingItems.mockResolvedValue([]);
    gradeTrainingTimeline.mockResolvedValue({ status: "ok", results: [] });
    recordGroupTrainingAttempt.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows compact group records and best time in the selector", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Sélectionner Europe" })).toBeInTheDocument();
    expect(await screen.findByText("Score par défaut")).toBeInTheDocument();
    expect(screen.getAllByText("88%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("1:30").length).toBeGreaterThanOrEqual(2);
  });

  it("opens side-panel mode lists for map and image groups", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sélectionner Europe" }));

    expect(screen.getByText("Modes d'entrainement")).toBeInTheDocument();
    expect(screen.getByText("Tape toutes les zones dans l'ordre que tu veux.")).toBeInTheDocument();
    expect(screen.getByText("Regarde la zone surlignée, puis choisis le nom.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sélectionner Flags" }));

    expect(screen.getByText("Tape toutes les images dans l'ordre que tu veux.")).toBeInTheDocument();
    expect(screen.getByText("Lis le nom, puis choisis la bonne image.")).toBeInTheDocument();
  });

  it("starts a selected group mode from the detail panel", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sélectionner Europe" }));
    fireEvent.click(screen.getByRole("button", { name: "Démarrer QCM pour Europe" }));

    await waitFor(() => {
      expect(getTrainingItems).toHaveBeenCalledWith({
        scopeType: "group",
        groupId: 5,
        mapMode: "multiple_choice"
      });
    });
  });

  it("starts tag training directly from a compact tile", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Tags" }));
    fireEvent.click(screen.getByRole("button", { name: "Démarrer le tag Geo" }));

    await waitFor(() => {
      expect(getTrainingItems).toHaveBeenCalledWith({
        scopeType: "tag",
        tag: "Geo"
      });
    });
  });
});
