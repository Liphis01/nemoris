import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Menu from "./Menu";
import { searchPackCatalog } from "../../api/packs";
import { getProfile } from "../../api/profile";
import { getStats } from "../../api/stats";

vi.mock("../../api/stats", () => ({
  getStats: vi.fn(() => Promise.resolve({
    counts: {
      total: 12,
      mastered: 3
    }
  }))
}));

vi.mock("../../api/profile", () => ({
  getProfile: vi.fn(() => Promise.resolve({
    signed_in: false,
    account_email: null,
    profile: null
  }))
}));

vi.mock("../../api/packs", () => ({
  searchPackCatalog: vi.fn(() => Promise.resolve({
    packs: [
      {
        pack_guid: "pack-1",
        name: "Capitales du monde",
        description: "Un pack pour réviser les capitales.",
        question_count: 50,
        download_count: 8
      }
    ]
  }))
}));

describe("Menu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
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
      expect.stringContaining("Entraînement libre"),
      expect.stringContaining("Calendrier"),
      expect.stringContaining("Profil"),
      expect.stringContaining("Packs"),
      expect.stringContaining("Réglages")
    ]);
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", {
        name: /Révision du jour: 4 questions, À faire/
      })
    ).toBeInTheDocument();
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
    expect(
      screen.getByRole("button", {
        name: /Session terminée: 0 questions, À jour/
      })
    ).toBeInTheDocument();
  });

  it("counts new questions as part of the session, not as a finished day", () => {
    render(
      <Menu
        setMode={vi.fn()}
        startupNotice={null}
        onDismissStartupNotice={vi.fn()}
        reviewSummary={{
          due_count: 0,
          has_due: false,
          new_count: 3,
          session_count: 3
        }}
      />
    );

    expect(
      screen.getByRole("button", {
        name: /Révision du jour: 3 questions, À faire/
      })
    ).toBeInTheDocument();
  });

  it("starts global review through the primary review card", () => {
    const onStartReview = vi.fn();
    const setMode = vi.fn();

    render(
      <Menu
        onStartReview={onStartReview}
        setMode={setMode}
        startupNotice={null}
        onDismissStartupNotice={vi.fn()}
        reviewSummary={{ due_count: 2, has_due: true }}
      />
    );

    fireEvent.click(screen.getByRole("button", {
      name: /Révision du jour: 2 questions, À faire/
    }));

    expect(onStartReview).toHaveBeenCalledTimes(1);
    expect(setMode).not.toHaveBeenCalledWith("quiz");
  });

  it("opens the study-first recommendation while keeping pack discovery visible", async () => {
    const onOpenStudy = vi.fn();
    const onStartTraining = vi.fn();

    getStats.mockResolvedValueOnce({
      counts: {
        total: 12,
        mastered: 3
      },
      guidance: {
        weakest_groups: [
          {
            id: 42,
            name: "Europe",
            type_group: "map",
            fragile_count: 3,
            total: 10
          }
        ]
      }
    });

    render(
      <Menu
        onOpenStudy={onOpenStudy}
        onStartTraining={onStartTraining}
        setMode={vi.fn()}
        startupNotice={null}
        onDismissStartupNotice={vi.fn()}
        reviewSummary={{ due_count: 0, has_due: false }}
      />
    );

    expect(await screen.findByRole("heading", { name: "Europe" })).toBeInTheDocument();
    expect(screen.getByText("À travailler maintenant")).toBeInTheDocument();
    expect(await screen.findByText("Capitales du monde")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Voir Capitales du monde" })
    ).not.toHaveAttribute("title");

    fireEvent.click(screen.getByRole("button", { name: "Voir le bilan pour Europe" }));

    expect(onOpenStudy).toHaveBeenCalledWith({
      type: "group",
      id: 42,
      name: "Europe",
      type_group: "map"
    });

    fireEvent.click(screen.getByRole("button", { name: "S'entraîner sur Europe" }));

    expect(onStartTraining).toHaveBeenCalledWith({
      type: "group",
      id: 42,
      name: "Europe",
      type_group: "map"
    });
  });

  it("pauses the suggested pack carousel while hovered", async () => {
    vi.useFakeTimers();
    searchPackCatalog.mockResolvedValueOnce({
      packs: [
        {
          pack_guid: "pack-1",
          name: "Capitales du monde",
          description: "Un pack pour réviser les capitales.",
          question_count: 50,
          download_count: 8
        },
        {
          pack_guid: "pack-2",
          name: "Biologie cellulaire",
          description: "Organites et mitose.",
          question_count: 24,
          download_count: 4
        }
      ]
    });

    render(
      <Menu
        setMode={vi.fn()}
        startupNotice={null}
        onDismissStartupNotice={vi.fn()}
        reviewSummary={{ due_count: 0, has_due: false }}
      />
    );

    await act(async () => {});

    const carousel = screen.getByRole("button", {
      name: "Voir le pack Capitales du monde"
    });

    fireEvent.pointerEnter(carousel);
    expect(carousel).toHaveClass("is-paused");

    await act(async () => {
      vi.advanceTimersByTime(7100);
    });

    expect(
      screen.getByRole("heading", { name: "Capitales du monde" })
    ).toBeInTheDocument();

    fireEvent.pointerLeave(carousel);
    expect(carousel).not.toHaveClass("is-paused");

    await act(async () => {
      vi.advanceTimersByTime(7100);
    });

    expect(
      screen.getByRole("heading", { name: "Biologie cellulaire" })
    ).toBeInTheDocument();
  });

  it("shows the signed-in user's username and avatar in the account chip, not their email", async () => {
    getProfile.mockResolvedValueOnce({
      signed_in: true,
      account_email: "louis@example.com",
      profile: { username: "Louis", avatar_emoji: "🦉", avatar_color: "teal" }
    });

    render(
      <Menu
        setMode={vi.fn()}
        startupNotice={null}
        onDismissStartupNotice={vi.fn()}
        reviewSummary={{ due_count: 4, has_due: true }}
      />
    );

    expect(await screen.findByText("Louis")).toBeInTheDocument();
    expect(screen.queryByText("louis@example.com")).not.toBeInTheDocument();
  });

  it("navigates to the profile screen when the account chip is clicked", async () => {
    const setMode = vi.fn();

    render(
      <Menu
        setMode={setMode}
        startupNotice={null}
        onDismissStartupNotice={vi.fn()}
        reviewSummary={{ due_count: 0, has_due: false }}
      />
    );

    const chip = await screen.findByRole("button", { name: "Ouvrir le profil" });
    fireEvent.click(chip);

    await waitFor(() => expect(setMode).toHaveBeenCalledWith("profile"));
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
