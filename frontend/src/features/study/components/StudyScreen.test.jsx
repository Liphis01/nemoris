import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStudySummary } from "../../../api/study";
import StudyScreen from "./StudyScreen";

vi.mock("../../../api/study", () => ({
  getStudySummary: vi.fn()
}));

const summary = {
  generated_on: "2026-08-14",
  scope: {
    type: "group",
    id: 10,
    name: "Départements français",
    type_group: "map",
    question_count: 4,
    audio_only: false,
    reverse_mode_enabled: false
  },
  counts: {
    total_atomic_questions: 4,
    active_questions: 4,
    suspended: 0,
    unavailable: 0,
    due_now: 1,
    upcoming_load: 2
  },
  buckets: {
    unseen: 1,
    learning: 1,
    fragile: 1,
    stable: 1,
    mastered: 0
  },
  recent_misses: {
    item_count: 1,
    event_count: 1,
    items: [
      {
        id: 2,
        type_q: "map",
        question: "03",
        answer: "Allier",
        group: {
          id: 10,
          name: "Départements français",
          type_group: "map"
        },
        signals: {
          bucket: "fragile",
          due: true,
          recent_misses: 1,
          lapses: 1,
          next_review: "2026-08-14"
        }
      }
    ]
  },
  lapses: {
    item_count: 1,
    total: 1
  },
  confusions: {
    event_count: 1,
    items: [
      {
        expected_id: 2,
        selected_id: 3,
        count: 1,
        expected: { id: 2, answer: "Allier" },
        selected: { id: 3, answer: "Alpes" }
      }
    ]
  },
  upcoming_load: {
    total: 2,
    by_day: [
      { date: "2026-08-15", total: 1 },
      { date: "2026-08-16", total: 1 }
    ]
  },
  weak_items: [
    {
      id: 2,
      type_q: "map",
      question: "03",
      answer: "Allier",
      group: {
        id: 10,
        name: "Départements français",
        type_group: "map"
      },
      signals: {
        bucket: "fragile",
        due: true,
        recent_misses: 1,
        lapses: 1,
        next_review: "2026-08-14"
      }
    }
  ],
  available_modes: [
    {
      scope: "group",
      type_group: "map",
      type_q: "map",
      training_modes: ["type_all", "multiple_choice"],
      review_modes: ["type_all", "multiple_choice"],
      training_support: "supported"
    }
  ],
  training: {
    training_record: null,
    previous_training_record: null,
    training_records: {},
    previous_training_records: {},
    groups: []
  }
};

describe("StudyScreen", () => {
  beforeEach(() => {
    getStudySummary.mockResolvedValue(summary);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads a study summary without mutating review state and routes actions", async () => {
    const onStartTraining = vi.fn();
    const setMode = vi.fn();

    render(
      <StudyScreen
        scope={{ type: "group", id: 10 }}
        setMode={setMode}
        onStartTraining={onStartTraining}
      />
    );

    expect(await screen.findByRole("heading", {
      name: "Départements français"
    })).toBeInTheDocument();
    expect(getStudySummary).toHaveBeenCalledWith({ type: "group", id: 10 });
    expect(screen.getByText("Reprendre les erreurs récentes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Réviser due" }));
    expect(setMode).toHaveBeenCalledWith("quiz");

    fireEvent.click(screen.getByRole("tab", { name: "Entraîner" }));
    fireEvent.click(screen.getByRole("button", { name: "QCM" }));

    await waitFor(() => {
      expect(onStartTraining).toHaveBeenCalledWith(
        {
          type: "group",
          id: 10,
          name: "Départements français",
          type_group: "map",
          audio_only: false,
          reverse_mode_enabled: false
        },
        "multiple_choice"
      );
    });

    expect(getStudySummary).toHaveBeenCalledTimes(1);
  });
});
