import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import UnplacedTagRootsDialog from "./UnplacedTagRootsDialog";
import { primeTags, resetTags } from "../../../shared/tagLabels";
import { resolveTagInbox } from "../../../api/tags";

vi.mock("../../../api/tags", () => ({
  getTags: vi.fn(() => Promise.resolve({ nodes: [], revision: 0 })),
  resolveTagInbox: vi.fn()
}));


const IMPORTED_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_IMPORTED_ID = "22222222-2222-4222-8222-222222222222";

function node(id, label, parents = []) {
  return {
    id,
    label,
    labels: { fr: label },
    default_locale: "fr",
    parents,
    direct_count: 0,
    total_count: 0,
    kind: id.startsWith("core:") ? "core" : "custom",
    origin: "local",
    pack_ids: [],
    classification: parents.length ? "placed" : "root",
    hidden: false
  };
}

const ENTRY = {
  id: "pack-guid:root",
  pack_guid: "pack-guid",
  pack_name: "Capitales du monde",
  pack_version: 3,
  tag_id: IMPORTED_ID,
  label: "Geography",
  question_count: 12,
  sample_questions: ["Capital of Canada?"],
  suggested_matches: ["core:geography"],
  status: "pending"
};

const SECOND_ENTRY = {
  id: "pack-guid:second-root",
  pack_guid: "pack-guid",
  pack_name: "Capitales du monde",
  pack_version: 3,
  tag_id: SECOND_IMPORTED_ID,
  label: "Capitals",
  question_count: 4,
  sample_questions: ["Capital of Peru?"],
  suggested_matches: [],
  status: "pending"
};

const SNAPSHOT = {
  version: 3,
  revision: 9,
  nodes: [
    node("core:geography", "Géographie"),
    node("core:science", "Sciences"),
    node(IMPORTED_ID, "Geography"),
    node(SECOND_IMPORTED_ID, "Capitals")
  ],
  inbox: { pending: [ENTRY], conflicts: [], count: 1 }
};


describe("UnplacedTagRootsDialog", () => {
  beforeEach(() => {
    resetTags();
    primeTags(SNAPSHOT);
    resolveTagInbox.mockResolvedValue({
      ...SNAPSHOT,
      revision: 10,
      inbox: { pending: [], conflicts: [], count: 0 }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders nothing when there is no persistent inbox entry", () => {
    primeTags({ ...SNAPSHOT, inbox: { pending: [], conflicts: [], count: 0 } });
    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID]} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains the imported root with pack context and a simple default", () => {
    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID]} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Import terminé : nouveaux thèmes" })).toBeInTheDocument();
    expect(screen.getByText("#Geography")).toBeInTheDocument();
    expect(screen.getByText(/Capitales du monde · 12 question/)).toBeInTheDocument();
    expect(screen.getByText(/Capital of Canada/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Garder comme nouveau thème" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the imported identity as a custom root by default", async () => {
    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    await waitFor(() => expect(resolveTagInbox).toHaveBeenCalledWith({
      pack_guid: "pack-guid",
      tag_id: IMPORTED_ID,
      action: "keep_root"
    }));
  });

  it("places the unfamiliar root under an existing local identity from options", async () => {
    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID]} onClose={vi.fn()} />);

    expect(screen.queryByLabelText(/Ranger « Geography » sous/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ranger ailleurs" }));
    const input = screen.getByLabelText(/Ranger « Geography » sous/);
    fireEvent.change(input, { target: { value: "Géographie" } });
    fireEvent.mouseDown(within(screen.getByRole("listbox")).getByText("#Géographie"));
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    await waitFor(() => expect(resolveTagInbox).toHaveBeenCalledWith({
      pack_guid: "pack-guid",
      tag_id: IMPORTED_ID,
      action: "place",
      parent_id: "core:geography"
    }));
  });

  it("offers an explicit merge without merging matching labels automatically", async () => {
    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fusionner avec #Géographie" }));
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    await waitFor(() => expect(resolveTagInbox).toHaveBeenCalledWith({
      pack_guid: "pack-guid",
      tag_id: IMPORTED_ID,
      action: "merge",
      target_id: "core:geography"
    }));
  });

  it("defers the modal while recording the decision in the persistent inbox", async () => {
    const onClose = vi.fn();
    resolveTagInbox.mockResolvedValue(SNAPSHOT);
    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID]} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Plus tard" }));

    await waitFor(() => expect(resolveTagInbox).toHaveBeenCalledWith({
      pack_guid: "pack-guid",
      tag_id: IMPORTED_ID,
      action: "defer"
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it("resolves every visible imported tag before closing", async () => {
    const onClose = vi.fn();
    primeTags({
      ...SNAPSHOT,
      inbox: { pending: [ENTRY, SECOND_ENTRY], conflicts: [], count: 2 }
    });
    resolveTagInbox.mockImplementation(({ tag_id }) => Promise.resolve({
      ...SNAPSHOT,
      inbox: {
        pending: tag_id === IMPORTED_ID ? [SECOND_ENTRY] : [],
        conflicts: [],
        count: tag_id === IMPORTED_ID ? 1 : 0
      }
    }));

    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID, SECOND_IMPORTED_ID]} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    await waitFor(() => expect(resolveTagInbox).toHaveBeenCalledTimes(2));
    expect(resolveTagInbox.mock.calls.map(([payload]) => payload)).toEqual([
      { pack_guid: "pack-guid", tag_id: IMPORTED_ID, action: "keep_root" },
      { pack_guid: "pack-guid", tag_id: SECOND_IMPORTED_ID, action: "keep_root" }
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the picker above the import modal when placing elsewhere", () => {
    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID]} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Ranger ailleurs" }));
    fireEvent.focus(screen.getByLabelText(/Ranger « Geography » sous/));

    expect(screen.getByRole("listbox")).toHaveStyle({ zIndex: "80" });
  });
});
