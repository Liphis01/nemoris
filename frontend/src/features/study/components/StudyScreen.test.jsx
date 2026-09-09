import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTrainingItems } from "../../../api/training";
import { saveLearnConfusions } from "../../../api/learn";
import StudyScreen from "./StudyScreen";

vi.mock("../../../api/training", () => ({
  getTrainingItems: vi.fn()
}));

vi.mock("../../../api/learn", () => ({
  saveLearnConfusions: vi.fn(() => Promise.resolve(null))
}));

vi.mock("../../map/components/SvgMap", () => ({
  default: ({ focusCode, missed, practiceCodes, zoneLabels }) => (
    <div
      data-testid="learn-map"
      data-focus={focusCode || ""}
      data-missed={(missed || []).join(",")}
      data-practice={(practiceCodes || []).join(",")}
      data-labels={Object.values(zoneLabels || {}).join(",")}
    />
  )
}));


function card(id, question, answer, extra = {}) {
  return {
    question_id: id,
    question,
    answer,
    label: answer,
    aliases: [],
    answer_policy: { preset: "relaxed" },
    progress: { reps: 0, history: [] },
    ...extra
  };
}


function textPayload(cards) {
  return [{
    group_id: 7,
    type_q: "text",
    presentation_kind: "text_group",
    name: "Signes du zodiaque",
    answer_policy: { preset: "relaxed" },
    items: cards,
    context_items: cards
  }];
}


const textCards = [
  card(1, "21 janvier - 19 février", "Verseau"),
  card(2, "20 février - 20 mars", "Poissons"),
  card(3, "21 mars - 19 avril", "Bélier", { progress: { reps: 4, history: [] } })
];

const biasCards = [
  card(10, "Tendance à chercher ce qui confirme une hypothèse", "Biais de confirmation"),
  card(11, "Tendance à dépendre de la formulation", "Biais de cadrage"),
  card(12, "Tendance à privilégier une croyance initiale", "Biais de croyance"),
  card(13, "Tendance à résister au changement", "Biais de conservatisme"),
  card(14, "Impression générale qui contamine le jugement", "Effet de halo")
];

const scope = { type: "group", id: 7, name: "Signes du zodiaque" };


describe("StudyScreen (Learn)", () => {
  beforeEach(() => {
    getTrainingItems.mockReset();
    saveLearnConfusions.mockReset();
    saveLearnConfusions.mockResolvedValue(null);
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("loads the whole group from the training endpoint", async () => {
    getTrainingItems.mockResolvedValue(textPayload(textCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByRole("heading", { name: "Signes du zodiaque" });

    // Reuses /training rather than a Learn-only endpoint: it already returns
    // every card in the group, with policies and aliases, and writes nothing.
    expect(getTrainingItems).toHaveBeenCalledWith({
      scopeType: "group",
      groupId: 7
    });
    expect(screen.getByText(/3 items/)).toBeInTheDocument();
    expect(screen.getByText(/2 jamais vus/)).toBeInTheDocument();
  });

  it("masks answers until a row is clicked", async () => {
    getTrainingItems.mockResolvedValue(textPayload(textCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("21 janvier - 19 février");
    expect(screen.queryByText("Verseau")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Verseau/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /item 1/ })).toBeInTheDocument();

    fireEvent.click(screen.getByText("21 janvier - 19 février"));

    expect(screen.getByText("Verseau")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Verseau/ })).toBeInTheDocument();
    expect(screen.queryByText("Poissons")).not.toBeInTheDocument();
  });

  it("only drills the cards the learner selected", async () => {
    getTrainingItems.mockResolvedValue(textPayload(textCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("21 janvier - 19 février");
    expect(screen.getByRole("button", { name: "Se tester" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /item 1/ }));

    expect(screen.getByText("1 sélectionné")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("21 janvier - 19 février")).toBeInTheDocument();
  });

  it("accepts a typed answer and finishes the drill", async () => {
    getTrainingItems.mockResolvedValue(textPayload(textCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("21 janvier - 19 février");
    fireEvent.click(screen.getByRole("checkbox", { name: /item 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
      target: { value: "verseau" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    expect(await screen.findByText("Série terminée")).toBeInTheDocument();
    expect(screen.getByText("Sans aide").closest("div")).toHaveTextContent("1");
  });

  it("buys a first-letter hint on a miss, then uses a meaningful choice scaffold", async () => {
    getTrainingItems.mockResolvedValue(textPayload(biasCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("Tendance à chercher ce qui confirme une hypothèse");
    fireEvent.click(screen.getByRole("checkbox", { name: /item 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    const input = screen.getByPlaceholderText("Ta réponse");

    fireEvent.change(input, { target: { value: "faux" } });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    // Recall first: a miss reveals letters rather than jumping to recognition.
    expect(screen.getByText("B···· d· c···········")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
      target: { value: "encore faux" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    expect(screen.queryByPlaceholderText("Ta réponse")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choix : Biais de confirmation" })).toBeInTheDocument();
  });

  it("reveals the answer instead of showing a trivial choice", async () => {
    getTrainingItems.mockResolvedValue(textPayload(textCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("21 janvier - 19 février");
    fireEvent.click(screen.getByRole("checkbox", { name: /item 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    for (const value of ["faux", "encore faux"]) {
      fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
        target: { value }
      });
      fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    }

    expect(screen.getByText("Réponse")).toBeInTheDocument();
    expect(screen.getByText("Verseau")).toBeInTheDocument();
    expect(document.querySelectorAll(".learn-choice")).toHaveLength(0);
  });

  it("saves the pairs mixed up in the choice step, once, at the end", async () => {
    getTrainingItems.mockResolvedValue(textPayload(biasCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("Tendance à chercher ce qui confirme une hypothèse");
    fireEvent.click(screen.getByRole("checkbox", { name: /item 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    // Two misses to reach the choice step.
    for (const value of ["faux", "encore faux"]) {
      fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
        target: { value }
      });
      fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Choix : Biais de confirmation" }));

    // Recognition is not enough: the same card must still be typed.
    fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
      target: { value: "Biais de confirmation" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    await screen.findByText("Série terminée");
    expect(screen.getByText("Après QCM").closest("div")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Retour à la liste" }));

    await waitFor(() => {
      expect(saveLearnConfusions).toHaveBeenCalledTimes(1);
    });

    const entries = saveLearnConfusions.mock.calls[0][0];

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(entry => entry.expected_id === 10)).toBe(true);
    expect(entries.every(entry => entry.picked_id !== 10)).toBe(true);
  });

  it("keeps the confusions gathered before the learner quits", async () => {
    getTrainingItems.mockResolvedValue(textPayload(biasCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("Tendance à chercher ce qui confirme une hypothèse");
    fireEvent.click(screen.getByRole("checkbox", { name: /item 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    for (const value of ["faux", "encore faux"]) {
      fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
        target: { value }
      });
      fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Choix : Biais de confirmation" }));

    // Walk out mid-drill: quitting is the common case, and the evidence
    // gathered so far must not be thrown away.
    fireEvent.click(screen.getByRole("button", { name: "Quitter" }));

    await waitFor(() => {
      expect(saveLearnConfusions).toHaveBeenCalledTimes(1);
    });
    expect(saveLearnConfusions.mock.calls[0][0].length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Reprendre" })).not.toBeDisabled();
    expect(JSON.parse(
      window.localStorage.getItem("nemoris:learn-drill:group:7")
    ).state.confusions).toEqual([]);
  });

  it("draws choice decoys from the whole group, not just the selection", async () => {
    getTrainingItems.mockResolvedValue(textPayload(biasCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("Tendance à chercher ce qui confirme une hypothèse");

    // Drill a single card: its compatible decoys must still come from the pool.
    fireEvent.click(screen.getByRole("checkbox", { name: /item 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    for (const value of ["faux", "encore faux"]) {
      fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
        target: { value }
      });
      fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    }

    const choices = document.querySelectorAll(".learn-choice");

    expect(choices).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Choix : Biais de confirmation" })).toBeInTheDocument();
  });

  it("selects smart batches from training progress and confusion data", async () => {
    const cards = [
      card(1, "p1", "A"),
      card(2, "p2", "B"),
      card(3, "p3", "C", {
        progress: {
          reps: 5,
          lapses: 2,
          difficulty: 6,
          history: [{ quality: 0 }]
        }
      }),
      card(4, "p4", "D", {
        progress: {
          reps: 3,
          lapses: 0,
          difficulty: 1,
          history: [{ quality: 1 }]
        }
      }),
      card(5, "p5", "E", {
        learn_confusions: [{ candidate_id: 6, exposures: 3, mispicks: 2 }]
      }),
      card(6, "p6", "F", {
        progress: {
          reps: 4,
          history: [{
            answer_event: {
              expected_card_id: 6,
              raw_response: 5,
              candidate_ids: [5, 6]
            }
          }]
        }
      })
    ];
    const checkbox = index => screen.getByRole("checkbox", { name: new RegExp(`item ${index}`) });

    getTrainingItems.mockResolvedValue(textPayload(cards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("p1");

    fireEvent.click(screen.getByRole("button", { name: "10 non-vus" }));
    expect(checkbox(1)).toBeChecked();
    expect(checkbox(2)).toBeChecked();
    expect(checkbox(3)).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "10 fragiles" }));
    expect(checkbox(1)).not.toBeChecked();
    expect(checkbox(3)).toBeChecked();
    expect(checkbox(4)).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "10 confusions" }));
    expect(checkbox(5)).toBeChecked();
    expect(checkbox(6)).toBeChecked();
    expect(checkbox(3)).not.toBeChecked();
  });

  it("resumes an unfinished drill from local storage", async () => {
    window.localStorage.setItem("nemoris:learn-drill:group:7", JSON.stringify({
      version: 1,
      state: {
        itemIds: [1, 2],
        queue: [2],
        step: "type",
        attempts: 0,
        hintLevel: 0,
        solved: [1],
        confusions: [],
        outcomes: {
          1: { support: "none", solved: true }
        },
        total: 2
      }
    }));
    getTrainingItems.mockResolvedValue(textPayload(textCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("21 janvier - 19 février");
    expect(screen.getByRole("button", { name: "Reprendre" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Reprendre" }));

    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByText("20 février - 20 mars")).toBeInTheDocument();
  });

  it("shows loading copy before the true empty-group state", async () => {
    let resolvePayload;

    getTrainingItems.mockReturnValue(new Promise(resolve => {
      resolvePayload = resolve;
    }));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    expect(screen.getByText("Chargement du groupe...")).toBeInTheDocument();
    expect(screen.getByText("Chargement...")).toBeInTheDocument();
    expect(screen.queryByText(/0 item/)).not.toBeInTheDocument();

    resolvePayload(textPayload([]));

    expect(await screen.findByText("Aucun item disponible dans ce groupe.")).toBeInTheDocument();
  });

  it("renders a map group on the map, revealing zones as they are opened", async () => {
    getTrainingItems.mockResolvedValue([{
      group_id: 3,
      type_q: "map",
      presentation_kind: "map_group",
      name: "Territoires",
      media: "monde.svg",
      map: null,
      items: [
        card(11, null, "Mexique", { code: "MX" }),
        card(12, null, "Brésil", { code: "BR" })
      ],
      context_items: []
    }]);

    render(
      <StudyScreen
        scope={{ type: "group", id: 3, name: "Territoires", type_group: "map" }}
        setMode={vi.fn()}
      />
    );

    const map = await screen.findByTestId("learn-map");

    // Zone names are unlabelled on the map until opened, but the index keeps
    // them readable so the learner can also go name -> location.
    expect(map).toHaveAttribute("data-labels", "");
    expect(screen.getByText("Mexique")).toBeInTheDocument();
    expect(screen.getByText("Brésil")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mexique" }));

    expect(screen.getByTestId("learn-map")).toHaveAttribute("data-labels", "Mexique");
    expect(screen.getByTestId("learn-map")).toHaveAttribute("data-focus", "MX");

    fireEvent.click(screen.getByRole("checkbox", { name: /Mexique/ }));

    expect(screen.getByTestId("learn-map")).toHaveAttribute("data-missed", "");
    expect(screen.getByTestId("learn-map")).toHaveAttribute("data-practice", "MX");
  });

  it("surfaces a load failure with a retry", async () => {
    getTrainingItems.mockRejectedValueOnce(new Error("Réseau indisponible"));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Réseau indisponible");

    getTrainingItems.mockResolvedValue(textPayload(textCards));
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByText("21 janvier - 19 février")).toBeInTheDocument();
  });
});
