import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { primeTags, resetTags } from "../../../shared/tagLabels";
import ManageSidebar from "./ManageSidebar";

vi.mock("../../../api/tags", () => ({
  getTags: vi.fn(() => Promise.resolve({ hierarchy: {}, usage: {} }))
}));

vi.mock("../../../api/review", () => ({
  getReviewIntakeQueue: vi.fn(() => Promise.resolve({
    quota: 0,
    today_ids: [],
    active_ids: [],
    suspended_ids: [],
    counts: { today: 0, active: 0, suspended: 0, total: 0 }
  })),
  updateReviewIntakeOrder: vi.fn(),
  updateReviewIntakeSuspension: vi.fn()
}));


function tagNode(id, label, parents = [], extra = {}) {
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
    classification: parents.length ? "placed" : "unplaced",
    hidden: false,
    ...extra
  };
}

function renderSidebar(props = {}) {
  const defaultProps = {
    setMode: vi.fn(),
    search: "capital",
    setSearch: vi.fn(),
    tagFilter: "geo",
    setTagFilter: vi.fn(),
    questionTypeFilter: "text",
    setQuestionTypeFilter: vi.fn(),
    dueOnly: true,
    setDueOnly: vi.fn(),
    favoritesOnly: false,
    setFavoritesOnly: vi.fn(),
    suspendedOnly: false,
    setSuspendedOnly: vi.fn(),
    sortField: "title",
    sortOrder: "desc",
    selectSortField: vi.fn(),
    toggleSortOrder: vi.fn(),
    groupSearch: "europe",
    setGroupSearch: vi.fn(),
    groupTypeFilter: "map",
    setGroupTypeFilter: vi.fn(),
    groupHasMediaOnly: true,
    setGroupHasMediaOnly: vi.fn(),
    groupSortField: "name",
    groupSortOrder: "desc",
    selectGroupSortField: vi.fn(),
    toggleGroupSortOrder: vi.fn(),
    playlistSortField: "name",
    playlistSortOrder: "asc",
    selectPlaylistSortField: vi.fn(),
    togglePlaylistSortOrder: vi.fn(),
    resetManageFilters: vi.fn(),
    setSelectedItem: vi.fn(),
    startCreateQuestion: vi.fn(),
    startCreateGroup: vi.fn(),
    startCreatePlaylist: vi.fn(),
    viewMode: "questions",
    setViewMode: vi.fn(),
    requestManageTransition: vi.fn((action) => action()),
    allQuestions: [],
    tagParents: {},
    tagLabels: {},
    patchQuestionsInCache: vi.fn(),
    availableTags: ["linux"]
  };
  const mergedProps = {
    ...defaultProps,
    ...props
  };

  render(<ManageSidebar {...mergedProps} />);

  return mergedProps;
}

describe("ManageSidebar", () => {
  beforeEach(() => {
    resetTags();
    primeTags({
      revision: 4,
      nodes: [
        tagNode("science", "Sciences", [], { kind: "core", classification: "root" }),
        tagNode("technology", "Technologie", ["science"]),
        tagNode("linux", "Linux", ["technology"])
      ],
      usage: { linux: 1 },
      total_usage: { science: 1, technology: 1, linux: 1 }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("clears Manage filters and sort fields before returning to the menu", () => {
    const props = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: /Retour/ }));

    expect(props.requestManageTransition).toHaveBeenCalledTimes(1);
    expect(props.setSelectedItem).toHaveBeenCalledWith(null);
    expect(props.resetManageFilters).toHaveBeenCalledTimes(1);
    expect(props.setViewMode).toHaveBeenCalledWith("questions");
    expect(props.setMode).toHaveBeenCalledWith("menu");
  });

  it("uses the dedicated tag filter control in question mode", () => {
    renderSidebar({ tagFilter: "" });

    expect(screen.getByRole("button", { name: "Filtrer par tag" })).toHaveTextContent("Filtrer par tag…");
    expect(screen.queryByLabelText(/Retirer le tag/i)).not.toBeInTheDocument();
  });

  it("toggles the suspended question filter", () => {
    const props = renderSidebar();

    fireEvent.click(screen.getByLabelText("Suspendues uniquement"));

    expect(props.setSuspendedOnly).toHaveBeenCalledWith(true);
  });

  it("places the new-question queue directly under tag management", () => {
    renderSidebar();

    const tagButton = screen.getByRole("button", { name: /Gérer les tags/ });
    const queueButton = screen.getByRole("button", { name: /File des nouvelles/ });

    expect(tagButton.nextElementSibling).toContainElement(queueButton);
  });

  it("keeps tag management and the new-question queue visible in group mode", () => {
    renderSidebar({ viewMode: "groups" });

    expect(screen.getByRole("button", { name: /Gérer les tags/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /File des nouvelles/ })).toBeInTheDocument();
  });

  it("keeps tag management, the new-question queue, and sorting visible in playlist mode", () => {
    const props = renderSidebar({ viewMode: "playlists" });

    expect(screen.getByRole("button", { name: /Gérer les tags/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /File des nouvelles/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Critère de tri"), {
      target: { value: "question_count" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Tri croissant" }));

    expect(props.selectPlaylistSortField).toHaveBeenCalledWith("question_count");
    expect(props.togglePlaylistSortOrder).toHaveBeenCalledTimes(1);
  });

  it("updates and clears the selected tag filter", () => {
    const props = renderSidebar({ tagFilter: "" });

    fireEvent.click(screen.getByRole("button", { name: "Filtrer par tag" }));
    fireEvent.mouseDown(screen.getByText("#Sciences"));
    expect(props.setTagFilter).toHaveBeenCalledWith("science");

    cleanup();
    vi.clearAllMocks();

    const selectedProps = renderSidebar({ tagFilter: "science" });
    fireEvent.click(screen.getByLabelText("Effacer le filtre tag"));
    expect(selectedProps.setTagFilter).toHaveBeenCalledWith("");
  });
});
