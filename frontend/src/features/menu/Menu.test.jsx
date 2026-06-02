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
      />
    );

    expect(screen.getByRole("heading", { name: "Nemoris" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Révision du jour/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Gestionnaire/ })
    ).toBeInTheDocument();
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
