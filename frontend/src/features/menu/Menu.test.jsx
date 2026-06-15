import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Menu from "./Menu";

describe("Menu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the main menu actions", () => {
    render(
      <Menu
        setMode={vi.fn()}
        startupNotice={null}
        onDismissStartupNotice={vi.fn()}
        reviewSummary={{ due_count: 4, has_due: true }}
      />
    );

    expect(screen.getByRole("heading", { name: "Nemoris" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Révision du jour/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Gestionnaire/ })
    ).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("À revoir")).toBeInTheDocument();
  });

  it("shows an empty review count", () => {
    render(
      <Menu
        setMode={vi.fn()}
        startupNotice={null}
        onDismissStartupNotice={vi.fn()}
        reviewSummary={{ due_count: 0, has_due: false }}
      />
    );

    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("À jour")).toBeInTheDocument();
  });

  it("shows the startup rebalance notice when provided", () => {
    render(
      <Menu
        setMode={vi.fn()}
        startupNotice={{
          id: "notice-1",
          moved: 2,
          daily_target: 8
        }}
        onDismissStartupNotice={vi.fn()}
      />
    );

    expect(screen.getByText("Calendrier rééquilibré")).toBeInTheDocument();
    expect(screen.getByText(/2 questions déplacées/)).toBeInTheDocument();
  });
});
