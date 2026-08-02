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

const SNAPSHOT = {
  version: 3,
  revision: 9,
  nodes: [
    node("core:geography", "Géographie"),
    node("core:science", "Sciences"),
    node(IMPORTED_ID, "Geography")
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

  it("explains the imported root with pack context and examples", () => {
    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID]} onClose={vi.fn()} />);

    expect(screen.getByText("#Geography")).toBeInTheDocument();
    expect(screen.getByText(/Capitales du monde · 12 question/)).toBeInTheDocument();
    expect(screen.getByText(/Capital of Canada/)).toBeInTheDocument();
  });

  it("places the unfamiliar root under an existing local identity", async () => {
    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID]} onClose={vi.fn()} />);

    const input = screen.getByLabelText(/Ranger « Geography » sous/);
    fireEvent.change(input, { target: { value: "Géographie" } });
    fireEvent.mouseDown(within(screen.getByRole("listbox")).getByText("#Géographie"));
    fireEvent.click(screen.getByText("Ranger"));

    await waitFor(() => expect(resolveTagInbox).toHaveBeenCalledWith({
      pack_guid: "pack-guid",
      tag_id: IMPORTED_ID,
      action: "place",
      parent_id: "core:geography"
    }));
  });

  it("offers an explicit merge without merging matching labels automatically", async () => {
    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("#Géographie"));

    await waitFor(() => expect(resolveTagInbox).toHaveBeenCalledWith({
      pack_guid: "pack-guid",
      tag_id: IMPORTED_ID,
      action: "merge",
      target_id: "core:geography"
    }));
  });

  it("can accept the imported identity as a custom root", async () => {
    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Garder comme racine"));

    await waitFor(() => expect(resolveTagInbox).toHaveBeenCalledWith({
      pack_guid: "pack-guid",
      tag_id: IMPORTED_ID,
      action: "keep_root"
    }));
  });

  it("defers the modal while recording the decision in the persistent inbox", async () => {
    const onClose = vi.fn();
    resolveTagInbox.mockResolvedValue(SNAPSHOT);
    render(<UnplacedTagRootsDialog roots={[IMPORTED_ID]} onClose={onClose} />);
    fireEvent.click(screen.getByText("Décider plus tard"));

    await waitFor(() => expect(resolveTagInbox).toHaveBeenCalledWith({
      pack_guid: "pack-guid",
      tag_id: IMPORTED_ID,
      action: "defer"
    }));
    expect(onClose).toHaveBeenCalled();
  });
});
