import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TextGroupEditor from "./TextGroupEditor";
import {
  getTextGroupItems,
  patchTextGroupItems
} from "../../../api/textGroups";

vi.mock("../../../api/textGroups", () => ({
  getTextGroupItems: vi.fn(),
  patchTextGroupItems: vi.fn()
}));

vi.mock("../../../shared/tagLabels", async (importOriginal) => ({
  ...(await importOriginal()),
  invalidateTags: vi.fn(() => Promise.resolve())
}));

const group = {
  id: 42,
  type_group: "text",
  name: "Capitales",
  media: null,
  tags: [],
  data: {}
};

const items = [
  {
    id: 1,
    question: "Capitale de la France",
    answer: "Paris",
    aliases: ["Ville lumière"],
    tags: [],
    data: {}
  },
  {
    id: 2,
    question: "Capitale du Japon",
    answer: "Tokyo",
    aliases: ["Edo"],
    tags: [],
    data: {}
  }
];

function renderEditor(nextItems = items) {
  getTextGroupItems.mockResolvedValue(nextItems);

  render(
    <TextGroupEditor
      group={group}
      availableTags={[]}
      ensurePersistedGroup={vi.fn()}
      onSave={vi.fn()}
      selectedItem={null}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  patchTextGroupItems.mockResolvedValue({ group, items });
});

afterEach(cleanup);

describe("TextGroupEditor search", () => {
  it("filters rows by question, answer, and aliases", async () => {
    renderEditor();

    await screen.findByDisplayValue("Paris");

    const searchInput = screen.getByPlaceholderText("Recherche...");
    fireEvent.change(searchInput, { target: { value: "Japon" } });

    await waitFor(() => {
      expect(document.querySelectorAll("[data-text-group-item-row]")).toHaveLength(1);
    });
    expect(
      within(document.querySelector("[data-text-group-item-row]")).getByDisplayValue("Tokyo")
    ).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "Ville lumière" } });

    await waitFor(() => {
      expect(document.querySelectorAll("[data-text-group-item-row]")).toHaveLength(1);
    });
    expect(
      within(document.querySelector("[data-text-group-item-row]")).getByDisplayValue("Paris")
    ).toBeInTheDocument();
  });

  it("shows a no-results message and clears the search", async () => {
    renderEditor();

    await screen.findByDisplayValue("Paris");

    const searchInput = screen.getByPlaceholderText("Recherche...");
    fireEvent.change(searchInput, { target: { value: "introuvable" } });

    await screen.findByText("Aucun résultat pour « introuvable »");
    expect(document.querySelectorAll("[data-text-group-item-row]")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Effacer la recherche" }));

    expect(searchInput).toHaveValue("");
    await waitFor(() => {
      expect(document.querySelectorAll("[data-text-group-item-row]")).toHaveLength(2);
    });
  });

  it("clears an active search when adding a row", async () => {
    renderEditor();

    await screen.findByDisplayValue("Paris");

    const searchInput = screen.getByPlaceholderText("Recherche...");
    fireEvent.change(searchInput, { target: { value: "Japon" } });
    await waitFor(() => {
      expect(document.querySelectorAll("[data-text-group-item-row]")).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Ajouter une ligne" }));

    expect(searchInput).toHaveValue("");
    await waitFor(() => {
      expect(document.querySelector("[data-text-group-item-id^='new-text-']")).toBeInTheDocument();
    });
  });

  it("adds a row from the dotted new-line slot", async () => {
    renderEditor();

    await screen.findByDisplayValue("Paris");

    fireEvent.click(document.querySelector("[data-text-group-add-cell]"));

    await waitFor(() => {
      expect(document.querySelector("[data-text-group-item-id^='new-text-']")).toBeInTheDocument();
    });
  });
});
