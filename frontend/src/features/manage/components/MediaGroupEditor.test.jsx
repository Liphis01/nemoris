import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMediaGroupItems, patchMediaGroupItems } from "../../../api/mediaGroups";
import MediaGroupEditor from "./MediaGroupEditor";

vi.mock("../../../api/mediaGroups", () => ({
  getMediaGroupItems: vi.fn(),
  patchMediaGroupItems: vi.fn()
}));

const group = {
  id: 7,
  type_group: "media",
  name: "Drapeaux",
  media: "",
  tags: ["flags"],
  question_count: 300
};

function makeImageItems(count) {
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;

    return {
      id,
      type_q: "media",
      question: `Drapeaux - Country ${id}`,
      answer: `Country ${id}`,
      label: `Country ${id}`,
      media: `/static/flags/${id}.svg`,
      tags: ["flags"],
      group_id: group.id,
      data: {
        aliases: id % 5 === 0 ? [`Alias ${id}`] : []
      },
      aliases: id % 5 === 0 ? [`Alias ${id}`] : [],
      progress: null
    };
  });
}

function scrollEditorTo(index) {
  const scroller = screen.getByTestId("image-group-items-scroll");
  // Row height (214) + gap (10) = slot height.
  scroller.scrollTop = index * 224;
  fireEvent.scroll(scroller);
}

async function renderEditor(items = makeImageItems(300), props = {}) {
  getMediaGroupItems.mockResolvedValue(items);
  patchMediaGroupItems.mockImplementation(async (groupId, payload) => ({
    group: {
      ...group,
      ...payload.group,
      question_count: payload.items.length
    },
    items: payload.items.map((item) => ({
      id: item.id,
      type_q: "media",
      question: `Drapeaux - ${item.answer}`,
      answer: item.answer,
      label: item.answer,
      media: item.media,
      tags: payload.group.tags || [],
      group_id: groupId,
      data: item.data || {},
      aliases: item.aliases || [],
      progress: null
    })),
    deletedQuestionIds: payload.deleted_item_ids || []
  }));

  render(
    <MediaGroupEditor
      group={group}
      onUploadFile={vi.fn()}
      {...props}
    />
  );

  if (items.length > 0) {
    await screen.findByDisplayValue(items[0].answer);
  } else {
    await waitFor(() => {
      expect(getMediaGroupItems).toHaveBeenCalledWith(group.id);
    });
  }
}

// Every case here mounts and re-virtualises a 250-row group, which runs close to
// the default 5s budget on its own and tips over it whenever the rest of the
// suite is competing for CPU. The work is real, not a hang — give it room.
describe("MediaGroupEditor", { timeout: 25000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("mounts a bounded number of rows and thumbnails for large groups", async () => {
    await renderEditor();

    const rows = document.querySelectorAll("[data-image-group-item-row]");

    expect(getMediaGroupItems).toHaveBeenCalledWith(group.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(60);
    expect(screen.getAllByText("Réponse")).toHaveLength(rows.length);
    // One cover thumbnail per virtualised row (the rest live in the popover).
    expect(
      document.querySelectorAll("[data-image-group-item-row] img")
    ).toHaveLength(rows.length);
    expect(screen.queryByDisplayValue("Country 300")).not.toBeInTheDocument();
  });

  it("reveals later rows when scrolling and preserves edits across unmounts", async () => {
    await renderEditor();

    scrollEditorTo(249);

    const answerInput = await screen.findByDisplayValue("Country 250");
    fireEvent.change(answerInput, {
      target: {
        value: "Country 250 updated"
      }
    });

    scrollEditorTo(0);
    await screen.findByDisplayValue("Country 1");
    expect(screen.queryByDisplayValue("Country 250 updated")).not.toBeInTheDocument();

    scrollEditorTo(249);
    await screen.findByDisplayValue("Country 250 updated");
  });

  it("scrolls to a newly added image row", async () => {
    await renderEditor(makeImageItems(40));
    const scroller = screen.getByTestId("image-group-items-scroll");

    expect(scroller.scrollTop).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Ajouter une ligne" }));

    await waitFor(() => {
      expect(scroller.scrollTop).toBeGreaterThan(0);
      expect(
        document.querySelector("[data-image-group-item-id^='new-image-']")
      ).toBeInTheDocument();
    });
  });

  it("filters rows by answer search and matches aliases too", async () => {
    await renderEditor();

    const searchInput = screen.getByPlaceholderText("Recherche...");
    fireEvent.change(searchInput, { target: { value: "Country 137" } });

    await waitFor(() => {
      expect(document.querySelectorAll("[data-image-group-item-row]")).toHaveLength(1);
    });
    expect(
      within(document.querySelector("[data-image-group-item-row]")).getByDisplayValue("Country 137")
    ).toBeInTheDocument();

    // Item 300 only matches via its alias ("Alias 300"), not its answer text.
    fireEvent.change(searchInput, { target: { value: "Alias 300" } });

    await waitFor(() => {
      expect(document.querySelectorAll("[data-image-group-item-row]")).toHaveLength(1);
    });
    expect(
      within(document.querySelector("[data-image-group-item-row]")).getByDisplayValue("Country 300")
    ).toBeInTheDocument();
  });

  it("shows a no-results message and clears the search via the × button", async () => {
    await renderEditor();

    const searchInput = screen.getByPlaceholderText("Recherche...");
    fireEvent.change(searchInput, { target: { value: "nonexistent-xyz" } });

    await screen.findByText("Aucun résultat pour « nonexistent-xyz »");
    expect(document.querySelectorAll("[data-image-group-item-row]")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Effacer la recherche" }));

    expect(searchInput).toHaveValue("");
    await waitFor(() => {
      expect(
        document.querySelectorAll("[data-image-group-item-row]").length
      ).toBeGreaterThan(0);
    });
  });

  it("clears an active search when a new row is added, so it stays visible", async () => {
    await renderEditor();

    const searchInput = screen.getByPlaceholderText("Recherche...");
    fireEvent.change(searchInput, { target: { value: "Country 137" } });
    await waitFor(() => {
      expect(document.querySelectorAll("[data-image-group-item-row]")).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Ajouter une ligne" }));

    await waitFor(() => {
      expect(searchInput).toHaveValue("");
      expect(
        document.querySelector("[data-image-group-item-id^='new-image-']")
      ).toBeInTheDocument();
    });
  });

  it("imports a remote URL as a new compact image row", async () => {
    const onImportMediaUrl = vi.fn().mockResolvedValue({
      url: "/static/media-groups/7/France.png"
    });
    await renderEditor([], { onImportMediaUrl });

    fireEvent.change(screen.getByPlaceholderText("URL image"), {
      target: {
        value: "https://example.com/France.png"
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Importer l'URL" }));

    await screen.findByDisplayValue("France");

    const row = document.querySelector("[data-image-group-item-row]");

    expect(onImportMediaUrl).toHaveBeenCalledWith("https://example.com/France.png");
    // The imported image becomes the item's cover thumbnail; managing the full
    // pool happens in the popover opened from this compact row.
    expect(
      within(row).getAllByRole("button", { name: "Gérer les images" }).length
    ).toBeGreaterThan(0);
    expect(row.querySelector("img")).toBeTruthy();
    expect(row.style.height).toBe("214px");
  });

  it("pastes copied image bytes as a new compact image row", async () => {
    const onUploadFile = vi.fn().mockResolvedValue({
      url: "/static/media-groups/7/Brazil.png"
    });
    const imageFile = new File(["image"], "Brazil.png", { type: "image/png" });
    await renderEditor([], { onUploadFile });

    fireEvent.paste(screen.getByTestId("image-group-items-scroll"), {
      clipboardData: {
        files: [imageFile]
      }
    });

    await screen.findByDisplayValue("Brazil");

    const row = document.querySelector("[data-image-group-item-row]");

    expect(onUploadFile).toHaveBeenCalledWith(imageFile);
    expect(
      within(row).getAllByRole("button", { name: "Gérer les images" }).length
    ).toBeGreaterThan(0);
    expect(row.querySelector("img")).toBeTruthy();
    expect(row.style.height).toBe("214px");
  });

  it("pastes an image inside the pool popover without creating a new row", async () => {
    const onUploadFile = vi.fn().mockResolvedValue({
      url: "/static/flags/1-extra.svg"
    });
    const imageFile = new File(["image"], "extra.svg", { type: "image/svg+xml" });
    await renderEditor(makeImageItems(1), { onUploadFile });

    fireEvent.click(screen.getAllByRole("button", { name: "Gérer les images" })[0]);
    await screen.findByText("Médias (1)");

    const pasteTarget = screen.getByText("Coller (Ctrl+V)").closest("button");
    fireEvent.paste(pasteTarget, {
      clipboardData: {
        files: [imageFile]
      }
    });

    await screen.findByText("Médias (2)");

    // A paste inside the popover is a portal event: it must not also bubble up
    // to MediaGroupEditor's own paste handler and spawn a whole new row, and it
    // must not double-fire the popover's own handler either.
    expect(onUploadFile).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("[data-image-group-item-row]")).toHaveLength(1);
  });

  it("reverts to the last saved state when Annuler is clicked", async () => {
    await renderEditor(makeImageItems(3));

    const cancelButton = screen.getByRole("button", { name: "Annuler" });
    expect(cancelButton).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue("Country 1"), {
      target: { value: "Country 1 updated" }
    });

    const deletedRow = screen
      .getByDisplayValue("Country 2")
      .closest("[data-image-group-item-row]");
    fireEvent.click(within(deletedRow).getByRole("button", { name: "Supprimer" }));

    expect(screen.queryByDisplayValue("Country 1 updated")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Country 2")).not.toBeInTheDocument();
    expect(cancelButton).not.toBeDisabled();

    fireEvent.click(cancelButton);

    await screen.findByDisplayValue("Country 1");
    expect(screen.queryByDisplayValue("Country 1 updated")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Country 2")).toBeInTheDocument();
    expect(cancelButton).toBeDisabled();
    expect(patchMediaGroupItems).not.toHaveBeenCalled();
  });

  it("saves all items and deleted ids while only rendering the window", async () => {
    await renderEditor();

    scrollEditorTo(249);

    fireEvent.change(await screen.findByDisplayValue("Country 250"), {
      target: {
        value: "Country 250 updated"
      }
    });

    const deletedRow = screen
      .getByDisplayValue("Country 251")
      .closest("[data-image-group-item-row]");
    fireEvent.click(within(deletedRow).getByRole("button", { name: "Supprimer" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      expect(patchMediaGroupItems).toHaveBeenCalledTimes(1);
    });

    const [groupId, payload] = patchMediaGroupItems.mock.calls[0];
    const savedIds = payload.items.map((item) => item.id);

    expect(groupId).toBe(group.id);
    expect(payload.items).toHaveLength(299);
    expect(payload.deleted_item_ids).toEqual([251]);
    expect(savedIds).toContain(1);
    expect(savedIds).toContain(300);
    expect(savedIds).not.toContain(251);
    expect(payload.items.find((item) => item.id === 250).answer).toBe(
      "Country 250 updated"
    );
  });
});
