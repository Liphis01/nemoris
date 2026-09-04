import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import Manage from "./Manage";

vi.mock("./ManageSidebar", () => ({
  default: () => <aside data-testid="manage-sidebar" />
}));

vi.mock("./ManageList", () => ({
  default: ({ highlightedGroupIds = [], selectedItem, viewMode }) => (
    <section data-testid="manage-list">
      <span data-testid="manage-list-view">{viewMode}</span>
      <span data-testid="manage-list-selected">{selectedItem?.name || ""}</span>
      <span data-testid="manage-list-highlight">
        {highlightedGroupIds.join(",")}
      </span>
    </section>
  )
}));

vi.mock("./ManageInspector", () => ({
  default: ({ registerPendingSaveHandler, selectedItem }) => {
    useEffect(() => (
      registerPendingSaveHandler?.(selectedItem?.saveHandler)
    ), [registerPendingSaveHandler, selectedItem?.saveHandler]);

    return (
      <aside data-testid="manage-inspector">
        {selectedItem?.name || "empty"}
      </aside>
    );
  }
}));

vi.mock("./TagManagerModal", () => ({
  default: () => null
}));

describe("Manage external navigation", () => {
  it("opens a requested group in groups view once groups are loaded", async () => {
    const clearOpenGroupId = vi.fn();
    const group = {
      id: 10,
      type_group: "text",
      name: "Pack importé",
      question_count: 4
    };

    function Harness() {
      const [selectedItem, setSelectedItem] = useState(null);
      const [viewMode, setViewMode] = useState("questions");

      return (
        <Manage
          allGroups={[group]}
          allQuestions={[]}
          clearOpenGroupId={clearOpenGroupId}
          clearOpenQuestionId={vi.fn()}
          openGroupId={10}
          openQuestionId={null}
          selectedItem={selectedItem}
          setSelectedItem={setSelectedItem}
          setViewMode={setViewMode}
          viewMode={viewMode}
        />
      );
    }

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("manage-inspector")).toHaveTextContent(
        "Pack importé"
      );
    });

    expect(screen.getByTestId("manage-list-view")).toHaveTextContent("groups");
    expect(screen.getByTestId("manage-list-highlight")).toHaveTextContent("10");
    expect(clearOpenGroupId).toHaveBeenCalled();
  });
});

describe("Manage save shortcut", () => {
  it("saves pending editor changes with Ctrl+S", async () => {
    const saveHandler = vi.fn(async () => ({ saved: true }));
    const saveEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "s"
    });

    render(
      <Manage
        allGroups={[]}
        allQuestions={[]}
        clearOpenGroupId={vi.fn()}
        clearOpenQuestionId={vi.fn()}
        openGroupId={null}
        openQuestionId={null}
        selectedItem={{ id: 1, name: "Capitale", saveHandler }}
        setSelectedItem={vi.fn()}
        setViewMode={vi.fn()}
        viewMode="questions"
      />
    );

    fireEvent(window, saveEvent);

    await waitFor(() => {
      expect(saveHandler).toHaveBeenCalledTimes(1);
    });
    expect(saveEvent.defaultPrevented).toBe(true);
    expect(screen.getByText("Enregistré")).toBeInTheDocument();
  });
});
