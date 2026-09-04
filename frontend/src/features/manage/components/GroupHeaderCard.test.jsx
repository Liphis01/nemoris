import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GroupHeaderCard from "./GroupHeaderCard";

function buildRow(questions) {
  return {
    key: "group:1",
    groupInfo: {
      id: 1,
      name: "Capitales",
      type: "text",
      tags: [],
      mapCount: 0,
      imageCount: 0,
      textCount: questions.length,
      sequenceCount: 0,
      questions
    }
  };
}

function renderGroupHeader(questions, props = {}) {
  return render(
    <GroupHeaderCard
      row={buildRow(questions)}
      isOpen={false}
      selectedInside={false}
      highlightedInside={false}
      setRowRef={vi.fn()}
      onToggle={vi.fn()}
      {...props}
    />
  );
}

const active = { id: 1, suspended: false };
const paused = { id: 2, suspended: true };

describe("GroupHeaderCard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("expands the group from the card", () => {
    const onToggle = vi.fn();
    renderGroupHeader([active], { onToggle });

    fireEvent.click(screen.getByRole("button", { name: /Capitales/ }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("expands the group from the keyboard", () => {
    const onToggle = vi.fn();
    renderGroupHeader([active], { onToggle });

    const card = screen.getByRole("button", { name: /Capitales/ });
    fireEvent.keyDown(card, { key: "Enter" });

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("greys out a fully suspended group and labels it", () => {
    const { container } = renderGroupHeader([paused, { ...paused, id: 3 }]);

    expect(screen.getByText("En pause")).toBeInTheDocument();
    expect(container.querySelector(".manage-card")).toHaveStyle({
      opacity: "0.55"
    });
  });

  it("leaves a mixed group unlabelled and in full colour", () => {
    const { container } = renderGroupHeader([active, paused, { ...active, id: 4 }]);

    expect(screen.queryByText(/en pause/i)).not.toBeInTheDocument();
    expect(container.querySelector(".manage-card")).toHaveStyle({
      opacity: "1"
    });
  });

  it("leaves an untouched group unmarked", () => {
    renderGroupHeader([active, { ...active, id: 4 }]);

    expect(screen.queryByText("En pause")).not.toBeInTheDocument();
    expect(screen.queryByText(/en pause/)).not.toBeInTheDocument();
  });
});
