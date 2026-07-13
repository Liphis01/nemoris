import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        group: { name: "Alphabet grec", tags: [] }
      })
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
        group: { name: "Nouvelle liste", tags: [] }
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
