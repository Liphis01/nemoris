import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TagManagerModal from "./TagManagerModal";
import { primeTags, resetTags } from "../../../shared/tagLabels";
import { applyTagActions, getTags } from "../../../api/tags";

vi.mock("../../../api/tags", () => ({
  getTags: vi.fn(),
  applyTagActions: vi.fn(),
  resolveTagInbox: vi.fn(),
  resolveTagConflict: vi.fn()
}));


const LINUX_ID = "11111111-1111-4111-8111-111111111111";
const COMPUTING_ID = "22222222-2222-4222-8222-222222222222";
const BIBLE_ID = "33333333-3333-4333-8333-333333333333";
const UNPLACED_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOM_ROOT_ID = "55555555-5555-4555-8555-555555555555";

function node(id, label, parents = [], extra = {}) {
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
    source_packs: [],
    representative_questions: [],
    classification: parents.length ? "placed" : "root",
    hidden: false,
    ...extra
  };
}

const SNAPSHOT = {
  version: 3,
  revision: 7,
  nodes: [
    node("core:technology", "Technologie", [], { total_count: 4 }),
    node(COMPUTING_ID, "Informatique", ["core:technology"], { total_count: 4 }),
    node(LINUX_ID, "Linux", [COMPUTING_ID], { direct_count: 4, total_count: 4 }),
    node("core:literature", "Littérature"),
    node("core:religion", "Religion"),
    node(BIBLE_ID, "Bible", ["core:literature", "core:religion"]),
    node(UNPLACED_ID, "Shrek", [], { classification: "unplaced" }),
    node(CUSTOM_ROOT_ID, "Cuisine", [], { classification: "root" })
  ],
  inbox: { pending: [], conflicts: [], count: 0 }
};


describe("TagManagerModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTags();
    primeTags(SNAPSHOT);
    getTags.mockResolvedValue(SNAPSHOT);
    applyTagActions.mockResolvedValue({ ...SNAPSHOT, revision: 8 });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  function open(onClose = vi.fn()) {
    render(<TagManagerModal open onClose={onClose} />);
    return onClose;
  }

  function selectLinux() {
    fireEvent.click(screen.getByLabelText("Déplier Informatique"));
    fireEvent.click(screen.getByText("#Linux"));
  }

  it("renders nothing when closed", () => {
    render(<TagManagerModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows one shared multi-parent tag beneath every parent", () => {
    open();

    expect(screen.getAllByText("#Bible")).toHaveLength(2);
    fireEvent.click(screen.getAllByText("#Bible")[0]);
    expect(screen.getAllByTitle("Plusieurs parents")).toHaveLength(2);
    expect(screen.getAllByText(/Littérature$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Religion$/).length).toBeGreaterThan(0);
  });

  it("keeps unplaced tags out of default root browsing until search or filter asks for them", () => {
    open();

    expect(screen.queryByText("Tags à classer")).not.toBeInTheDocument();
    expect(screen.queryByText("#Shrek")).not.toBeInTheDocument();
    expect(screen.getByText("#Cuisine")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Rechercher un tag"), { target: { value: "shr" } });
    expect(screen.getByText("Tags à classer")).toBeInTheDocument();
    expect(screen.getByText("#Shrek")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Rechercher un tag"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Non classés"));
    expect(screen.getByText("#Shrek")).toBeInTheDocument();
  });

  it("edits a localized label without changing identity", async () => {
    open();
    selectLinux();

    fireEvent.change(screen.getByLabelText("Nom fr"), { target: { value: "GNU/Linux" } });
    fireEvent.click(screen.getByText("Enregistrer"));

    await waitFor(() => expect(applyTagActions).toHaveBeenCalled());
    expect(applyTagActions).toHaveBeenCalledWith(7, expect.arrayContaining([{
      type: "set_label",
      tag_id: LINUX_ID,
      locale: "fr",
      label: "GNU/Linux"
    }]));
  });

  it("unfiles a tag without deleting its assignments", async () => {
    open();
    selectLinux();

    fireEvent.click(screen.getByText("Retirer de l’arborescence"));
    fireEvent.click(screen.getByText("Enregistrer"));

    await waitFor(() => expect(applyTagActions).toHaveBeenCalled());
    expect(applyTagActions.mock.calls[0][1]).toContainEqual({
      type: "unfile",
      tag_id: LINUX_ID
    });
    expect(applyTagActions.mock.calls[0][1]).not.toContainEqual(
      expect.objectContaining({ type: "remove_assignments" })
    );
  });

  it("requires explicit confirmation to remove assignments", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    open();
    selectLinux();

    fireEvent.click(screen.getByText("Retirer des 4 questions"));
    fireEvent.click(screen.getByText("Enregistrer"));

    await waitFor(() => expect(applyTagActions).toHaveBeenCalled());
    expect(applyTagActions.mock.calls[0][1]).toContainEqual({
      type: "remove_assignments",
      tag_id: LINUX_ID
    });
  });

  it("creates a custom root with a generated identity", async () => {
    open();
    fireEvent.click(screen.getByText("+ Racine personnalisée"));
    fireEvent.change(screen.getByLabelText("Nom fr"), { target: { value: "Cuisine" } });
    fireEvent.click(screen.getByText("Enregistrer"));

    await waitFor(() => expect(applyTagActions).toHaveBeenCalled());
    const create = applyTagActions.mock.calls[0][1].find(action => action.type === "create");
    expect(create).toEqual(expect.objectContaining({
      classification: "root",
      label: "Cuisine",
      parent_ids: [],
      tag_id: expect.stringMatching(/^[0-9a-f-]{36}$/i)
    }));
  });

  it("supports local undo and protects unsaved changes on close", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = open();
    fireEvent.click(screen.getByText("+ Racine personnalisée"));

    fireEvent.click(screen.getByLabelText("Fermer"));
    expect(confirm).toHaveBeenCalledWith("Abandonner les modifications non enregistrées ?");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Annuler l’action"));
    fireEvent.click(screen.getByLabelText("Fermer"));
    expect(onClose).toHaveBeenCalled();
  });

  it("turns a stale revision into a visible reload request", async () => {
    const error = Object.assign(new Error("stale"), { status: 409 });
    applyTagActions.mockRejectedValue(error);
    vi.spyOn(console, "error").mockImplementation(() => {});
    open();
    selectLinux();
    fireEvent.change(screen.getByLabelText("Nom fr"), { target: { value: "Linux FR" } });
    fireEvent.click(screen.getByText("Enregistrer"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("a changé ailleurs"));
    expect(getTags).toHaveBeenCalled();
  });
});
