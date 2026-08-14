import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGroupPackPublication,
  previewGroupPackChanges,
  publishGroupPackChanges
} from "../../../api/packs";
import ManageInspector from "./ManageInspector";

vi.mock("../../../api/packs", () => ({
  getGroupPackPublication: vi.fn(),
  previewGroupPackChanges: vi.fn(),
  publishGroupPackChanges: vi.fn()
}));

vi.mock("./TextGroupEditor", () => ({
  default: ({ group, headerAction }) => (
    <section aria-label={`Editeur ${group.name}`}>
      <div>{headerAction}</div>
    </section>
  )
}));

const group = {
  id: 10,
  guid: "group-guid",
  type_group: "text",
  name: "Capitales du monde",
  media: "",
  tags: [],
  data: {},
  question_count: 42
};

function renderInspector(props = {}) {
  return render(
    <ManageInspector
      allGroups={[group]}
      setAllGroups={vi.fn()}
      setAllQuestions={vi.fn()}
      selectedItem={group}
      updateQuestion={vi.fn()}
      patchQuestionInCache={vi.fn()}
      setSelectedItem={vi.fn()}
      setEditingZone={vi.fn()}
      uploadQuestionMedia={vi.fn()}
      uploadMediaGroupMedia={vi.fn()}
      importMediaGroupMediaUrl={vi.fn()}
      uploadMedia={vi.fn()}
      importMediaUrl={vi.fn()}
      isCreatingPlaylist={false}
      setIsCreatingPlaylist={vi.fn()}
      loadAllPlaylists={vi.fn()}
      deletePlaylist={vi.fn()}
      isCreatingQuestion={false}
      setIsCreatingQuestion={vi.fn()}
      isCreatingGroup={false}
      setIsCreatingGroup={vi.fn()}
      questionDraft={{}}
      setQuestionDraft={vi.fn()}
      groupDraft={{ name: "", type_group: "", media: "", data: {} }}
      setGroupDraft={vi.fn()}
      createQuestion={vi.fn()}
      createGroupSilently={vi.fn()}
      editingZone={null}
      setViewMode={vi.fn()}
      setHighlightedQuestionIds={vi.fn()}
      importQuestionMediaUrl={vi.fn()}
      onOpenInCalendar={vi.fn()}
      registerPendingSaveHandler={vi.fn()}
      requestManageTransition={vi.fn(async (action) => action())}
      requestQuestionScroll={vi.fn()}
      onOpenMapImport={vi.fn()}
      availableTags={[]}
      {...props}
    />
  );
}

describe("ManageInspector pack publishing", () => {
  beforeEach(() => {
    getGroupPackPublication.mockResolvedValue({
      status: "published",
      signed_in: true,
      publication: {
        pack_guid: "group-guid",
        name: "Capitales du monde",
        publication_status: "published",
        is_public: true
      },
      can_publish_changes: true
    });
    previewGroupPackChanges.mockResolvedValue({
      unchanged: false,
      groups: { added: [], edited: ["group-guid"], removed: [] },
      questions: { added: [], edited: ["question-guid"], removed: [] },
      metadata_changed: []
    });
    publishGroupPackChanges.mockResolvedValue({
      status: "published",
      publication: {
        pack_guid: "group-guid",
        name: "Capitales du monde",
        publication_status: "published",
        is_public: true
      }
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("publishes linked group changes from the editor header after pending saves", async () => {
    const requestManageTransition = vi.fn(async (action) => action());
    renderInspector({ requestManageTransition });

    await userEvent.click(
      await screen.findByRole("button", { name: "Publier les changements" })
    );

    await waitFor(() => {
      expect(requestManageTransition).toHaveBeenCalledTimes(1);
      expect(previewGroupPackChanges).toHaveBeenCalledWith(group.id);
      expect(publishGroupPackChanges).toHaveBeenCalledWith(group.id);
    });
    expect(screen.getByText("Publié")).toBeInTheDocument();
  });

  it("opens Study from the group editor header after pending saves", async () => {
    const onOpenStudy = vi.fn();
    const requestManageTransition = vi.fn(async (action) => action());

    renderInspector({ onOpenStudy, requestManageTransition });

    await userEvent.click(screen.getByRole("button", { name: "Study" }));

    expect(requestManageTransition).toHaveBeenCalledTimes(1);
    expect(onOpenStudy).toHaveBeenCalledWith(expect.objectContaining({
      id: group.id,
      name: group.name,
      type: "group",
      type_group: "text"
    }));
  });
});
