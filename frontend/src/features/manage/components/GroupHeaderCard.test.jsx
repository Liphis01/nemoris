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
      onToggleSuspended={vi.fn()}
      {...props}
    />
  );
}

const active = { id: 1, suspended: false };
const paused = { id: 2, suspended: true };

describe("GroupHeaderCard suspension", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("suspends the whole group in one action", () => {
    const onToggleSuspended = vi.fn();
    renderGroupHeader([active, { ...active, id: 2 }], { onToggleSuspended });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Suspendre toutes les questions du groupe"
      })
    );

    expect(onToggleSuspended).toHaveBeenCalledWith(true);
  });

  it("resumes the whole group when every question is already suspended", () => {
    const onToggleSuspended = vi.fn();
    renderGroupHeader([paused, { ...paused, id: 3 }], { onToggleSuspended });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reprendre toutes les questions du groupe"
      })
    );

    expect(onToggleSuspended).toHaveBeenCalledWith(false);
  });

  it("treats a partly suspended group as mixed and suspends the rest", () => {
    // The state is derived from the questions, so a half-suspended group must
    // not silently read as fully active or fully paused.
    const onToggleSuspended = vi.fn();
    renderGroupHeader([active, paused], { onToggleSuspended });

    const button = screen.getByRole("button", {
      name: "Suspendre toutes les questions du groupe"
    });

    expect(button.className).toContain("suspend-toggle-mixed");
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);

    expect(onToggleSuspended).toHaveBeenCalledWith(true);
  });

  it("disables the control for an empty group", () => {
    renderGroupHeader([]);

    expect(
      screen.getByRole("button", {
        name: "Suspendre toutes les questions du groupe"
      })
    ).toBeDisabled();
  });

  it("keeps expanding the group separate from suspending it", () => {
    const onToggle = vi.fn();
    const onToggleSuspended = vi.fn();
    renderGroupHeader([active], { onToggle, onToggleSuspended });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Suspendre toutes les questions du groupe"
      })
    );

    expect(onToggleSuspended).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("expands the group from the keyboard without the nested control firing", () => {
    const onToggle = vi.fn();
    const onToggleSuspended = vi.fn();
    renderGroupHeader([active], { onToggle, onToggleSuspended });

    const card = screen.getByRole("button", { name: /Capitales/ });
    fireEvent.keyDown(card, { key: "Enter" });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggleSuspended).not.toHaveBeenCalled();
  });

  it("does not expand the group when a key lands on the suspend control", () => {
    const onToggle = vi.fn();
    renderGroupHeader([active], { onToggle });

    fireEvent.keyDown(
      screen.getByRole("button", {
        name: "Suspendre toutes les questions du groupe"
      }),
      { key: " " }
    );

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("greys out a fully suspended group and labels it", () => {
    const { container } = renderGroupHeader([paused, { ...paused, id: 3 }]);

    expect(screen.getByText("En pause")).toBeInTheDocument();
    expect(container.querySelector(".manage-card")).toHaveStyle({
      opacity: "0.55"
    });
  });

  it("leaves a mixed group unlabelled and in full colour", () => {
    // The mixed state is carried by the button's own styling; the header stays
    // clean because most of the group is still in rotation.
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
