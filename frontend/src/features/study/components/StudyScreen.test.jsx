import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStudySummary } from "../../../api/study";
import StudyScreen from "./StudyScreen";

vi.mock("../../../api/study", () => ({
  getStudySummary: vi.fn()
}));

vi.mock("../../map/components/SvgMap", () => ({
  default: ({ selected }) => (
    <div data-selected={selected} data-testid="study-learn-map" />
  )
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
  practice: {
    item_limit: 120,
    selectors: {
      recent_misses: {
        id: "recent_misses",
        label: "Travailler les erreurs récentes",
        question_ids: [2],
        count: 1,
        enabled: true
      },
      commonly_confused_pairs: {
        id: "commonly_confused_pairs",
        label: "Travailler les confusions",
        question_ids: [2, 3],
        count: 2,
        enabled: true
      },
      new_only: {
        id: "new_only",
        label: "Nouveaux uniquement",
        question_ids: [1],
        count: 1,
        enabled: true
      },
      almost_mastered: {
        id: "almost_mastered",
        label: "Presque maîtrisés",
        question_ids: [3],
        count: 1,
        enabled: true
      },
      before_tomorrow: {
        id: "before_tomorrow",
        label: "À revoir avant demain",
        question_ids: [2],
        count: 1,
        enabled: true
      }
    },
    entry_points: [
      {
        id: "recent_misses",
        label: "Travailler les erreurs récentes",
        question_ids: [2],
        count: 1,
        enabled: true
      },
      {
        id: "commonly_confused_pairs",
        label: "Travailler les confusions",
        question_ids: [2, 3],
        count: 2,
        enabled: true
      },
      {
        id: "new_only",
        label: "Nouveaux uniquement",
        question_ids: [1],
        count: 1,
        enabled: true
      },
      {
        id: "almost_mastered",
        label: "Presque maîtrisés",
        question_ids: [3],
        count: 1,
        enabled: true
      },
      {
        id: "before_tomorrow",
        label: "À revoir avant demain",
        question_ids: [2],
        count: 1,
        enabled: true
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
  learn: {
    supported: true,
    family: "map",
    group: {
      id: 10,
      name: "Départements français",
      type_group: "map",
      media: "france.svg"
    },
    item_count: 4,
    truncated: false,
    hints: [
      "first_letter",
      "category",
      "narrow_choices",
      "related_items",
      "reveal_answer"
    ],
    items: [
      {
        id: 1,
        type_q: "map",
        question: "Départements français - 01",
        answer: "Ain",
        code: "01",
        tags: ["Géographie"],
        aliases: [],
        signals: { bucket: "unseen", due: false }
      },
      {
        id: 2,
        type_q: "map",
        question: "Départements français - 03",
        answer: "Allier",
        code: "03",
        tags: ["Géographie"],
        aliases: [],
        signals: { bucket: "fragile", due: true }
      },
      {
        id: 3,
        type_q: "map",
        question: "Départements français - 04",
        answer: "Alpes",
        code: "04",
        tags: ["Géographie"],
        aliases: [],
        signals: { bucket: "stable", due: false }
      },
      {
        id: 4,
        type_q: "map",
        question: "Départements français - 07",
        answer: "Ardèche",
        code: "07",
        tags: ["Géographie"],
        aliases: [],
        signals: { bucket: "learning", due: false }
      }
    ]
  },
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

  it("starts targeted unscheduled practice from M4 weak selectors", async () => {
    const onStartTraining = vi.fn();
    const setMode = vi.fn();

    render(
      <StudyScreen
        scope={{ type: "group", id: 10 }}
        setMode={setMode}
        onStartTraining={onStartTraining}
      />
    );

    await screen.findByRole("heading", {
      name: "Départements français"
    });

    fireEvent.click(screen.getByRole("tab", { name: "Faibles" }));
    fireEvent.click(screen.getByRole("button", {
      name: /Travailler les erreurs récentes/
    }));

    expect(onStartTraining).toHaveBeenCalledWith(expect.objectContaining({
      type: "questions",
      name: "Travailler les erreurs récentes",
      questionIds: [2]
    }));

    fireEvent.click(screen.getByRole("button", {
      name: /Travailler les confusions/
    }));

    expect(onStartTraining).toHaveBeenCalledWith(expect.objectContaining({
      type: "questions",
      name: "Travailler les confusions",
      questionIds: [2, 3],
      mapMode: "multiple_choice",
      imageMode: "multiple_choice_media",
      textMode: "match",
      sequenceMode: "multiple_choice"
    }));
  });

  it("renders read-only Learn hints and reveals answers deliberately", async () => {
    const onStartTraining = vi.fn();
    const setMode = vi.fn();

    render(
      <StudyScreen
        scope={{ type: "group", id: 10 }}
        setMode={setMode}
        onStartTraining={onStartTraining}
      />
    );

    await screen.findByRole("heading", {
      name: "Départements français"
    });

    fireEvent.click(screen.getByRole("tab", { name: "Apprendre" }));

    expect(screen.getByTestId("study-learn-map")).toHaveAttribute(
      "data-selected",
      "01"
    );
    expect(screen.getByRole("heading", { name: "Réponse masquée" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Première lettre" }));
    expect(screen.getAllByText("Première lettre").length).toBeGreaterThan(0);
    expect(screen.getByText("A")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choix" }));
    expect(screen.getByText("Allier")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Révéler la réponse" }));
    expect(screen.getByRole("heading", { name: "Ain" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Entraîner" }));
    expect(onStartTraining).toHaveBeenCalledWith({
      type: "group",
      id: 10,
      name: "Départements français",
      type_group: "map",
      audio_only: false,
      reverse_mode_enabled: false
    });

    expect(getStudySummary).toHaveBeenCalledTimes(1);
  });
});
