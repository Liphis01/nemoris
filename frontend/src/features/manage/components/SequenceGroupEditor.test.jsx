import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SequenceGroupEditor from "./SequenceGroupEditor";
import {
  getSequenceGroupItems,
  patchSequenceGroupItems
} from "../../../api/sequenceGroups";

vi.mock("../../../api/sequenceGroups", () => ({
  getSequenceGroupItems: vi.fn(),
  patchSequenceGroupItems: vi.fn()
}));

const pendingGroup = {
  id: null,
  type_group: "sequence",
  name: "",
  media: null,
  tags: [],
  data: {}
};

function renderPending(ensurePersistedGroup) {
  render(
    <SequenceGroupEditor
      group={pendingGroup}
      availableTags={[]}
      ensurePersistedGroup={ensurePersistedGroup}
      onSave={vi.fn()}
      selectedItem={null}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  patchSequenceGroupItems.mockResolvedValue({ group: {}, items: [] });
});

afterEach(cleanup);

describe("SequenceGroupEditor — group not yet persisted", () => {
  it("does not fetch items for a group that has no id", () => {
    renderPending(vi.fn());

    expect(getSequenceGroupItems).not.toHaveBeenCalled();
  });

  it("saves nothing while the list is unnamed and empty", async () => {
    // ensurePersistedGroup is the gate: an untouched editor must never create a
    // group, so a mis-click leaves no empty row behind.
    const ensurePersistedGroup = vi.fn().mockResolvedValue(null);

    renderPending(ensurePersistedGroup);

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchSequenceGroupItems).not.toHaveBeenCalled()
    );
  });

  it("creates the group once it has a name", async () => {
    const ensurePersistedGroup = vi.fn().mockResolvedValue({
      id: 7,
      name: "Alphabet grec"
    });

    renderPending(ensurePersistedGroup);

    fireEvent.change(screen.getByLabelText("Nom de la liste"), {
      target: { value: "Alphabet grec" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(ensurePersistedGroup).toHaveBeenCalledWith({
        name: "Alphabet grec",
        itemCount: 0
      })
    );

    expect(patchSequenceGroupItems).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        group: expect.objectContaining({ name: "Alphabet grec", tags: [] })
      })
    );
  });

  it("persists the answer policy preset", async () => {
    const ensurePersistedGroup = vi.fn().mockResolvedValue({
      id: 11,
      name: "Nouvelle liste"
    });

    renderPending(ensurePersistedGroup);

    fireEvent.change(screen.getByLabelText("Politique de réponse"), {
      target: { value: "exact" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchSequenceGroupItems).toHaveBeenCalledWith(
        11,
        expect.objectContaining({
          group: expect.objectContaining({
            answer_policy: expect.objectContaining({
              preset: "exact",
              diacritics: "strict"
            })
          })
        })
      )
    );
  });

  it("keeps the fallback name when the list is saved unnamed", async () => {
    // The group is created under a default name; the PATCH that follows must
    // adopt it rather than blanking the name back out.
    const ensurePersistedGroup = vi.fn().mockResolvedValue({
      id: 9,
      name: "Nouvelle liste"
    });

    renderPending(ensurePersistedGroup);

    fireEvent.click(screen.getByRole("button", { name: "Ajouter une ligne" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Élément 1" }), {
      target: { value: "Alpha" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(ensurePersistedGroup).toHaveBeenCalledWith({
        name: "",
        itemCount: 1
      })
    );

    expect(patchSequenceGroupItems).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        group: expect.objectContaining({ name: "Nouvelle liste", tags: [] })
      })
    );
  });

  it("sends the row order as the rank", async () => {
    const ensurePersistedGroup = vi.fn().mockResolvedValue({
      id: 3,
      name: "Liste"
    });

    renderPending(ensurePersistedGroup);

    fireEvent.click(screen.getByRole("button", { name: "Coller une liste" }));
    fireEvent.change(
      screen.getByLabelText("Coller une liste, un élément par ligne"),
      { target: { value: "Alpha\nBêta\nGamma" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Ajouter à la liste" }));

    // Move Gamma to the top; the payload order is what the backend ranks on.
    fireEvent.click(screen.getByRole("button", { name: "Monter l'élément 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Monter l'élément 2" }));

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(patchSequenceGroupItems).toHaveBeenCalled());

    const [, payload] = patchSequenceGroupItems.mock.calls.at(-1);

    expect(payload.items.map(item => item.answer)).toEqual([
      "Gamma",
      "Alpha",
      "Bêta"
    ]);
  });
});

describe("SequenceGroupEditor search", () => {
  function renderPersisted(items = []) {
    getSequenceGroupItems.mockResolvedValue(items);

    render(
      <SequenceGroupEditor
        group={{
          id: 17,
          type_group: "sequence",
          name: "Alphabet",
          media: null,
          tags: [],
          data: {}
        }}
        availableTags={[]}
        ensurePersistedGroup={vi.fn()}
        onSave={vi.fn()}
        selectedItem={null}
      />
    );
  }

  it("filters rows by answer and aliases", async () => {
    renderPersisted([
      { id: 1, answer: "Alpha", label: "Alpha", aliases: ["première"], tags: [], data: {} },
      { id: 2, answer: "Bêta", label: "Bêta", aliases: [], tags: [], data: {} },
      { id: 3, answer: "Gamma", label: "Gamma", aliases: ["troisième"], tags: [], data: {} }
    ]);

    await screen.findByDisplayValue("Alpha");

    const searchInput = screen.getByPlaceholderText("Recherche...");
    fireEvent.change(searchInput, { target: { value: "Gamma" } });

    await waitFor(() => {
      expect(document.querySelectorAll("[data-sequence-item-row]")).toHaveLength(1);
    });
    expect(
      within(document.querySelector("[data-sequence-item-row]")).getByDisplayValue("Gamma")
    ).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "première" } });

    await waitFor(() => {
      expect(document.querySelectorAll("[data-sequence-item-row]")).toHaveLength(1);
    });
    expect(
      within(document.querySelector("[data-sequence-item-row]")).getByDisplayValue("Alpha")
    ).toBeInTheDocument();
  });

  it("disables manual reordering while the list is filtered", async () => {
    renderPersisted([
      { id: 1, answer: "Alpha", label: "Alpha", aliases: [], tags: [], data: {} },
      { id: 2, answer: "Bêta", label: "Bêta", aliases: [], tags: [], data: {} },
      { id: 3, answer: "Gamma", label: "Gamma", aliases: [], tags: [], data: {} }
    ]);

    await screen.findByDisplayValue("Alpha");

    fireEvent.change(screen.getByPlaceholderText("Recherche..."), {
      target: { value: "Gamma" }
    });

    await waitFor(() => {
      expect(document.querySelectorAll("[data-sequence-item-row]")).toHaveLength(1);
    });
    expect(screen.queryByRole("button", { name: /Monter l'élément/ })).toBeNull();
    expect(document.querySelector("[data-sequence-item-row]").draggable).toBe(false);
  });

  it("adds a row from the dotted new-line slot", async () => {
    renderPersisted([
      { id: 1, answer: "Alpha", label: "Alpha", aliases: [], tags: [], data: {} }
    ]);

    await screen.findByDisplayValue("Alpha");

    fireEvent.click(document.querySelector("[data-sequence-group-add-cell]"));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Élément 2" })).toBeInTheDocument();
    });
  });
});

describe("SequenceGroupEditor — derived order", () => {
  function renderDerived(items = []) {
    getSequenceGroupItems.mockResolvedValue(items);

    render(
      <SequenceGroupEditor
        group={{
          id: 9,
          type_group: "sequence",
          name: "Rois de France",
          media: null,
          tags: [],
          data: { order: { mode: "derived", kind: "date" } }
        }}
        availableTags={[]}
        ensurePersistedGroup={vi.fn()}
        onSave={vi.fn()}
        selectedItem={null}
      />
    );
  }

  const withYear = (id, answer, year) => ({
    id,
    answer,
    label: answer,
    aliases: [],
    tags: [],
    data: {
      order_value: { year, month: null, day: null, precision: "year" }
    }
  });

  it("previews the derived order instead of the stored array order", async () => {
    renderDerived([
      withYear(1, "Louis XVI", 1774),
      withYear(2, "Henri IV", 1589),
      withYear(3, "Louis XIV", 1643)
    ]);

    await screen.findByDisplayValue("Henri IV");

    const answers = [...document.querySelectorAll("[data-sequence-item-row] input")]
      .filter(node => node.getAttribute("aria-label")?.startsWith("Élément "))
      .map(node => node.value);

    expect(answers).toEqual(["Henri IV", "Louis XIV", "Louis XVI"]);
  });

  it("hides manual reordering, which the next save would discard", async () => {
    renderDerived([withYear(1, "Henri IV", 1589), withYear(2, "Louis XIV", 1643)]);

    await screen.findByDisplayValue("Henri IV");

    expect(screen.queryByRole("button", { name: /Monter l'élément/ })).toBeNull();
    expect(
      document.querySelector("[data-sequence-item-row]").draggable
    ).toBe(false);
  });

  it("marks an item with no value, since it will sort last", async () => {
    renderDerived([
      withYear(1, "Henri IV", 1589),
      { id: 2, answer: "Inconnu", label: "Inconnu", aliases: [], tags: [], data: {} }
    ]);

    await screen.findByDisplayValue("Inconnu");

    const inputs = [...document.querySelectorAll("[data-sequence-order-value]")];

    expect(inputs.map(node => node.value)).toEqual(["1589", ""]);
  });

  it("enables saving when only the order setting changed", async () => {
    // buildSignature must cover the order setting, or the Save button never
    // enables and switching modes is silently lost.
    renderDerived([withYear(1, "Henri IV", 1589)]);

    await screen.findByDisplayValue("Henri IV");

    fireEvent.click(screen.getByRole("button", { name: /^Ordre/ }));
    fireEvent.change(screen.getByLabelText("Ordre de la liste"), {
      target: { value: "manual" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(patchSequenceGroupItems).toHaveBeenCalled());

    const [, payload] = patchSequenceGroupItems.mock.calls.at(-1);

    expect(payload.group.order.mode).toBe("manual");
  });

  it("shows the inferred goal and persists an explicit override", async () => {
    renderDerived([withYear(1, "Henri IV", 1589)]);

    await screen.findByDisplayValue("Henri IV");
    fireEvent.click(screen.getByRole("button", { name: /^Ordre/ }));

    expect(screen.getByText(/l'accès par position pour un ordre calculé/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Objectif de révision"), {
      target: { value: "recitation" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(patchSequenceGroupItems).toHaveBeenCalled());

    const [, payload] = patchSequenceGroupItems.mock.calls.at(-1);

    expect(payload.group.review_goal).toBe("recitation");
  });

  it("posts the typed attribute value with the item", async () => {
    renderDerived([withYear(1, "Henri IV", 1589)]);

    await screen.findByDisplayValue("Henri IV");

    fireEvent.change(screen.getByLabelText("Valeur d'ordre de l'élément 1"), {
      target: { value: "1590" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(patchSequenceGroupItems).toHaveBeenCalled());

    const [, payload] = patchSequenceGroupItems.mock.calls.at(-1);

    expect(payload.items[0].data.order_value).toEqual({
      year: 1590,
      month: null,
      day: null,
      precision: "year"
    });
  });
});
