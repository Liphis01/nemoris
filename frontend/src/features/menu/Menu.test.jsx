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
    current_streak: 5,
    longest_streak: 8,
    last_completed_on: "2026-06-01",
    rest_leaves: 1,
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
    next_milestone: 7,
    milestone_progress: {
      current: 5,
      target: 7,
      remaining: 2,
      percent: 60
    },
    grove_stage: {
      key: "young_grove",
      label: "Jeune bosquet"
    },
    ...overrides
  };
}

describe("Menu daily grove", () => {
  beforeEach(() => {
    getDailyGroveStatus.mockResolvedValue(groveStatus());
    completeDailyGrove.mockResolvedValue(groveStatus());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the grove status in the menu", async () => {
    render(
      <Menu
        setMode={vi.fn()}
        startupNotice={null}
        onDismissStartupNotice={vi.fn()}
      />
    );

    expect(await screen.findByText("Jeune bosquet")).toBeInTheDocument();
    expect(screen.getByText("3 révisions à terminer")).toBeInTheDocument();
    expect(screen.getByText("Record 8 j")).toBeInTheDocument();
    expect(screen.getByText("1/2 feuille")).toBeInTheDocument();
    expect(completeDailyGrove).not.toHaveBeenCalled();
  });

  it("auto-completes the grove when the menu opens with no due work", async () => {
    getDailyGroveStatus.mockResolvedValue(groveStatus({
      due_count: 0,
      eligible: true,
      can_complete_today: true
    }));
    completeDailyGrove.mockResolvedValue(groveStatus({
      current_streak: 6,
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

    expect(await screen.findByText("Bosquet arrosé")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });
});
