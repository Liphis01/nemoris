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
    const workspaceButtons = screen
      .getAllByRole("button")
      .filter((button) => button.classList.contains("menu-destination"));
    expect(workspaceButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Gestionnaire"),
      expect.stringContaining("Entrainement"),
      expect.stringContaining("Calendrier"),
      expect.stringContaining("Statistiques"),
      expect.stringContaining("Packs"),
      expect.stringContaining("Réglages")
    ]);
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("À revoir").length).toBeGreaterThan(0);
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

    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("À jour").length).toBeGreaterThan(0);
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
