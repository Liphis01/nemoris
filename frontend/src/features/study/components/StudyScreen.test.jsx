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

const mediaSummary = {
  ...summary,
  scope: {
    ...summary.scope,
    id: 20,
    name: "Drapeaux",
    type_group: "media",
    question_count: 2
  },
  counts: {
    ...summary.counts,
    total_atomic_questions: 2,
    active_questions: 2,
    due_now: 0,
    upcoming_load: 0
  },
  buckets: {
    unseen: 1,
    learning: 1,
    fragile: 0,
    stable: 0,
    mastered: 0
  },
  available_modes: [
    {
      scope: "group",
      type_group: "media",
      type_q: "media",
      training_modes: ["type_prompt", "multiple_choice_media"],
      review_modes: ["type_prompt", "multiple_choice_media"],
      training_support: "supported"
    }
  ],
  learn: {
    supported: true,
    family: "media",
    group: {
      id: 20,
      name: "Drapeaux",
      type_group: "media",
      media: null
    },
    item_count: 2,
    truncated: false,
    hints: summary.learn.hints,
    items: [
      {
        id: 11,
        type_q: "media",
        question: "Drapeau français",
        answer: "France",
        media: "france.png",
        media_pool: ["france.png"],
        media_kind: "image",
        tags: ["Géographie"],
        aliases: ["République française"],
        signals: { bucket: "unseen", due: false }
      },
      {
        id: 12,
        type_q: "media",
        question: "Drapeau allemand",
        answer: "Allemagne",
        media: "germany.png",
        media_pool: ["germany.png"],
        media_kind: "image",
        tags: ["Géographie"],
        aliases: [],
        signals: { bucket: "learning", due: false }
      }
    ]
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
    const onStartReview = vi.fn();
    const onStartTraining = vi.fn();
    const setMode = vi.fn();

    render(
      <StudyScreen
        onStartReview={onStartReview}
        onStartTraining={onStartTraining}
        scope={{ type: "group", id: 10 }}
        setMode={setMode}
      />
    );

    expect(await screen.findByRole("heading", {
      name: "Départements français"
    })).toBeInTheDocument();
    expect(getStudySummary).toHaveBeenCalledWith({ type: "group", id: 10 });
    expect(screen.getByText("Faire la review due")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Aujourd'hui" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Apprendre" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Entraîner" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Faibles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Historique" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Réviser ce scope" }));
    expect(onStartReview).toHaveBeenCalledWith(summary.scope);
    expect(setMode).not.toHaveBeenCalledWith("quiz");

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

  it("renders map Learn as a guided path without raw zone labels", async () => {
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
    expect(screen.getByRole("heading", {
      name: "Observe, puis retrouve la réponse"
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      name: "Parcours d'apprentissage"
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Étape 1 · Non vu"
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Étape 2 · Fragile · Due"
    })).toBeInTheDocument();
    expect(screen.queryByText("Zone 01")).not.toBeInTheDocument();
    expect(screen.queryByText("Zone 03")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Première lettre" }));
    expect(screen.getAllByText("Première lettre").length).toBeGreaterThan(0);
    expect(screen.getByText("A")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choix" }));
    expect(screen.getByText("Allier")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Révéler la réponse" }));
    expect(screen.getByRole("heading", { name: "Ain" })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Ain · Vu"
    })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Masquer" })).not.toBeInTheDocument();
    expect(onStartTraining).not.toHaveBeenCalled();

    expect(getStudySummary).toHaveBeenCalledTimes(1);
  });

  it("renders media Learn without generic media labels", async () => {
    getStudySummary.mockResolvedValueOnce(mediaSummary);

    render(
      <StudyScreen
        scope={{ type: "group", id: 20 }}
        setMode={vi.fn()}
        onStartTraining={vi.fn()}
      />
    );

    await screen.findByRole("heading", { name: "Drapeaux" });
    fireEvent.click(screen.getByRole("tab", { name: "Apprendre" }));

    expect(screen.getByAltText("Média à apprendre")).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Étape 1 · Non vu"
    })).toBeInTheDocument();
    expect(screen.queryByText("Média 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Média 2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Révéler la réponse" }));

    expect(screen.getByRole("heading", { name: "France" })).toBeInTheDocument();
    expect(screen.getByText("République française")).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "France · Vu"
    })).toBeInTheDocument();
  });

  it("tracks local Learn outcomes and restarts only items marked for review", async () => {
    const onStartTraining = vi.fn();

    render(
      <StudyScreen
        scope={{ type: "group", id: 10 }}
        setMode={vi.fn()}
        onStartTraining={onStartTraining}
      />
    );

    await screen.findByRole("heading", {
      name: "Départements français"
    });
    fireEvent.click(screen.getByRole("tab", { name: "Apprendre" }));

    fireEvent.click(screen.getByRole("button", { name: "Révéler la réponse" }));
    fireEvent.click(screen.getByRole("button", { name: "Je savais" }));
    expect(onStartTraining).not.toHaveBeenCalled();
    expect(screen.getByTestId("study-learn-map")).toHaveAttribute(
      "data-selected",
      "03"
    );
    expect(screen.getByRole("button", {
      name: "Ain · Je savais"
    })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Révéler la réponse" }));
    fireEvent.click(screen.getByRole("button", { name: "À revoir" }));
    expect(screen.getByRole("button", {
      name: "Allier · À revoir"
    })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Révéler la réponse" }));
    fireEvent.click(screen.getByRole("button", { name: "Passer" }));

    fireEvent.click(screen.getByRole("button", { name: "Révéler la réponse" }));
    fireEvent.click(screen.getByRole("button", { name: "Je savais" }));

    expect(screen.getByRole("heading", { name: "Parcours terminé" })).toBeInTheDocument();
    expect(screen.getByText("Vus")).toBeInTheDocument();
    expect(screen.getAllByText("Je savais").length).toBeGreaterThan(0);
    expect(screen.getAllByText("À revoir").length).toBeGreaterThan(0);
    expect(onStartTraining).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reprendre les à revoir" }));
    expect(screen.getByTestId("study-learn-map")).toHaveAttribute(
      "data-selected",
      "03"
    );
    expect(screen.getByRole("heading", {
      name: "Observe, puis retrouve la réponse"
    })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Entraîner" }));
    expect(onStartTraining).toHaveBeenCalledWith({
      type: "group",
      id: 10,
      name: "Départements français",
      type_group: "map",
      audio_only: false,
      reverse_mode_enabled: false
    });
  });

  it("hides Learn for unsupported scopes and keeps only enabled practice entries", async () => {
    const unsupportedSummary = {
      ...summary,
      scope: {
        ...summary.scope,
        type_group: "sequence"
      },
      learn: {
        ...summary.learn,
        supported: false,
        item_count: 0,
        items: []
      },
      practice: {
        ...summary.practice,
        entry_points: [
          ...summary.practice.entry_points,
          {
            id: "disabled",
            label: "Mode indisponible",
            question_ids: [],
            count: 0,
            enabled: false
          }
        ]
      }
    };
    getStudySummary.mockResolvedValueOnce(unsupportedSummary);

    render(
      <StudyScreen
        scope={{ type: "group", id: 10 }}
        setMode={vi.fn()}
        onStartTraining={vi.fn()}
      />
    );

    await screen.findByRole("heading", {
      name: "Départements français"
    });

    expect(screen.queryByRole("tab", { name: "Apprendre" })).not.toBeInTheDocument();
    expect(screen.queryByText("Modes disponibles")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mode indisponible/ })).not.toBeInTheDocument();
  });
});
