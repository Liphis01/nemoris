import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyIntakePlanActions,
  getIntakePlan,
  getIntakePlanDeck
} from "../../../api/review";
import IntakePlanDialog from "./IntakePlanDialog";

vi.mock("../../../api/review", () => ({
  getIntakePlan: vi.fn(),
  getIntakePlanDeck: vi.fn(),
  applyIntakePlanActions: vi.fn()
}));


function deck(key, name, overrides = {}) {
  return {
    key,
    group_id: 1,
    name,
    type_group: "text",
    paused: false,
    section: "next",
    position: null,
    counts: { unseen: 10, suspended: 0 },
    today_count: 0,
    eta: { starts: "months", finishes: "later" },
    ...overrides
  };
}


function makeSnapshot(overrides = {}) {
  return {
    revision: 3,
    settings: { focus: 2, new_decks: "end" },
    counts: { waiting: 30, paused: 5, suspended: 1, decks: 4, paused_decks: 1 },
    today: {
      quota: 5,
      count: 5,
      by_deck: [
        { key: "group:a", count: 3 },
        { key: "group:b", count: 2 }
      ],
      breakdown: {
        pace_tier: "intensif",
        daily_target: 80,
        new_min: 5,
        new_max: 40,
        review_load: 89,
        saturation: 1.11,
        new_fill: 5,
        new_budget_tuned: 5,
        ramp_ceiling: null,
        new_budget: 5,
        introduced_today: 0,
        introduced_yesterday: 0,
        wip_count: 100,
        wip_cap: 2000,
        wip_factor: 1,
        quota: 5
      }
    },
    decks: [
      deck("group:a", "Pokemons 1g", {
        type_group: "media",
        section: "focus",
        position: 1,
        today_count: 3,
        eta: { starts: "today", finishes: "month" }
      }),
      deck("group:b", "Biais cognitifs", {
        section: "focus",
        position: 2,
        today_count: 2,
        eta: { starts: "today", finishes: "month" }
      }),
      deck("loose", "Questions isolées", { type_group: null, position: 3 }),
      deck("group:p", "Races de chien", { paused: true, section: "paused" })
    ],
    ...overrides
  };
}


function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}


function deckNames() {
  return screen
    .getAllByRole("button", { name: /Voir les questions$/ })
    .map(button => button.querySelector(".intake-deck-name").textContent);
}


async function renderDialog(props = {}) {
  const onClose = vi.fn();

  render(<IntakePlanDialog onClose={onClose} {...props} />);
  await screen.findByText("Pokemons 1g", { selector: ".intake-deck-name" });

  return { onClose, dialog: screen.getByRole("dialog") };
}


describe("IntakePlanDialog", () => {
  beforeEach(() => {
    getIntakePlan.mockResolvedValue(makeSnapshot());
    getIntakePlanDeck.mockResolvedValue({
      revision: 3,
      deck: { key: "group:b", name: "Biais cognitifs", paused: false },
      questions: [
        { id: 11, type_q: "text", primary: "Effet Dunning-Kruger", secondary: "", feed_position: 1 },
        { id: 12, type_q: "text", primary: "Biais de confirmation", secondary: "", feed_position: 3 }
      ],
      suspended: []
    });
    applyIntakePlanActions.mockResolvedValue(makeSnapshot({ revision: 4 }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows today's split and every deck in its section", async () => {
    await renderDialog();

    expect(screen.getByText("5 aujourd'hui · 30 en attente · 4 paquets · 1 en pause")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "En cours" })).getByText("Pokemons 1g")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Ensuite" })).getByText("Questions isolées")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "En pause" })).getByText("Races de chien")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pokemons 1g\s*3 images/ })).toBeInTheDocument();
  });

  it("explains today's number on demand", async () => {
    await renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Pourquoi 5 ?" }));

    expect(screen.getByText("Rythme Intensif : entre 5 et 40 nouvelles par jour.")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const { onClose, dialog } = await renderDialog();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).toHaveBeenCalledWith({ changed: false });
  });

  it("backs out of a deck on Escape before closing", async () => {
    const { onClose, dialog } = await renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /^Biais cognitifs,/ }));
    await screen.findByText("Effet Dunning-Kruger");

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Aujourd'hui" })).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("keeps focus inside the dialog", async () => {
    const { dialog } = await renderDialog();
    const close = screen.getByRole("button", { name: "Fermer" });
    const policy = screen.getByRole("combobox");

    policy.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });

    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(policy);
  });

  it("sends every change with the revision it was built on", async () => {
    const onPlanChanged = vi.fn();
    const { onClose, dialog } = await renderDialog({ onPlanChanged });

    fireEvent.click(screen.getByRole("button", {
      name: "Mettre en pause les nouvelles de Biais cognitifs"
    }));

    await waitFor(() => expect(onPlanChanged).toHaveBeenCalled());
    expect(applyIntakePlanActions).toHaveBeenCalledWith(
      [{ type: "set_paused", keys: ["group:b"], paused: true }],
      3
    );

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).toHaveBeenCalledWith({ changed: true });
  });

  it("keeps a failed change on screen instead of wiping it on reload", async () => {
    const failure = new Error("Serveur indisponible");
    failure.status = 500;
    applyIntakePlanActions.mockRejectedValue(failure);
    await renderDialog();

    fireEvent.click(screen.getByRole("button", {
      name: "Mettre en pause les nouvelles de Biais cognitifs"
    }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Serveur indisponible");
    // The deck is back where it was, and the message stays until dismissed.
    expect(screen.getByRole("button", {
      name: "Mettre en pause les nouvelles de Biais cognitifs"
    })).toBeInTheDocument();

    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("Serveur indisponible");

    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("adopts the server's plan when the change was stale", async () => {
    const conflict = new Error("Le plan a changé ailleurs.");
    conflict.status = 409;
    conflict.snapshot = makeSnapshot({
      revision: 9,
      decks: makeSnapshot().decks.map(item => (
        item.key === "group:a"
          ? { ...item, paused: true, section: "paused", position: null }
          : item
      ))
    });
    applyIntakePlanActions.mockRejectedValue(conflict);
    await renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "3" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Le plan a changé ailleurs");
    expect(within(screen.getByRole("region", { name: "En pause" })).getByText("Pokemons 1g")).toBeInTheDocument();
  });

  it("moves a deck with Alt+↓ before the server answers", async () => {
    const pending = deferred();
    applyIntakePlanActions.mockReturnValue(pending.promise);
    await renderDialog();

    fireEvent.keyDown(screen.getByRole("button", { name: /^Pokemons 1g,/ }), {
      key: "ArrowDown",
      altKey: true
    });

    expect(applyIntakePlanActions).toHaveBeenCalledWith(
      [{ type: "move", key: "group:a", to_index: 1 }],
      3
    );
    expect(deckNames()).toEqual([
      "Biais cognitifs",
      "Pokemons 1g",
      "Questions isolées",
      "Races de chien"
    ]);

    await act(async () => pending.resolve(makeSnapshot({ revision: 4 })));
  });

  it("can drop a deck after the last active one", async () => {
    await renderDialog();
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: "", dropEffect: "" };
    const source = screen.getByRole("button", { name: /^Pokemons 1g,/ }).closest("li");
    const target = screen.getByRole("button", { name: /^Questions isolées,/ }).closest("li");

    target.getBoundingClientRect = () => ({ top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100 });

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(applyIntakePlanActions).toHaveBeenCalledWith(
      [{ type: "move", key: "group:a", to_index: 2 }],
      3
    );
  });

  it("does not drag in a filtered deck, and says why", async () => {
    await renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /^Biais cognitifs,/ }));
    await screen.findByText("Effet Dunning-Kruger");

    fireEvent.change(screen.getByRole("searchbox", { name: "Chercher dans ce paquet" }), {
      target: { value: "dunning" }
    });

    expect(screen.getByText("Efface la recherche pour glisser-déposer.")).toBeInTheDocument();
    expect(screen.getByText("Effet Dunning-Kruger").closest("li")).toHaveAttribute("draggable", "false");
    expect(screen.queryByText("Biais de confirmation")).not.toBeInTheDocument();
  });

  it("suspends a question from its deck and reports it to the caller", async () => {
    const onQuestionsChanged = vi.fn();
    await renderDialog({ onQuestionsChanged });

    fireEvent.click(screen.getByRole("button", { name: /^Biais cognitifs,/ }));
    const row = (await screen.findByText("Effet Dunning-Kruger")).closest("li");

    fireEvent.click(within(row).getByRole("button", { name: "Suspendre la question" }));

    await waitFor(() => expect(onQuestionsChanged).toHaveBeenCalledWith([
      { id: 11, suspended: true }
    ]));
    expect(applyIntakePlanActions).toHaveBeenCalledWith(
      [{ type: "set_suspended", question_ids: [11], suspended: true }],
      3
    );
  });
});
