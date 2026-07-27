import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCollection,
  previewCollection,
  updateCollection
} from "../../../api/collections";
import PlaylistBuilder from "./PlaylistBuilder";

vi.mock("../../../api/collections", () => ({
  createCollection: vi.fn(),
  previewCollection: vi.fn(),
  updateCollection: vi.fn()
}));

const groups = [
  { id: 7, name: "Drapeaux du monde", type_group: "media" },
  { id: 9, name: "Geographie", type_group: "text" }
];

function previewResult(overrides = {}) {
  return {
    total: 2,
    group_count: 2,
    type_counts: { media: 1, text: 1 },
    clause_counts: [1, 1],
    items: [
      {
        id: 1,
        type_q: "media",
        title: "Drapeau du Bresil",
        group: { id: 7, name: "Drapeaux du monde" }
      },
      {
        id: 2,
        type_q: "text",
        title: "Capitale du Bresil",
        group: { id: 9, name: "Geographie" }
      }
    ],
    ...overrides
  };
}

describe("PlaylistBuilder", () => {
  beforeEach(() => {
    previewCollection.mockResolvedValue(previewResult());
    createCollection.mockResolvedValue({ id: 3, name: "Drapeaux mix" });
    updateCollection.mockResolvedValue({ id: 3, name: "Drapeaux mix" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the live resolved total, not a page count", async () => {
    render(<PlaylistBuilder groups={groups} onSaved={vi.fn()} onCancel={vi.fn()} />);

    // The whole point of the rewrite: the number is the real resolution.
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("2");
    });
    expect(screen.getByRole("status")).toHaveTextContent("2 groupes");
    expect(await screen.findByText("Drapeau du Bresil")).toBeInTheDocument();
  });

  it("builds a group-or-tag rule and saves it as rules, not a snapshot", async () => {
    const onSaved = vi.fn();
    render(
      <PlaylistBuilder groups={groups} onSaved={onSaved} onCancel={vi.fn()} />
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: "Nom de la playlist" }),
      "Drapeaux mix"
    );
    await userEvent.click(screen.getByRole("button", { name: "+ groupe" }));
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Groupe de la règle 1" }),
      "7"
    );
    await userEvent.click(screen.getByRole("button", { name: "+ tag" }));
    await userEvent.type(
      screen.getByRole("combobox", { name: "Tag de la règle 2" }),
      "drapeaux"
    );
    await userEvent.click(screen.getByRole("button", { name: "Créer" }));

    await waitFor(() => {
      expect(createCollection).toHaveBeenCalledWith({
        name: "Drapeaux mix",
        rules: {
          match: "any",
          clauses: [
            { kind: "group", group_id: 7 },
            { kind: "tag", tag: "drapeaux" }
          ]
        },
        question_ids: [],
        excluded_question_ids: []
      });
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("excluding a question records an exclusion rather than rewriting members", async () => {
    render(<PlaylistBuilder groups={groups} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Exclure Drapeau du Bresil" })
    );

    await waitFor(() => {
      expect(previewCollection).toHaveBeenLastCalledWith(
        expect.objectContaining({ excluded_question_ids: [1] })
      );
    });
    expect(
      screen.getByRole("button", { name: /Rétablir 1 exclue/ })
    ).toBeInTheDocument();
  });

  it("refuses to save without a name", async () => {
    render(<PlaylistBuilder groups={groups} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Créer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le nom est obligatoire."
    );
    expect(createCollection).not.toHaveBeenCalled();
  });

  it("loads an existing playlist's rules for editing", async () => {
    render(
      <PlaylistBuilder
        playlist={{
          id: 3,
          name: "Drapeaux mix",
          rules: {
            match: "all",
            clauses: [{ kind: "tag", tag: "drapeaux" }]
          },
          pinned_question_ids: [5],
          excluded_question_ids: []
        }}
        groups={groups}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole("textbox", { name: "Nom de la playlist" }))
      .toHaveValue("Drapeaux mix");
    expect(screen.getByRole("combobox", { name: "Combinaison des règles" }))
      .toHaveValue("all");
    expect(screen.getByRole("combobox", { name: "Tag de la règle 1" }))
      .toHaveValue("drapeaux");

    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      expect(updateCollection).toHaveBeenCalledWith(3, expect.objectContaining({
        rules: { match: "all", clauses: [{ kind: "tag", tag: "drapeaux" }] },
        question_ids: [5]
      }));
    });
  });
});
