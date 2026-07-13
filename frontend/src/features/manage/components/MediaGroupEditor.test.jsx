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
  scroller.scrollTop = index * 302;
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
    expect(screen.getAllByRole("img")).toHaveLength(rows.length);
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
    expect(screen.getByDisplayValue("/static/media-groups/7/France.png")).toBeInTheDocument();
    expect(row).toBeInTheDocument();
    expect(row.style.height).toBe("292px");
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
    expect(screen.getByDisplayValue("/static/media-groups/7/Brazil.png")).toBeInTheDocument();
    expect(row).toBeInTheDocument();
    expect(row.style.height).toBe("292px");
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
