import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeDailyGrove,
  getDailyGroveStatus
} from "../../api/dailyGrove";
import Menu from "./Menu";

vi.mock("../../api/dailyGrove", () => ({
  completeDailyGrove: vi.fn(),
  getDailyGroveStatus: vi.fn()
}));

function groveStatus(overrides = {}) {
  return {
    current_streak: 35,
    longest_streak: 36,
    last_completed_on: "2026-06-01",
    rest_leaves: 1,
    fallen_leaves: 1,
    protected_dates: [],
    seen_milestones: [3],
    today: "2026-06-02",
    due_count: 3,
    today_complete: false,
    eligible: false,
    can_complete_today: false,
    completed: false,
    already_complete: false,
    blocked: false,
    milestone_reached: null,
    shield_capacity: 2,
    shield_growth: {
      current: 7,
      target: 7,
      remaining: 0,
      percent: 100,
      next_award_at: 35,
      growing: true
    },
    shield_event: null,
    next_milestone: 60,
    milestone_progress: {
      current: 35,
      target: 60,
      remaining: 25,
      percent: 17
    },
    grove_stage: {
      key: "canopy",
      label: "Canopée"
    },
    ...overrides
  };
}

describe("Menu daily plant", () => {
  beforeEach(() => {
    getDailyGroveStatus.mockResolvedValue(groveStatus());
    completeDailyGrove.mockResolvedValue(groveStatus());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the plant status in the menu", async () => {
    const { container } = render(
      <Menu
        setMode={vi.fn()}
        startupNotice={null}
        onDismissStartupNotice={vi.fn()}
      />
    );

    expect(await screen.findByText("Fleur ouverte")).toBeInTheDocument();
    expect(screen.getByText("Plante Nemoris")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Illustration animée de la plante Nemoris"
      })
    ).toBeInTheDocument();
    expect(screen.getByText("3 révisions à terminer")).toBeInTheDocument();
    expect(screen.getByText("Record 36 j")).toBeInTheDocument();
    expect(screen.getByText("1/2 feuilles de garde")).toBeInTheDocument();
    expect(container.querySelectorAll(".grove-art-shield-active")).toHaveLength(1);
    expect(container.querySelectorAll(".grove-art-regrowing-bud")).toHaveLength(1);
    expect(container.querySelectorAll(".grove-art-fallen-leaf")).toHaveLength(1);
    expect(completeDailyGrove).not.toHaveBeenCalled();
  });

  it("auto-completes the plant when the menu opens with no due work", async () => {
    getDailyGroveStatus.mockResolvedValue(groveStatus({
      due_count: 0,
      eligible: true,
      can_complete_today: true
    }));
    completeDailyGrove.mockResolvedValue(groveStatus({
      current_streak: 36,
      due_count: 0,
      today_complete: true,
      eligible: false,
      can_complete_today: false,
      completed: true,
      milestone_progress: {
        current: 6,
        target: 7,
        remaining: 1,
        percent: 80
      }
    }));

    render(
      <Menu
        setMode={vi.fn()}
        startupNotice={null}
        onDismissStartupNotice={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(completeDailyGrove).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Plante arrosée")).toBeInTheDocument();
    expect(screen.getByText("36")).toBeInTheDocument();
  });
});
