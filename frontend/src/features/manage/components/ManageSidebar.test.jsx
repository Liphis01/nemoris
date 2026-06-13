import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManageSidebar from "./ManageSidebar";

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
    resetManageFilters: vi.fn(),
    setSelectedItem: vi.fn(),
    startCreateQuestion: vi.fn(),
    startCreateGroup: vi.fn(),
    viewMode: "questions",
    setViewMode: vi.fn(),
    requestManageTransition: vi.fn((action) => action()),
    availableTags: ["geo"]
  };
  const mergedProps = {
    ...defaultProps,
    ...props
  };

  render(<ManageSidebar {...mergedProps} />);

  return mergedProps;
}

describe("ManageSidebar", () => {
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
});
