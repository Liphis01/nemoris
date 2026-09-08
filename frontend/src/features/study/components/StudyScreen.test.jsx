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
  default: ({ focusCode, zoneLabels }) => (
    <div
      data-testid="learn-map"
      data-focus={focusCode || ""}
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

const scope = { type: "group", id: 7, name: "Signes du zodiaque" };


describe("StudyScreen (Learn)", () => {
  beforeEach(() => {
    getTrainingItems.mockReset();
    saveLearnConfusions.mockReset();
    saveLearnConfusions.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
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

    fireEvent.click(screen.getByText("21 janvier - 19 février"));

    expect(screen.getByText("Verseau")).toBeInTheDocument();
    expect(screen.queryByText("Poissons")).not.toBeInTheDocument();
  });

  it("only drills the cards the learner selected", async () => {
    getTrainingItems.mockResolvedValue(textPayload(textCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("21 janvier - 19 février");
    expect(screen.getByRole("button", { name: "Se tester" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /Verseau/ }));

    expect(screen.getByText("1 sélectionné")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("21 janvier - 19 février")).toBeInTheDocument();
  });

  it("accepts a typed answer and finishes the drill", async () => {
    getTrainingItems.mockResolvedValue(textPayload(textCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("21 janvier - 19 février");
    fireEvent.click(screen.getByRole("checkbox", { name: /Verseau/ }));
    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
      target: { value: "verseau" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    expect(await screen.findByText("Série terminée")).toBeInTheDocument();
  });

  it("buys a first-letter hint on a miss, then falls back to a choice", async () => {
    getTrainingItems.mockResolvedValue(textPayload(textCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("21 janvier - 19 février");
    fireEvent.click(screen.getByRole("checkbox", { name: /Verseau/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Poissons/ }));
    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    const input = screen.getByPlaceholderText("Ta réponse");

    fireEvent.change(input, { target: { value: "faux" } });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    // Recall first: a miss reveals letters rather than jumping to recognition.
    expect(screen.getByText("V······")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
      target: { value: "encore faux" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    expect(screen.queryByPlaceholderText("Ta réponse")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verseau" })).toBeInTheDocument();
  });

  it("saves the pairs mixed up in the choice step, once, at the end", async () => {
    getTrainingItems.mockResolvedValue(textPayload(textCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("21 janvier - 19 février");
    fireEvent.click(screen.getByRole("checkbox", { name: /Verseau/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Poissons/ }));
    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    // Two misses to reach the choice step.
    for (const value of ["faux", "encore faux"]) {
      fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
        target: { value }
      });
      fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Verseau" }));

    // Second card, answered straight away.
    fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
      target: { value: "Poissons" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    await screen.findByText("Série terminée");
    fireEvent.click(screen.getByRole("button", { name: "Retour à la liste" }));

    await waitFor(() => {
      expect(saveLearnConfusions).toHaveBeenCalledTimes(1);
    });

    const entries = saveLearnConfusions.mock.calls[0][0];

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(entry => entry.expected_id === 1)).toBe(true);
    expect(entries.every(entry => entry.picked_id !== 1)).toBe(true);
  });

  it("keeps the confusions gathered before the learner quits", async () => {
    getTrainingItems.mockResolvedValue(textPayload(textCards));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("21 janvier - 19 février");
    fireEvent.click(screen.getByRole("checkbox", { name: /Verseau/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Poissons/ }));
    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    for (const value of ["faux", "encore faux"]) {
      fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
        target: { value }
      });
      fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Verseau" }));

    // Walk out mid-drill: quitting is the common case, and the evidence
    // gathered so far must not be thrown away.
    fireEvent.click(screen.getByRole("button", { name: "Quitter" }));

    await waitFor(() => {
      expect(saveLearnConfusions).toHaveBeenCalledTimes(1);
    });
    expect(saveLearnConfusions.mock.calls[0][0].length).toBeGreaterThan(0);
  });

  it("draws choice decoys from the whole group, not just the selection", async () => {
    const many = [
      ...textCards,
      card(4, "20 avril - 20 mai", "Taureau"),
      card(5, "21 mai - 20 juin", "Gémeaux"),
      card(6, "21 juin - 22 juillet", "Cancer")
    ];

    getTrainingItems.mockResolvedValue(textPayload(many));

    render(<StudyScreen scope={scope} setMode={vi.fn()} />);

    await screen.findByText("21 janvier - 19 février");

    // Drill a single card: its decoys must still come from the other five.
    fireEvent.click(screen.getByRole("checkbox", { name: /Verseau/ }));
    fireEvent.click(screen.getByRole("button", { name: "Se tester" }));

    for (const value of ["faux", "encore faux"]) {
      fireEvent.change(screen.getByPlaceholderText("Ta réponse"), {
        target: { value }
      });
      fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    }

    const choices = document.querySelectorAll(".learn-choice");

    expect(choices).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Verseau" })).toBeInTheDocument();
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
