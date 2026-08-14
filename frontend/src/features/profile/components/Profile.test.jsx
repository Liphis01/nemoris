import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Profile from "./Profile";
import { getProfile, updateProfile } from "../../../api/profile";
import { getStats } from "../../../api/stats";

vi.mock("../../../api/profile", () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn()
}));

vi.mock("../../../api/stats", () => ({
  getStats: vi.fn()
}));

const STATS = {
  counts: { total: 1441, due_total: 38, mastered: 612 },
  retention_by_type: { text: { reviews: 100, success: 87 } }
};

describe("Profile", () => {
  beforeEach(() => {
    getStats.mockResolvedValue(STATS);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("shows a sign-in prompt when signed out, and routes to Settings' sync section", async () => {
    getProfile.mockResolvedValue({
      signed_in: false,
      account_email: null,
      profile: null
    });
    const onOpenSettingsSection = vi.fn();

    render(
      <Profile
        setMode={vi.fn()}
        onOpenSettingsSection={onOpenSettingsSection}
      />
    );

    expect(await screen.findByText("Non connecté")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(onOpenSettingsSection).toHaveBeenCalledWith("settings-sync");
  });

  it("falls back to setMode(\"settings\") when onOpenSettingsSection is not provided", async () => {
    getProfile.mockResolvedValue({
      signed_in: false,
      account_email: null,
      profile: null
    });
    const setMode = vi.fn();

    render(<Profile setMode={setMode} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Se connecter" })
    );

    expect(setMode).toHaveBeenCalledWith("settings");
  });

  it("pre-fills the identity form for a signed-in user", async () => {
    getProfile.mockResolvedValue({
      signed_in: true,
      account_email: "louis@example.com",
      profile: {
        username: "Louis",
        avatar_emoji: "🦉",
        avatar_color: "teal",
        updated_at: "2026-07-26T10:00:00Z"
      }
    });

    render(<Profile setMode={vi.fn()} />);

    expect(await screen.findByText("Louis")).toBeInTheDocument();
    expect(screen.getByText("louis@example.com · connecté")).toBeInTheDocument();
    expect(screen.getByLabelText("Pseudo")).toHaveValue("Louis");
    expect(
      screen.getByRole("button", { name: "Avatar 🦉" })
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("saving a new emoji calls updateProfile and shows the inline success message", async () => {
    getProfile.mockResolvedValue({
      signed_in: true,
      account_email: "louis@example.com",
      profile: { username: "Louis", avatar_emoji: "🦉", avatar_color: "teal" }
    });
    updateProfile.mockResolvedValue({
      signed_in: true,
      account_email: "louis@example.com",
      profile: { username: "Louis", avatar_emoji: "🦊", avatar_color: "teal" }
    });

    render(<Profile setMode={vi.fn()} />);

    await screen.findByText("Louis");
    await userEvent.click(screen.getByRole("button", { name: "Avatar 🦊" }));
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith({
        username: "Louis",
        avatar_emoji: "🦊",
        avatar_color: "teal"
      });
    });
    expect(await screen.findByText("Profil enregistré.")).toBeInTheDocument();
  });

  it("shows a rejected save (taken username) as an inline alert", async () => {
    getProfile.mockResolvedValue({
      signed_in: true,
      account_email: "louis@example.com",
      profile: { username: "Louis", avatar_emoji: "🦉", avatar_color: "teal" }
    });
    updateProfile.mockRejectedValue(new Error("Ce pseudo est déjà pris."));

    render(<Profile setMode={vi.fn()} />);

    await screen.findByText("Louis");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(
      await screen.findByText("Ce pseudo est déjà pris.")
    ).toBeInTheDocument();
  });

  it("renders stat tiles from the shared /stats fetch, including computed retention", async () => {
    getProfile.mockResolvedValue({
      signed_in: false,
      account_email: null,
      profile: null
    });

    render(<Profile setMode={vi.fn()} />);

    expect(await screen.findByText("1441")).toBeInTheDocument();
    expect(screen.getByText("38")).toBeInTheDocument();
    expect(screen.getByText("612")).toBeInTheDocument();
    expect(screen.getByText("87%")).toBeInTheDocument();
  });

  it("shows an empty guidance state when there is no signal yet", async () => {
    getProfile.mockResolvedValue({
      signed_in: false,
      account_email: null,
      profile: null
    });
    getStats.mockResolvedValue({
      ...STATS,
      guidance: {
        weakest_groups: [],
        improving_groups: [],
        close_to_mastery_groups: [],
        fragile_upcoming_load_groups: [],
        new_material_runway: { unseen_total: 0, days_remaining: null },
        retention_by_tag: []
      }
    });

    render(<Profile setMode={vi.fn()} />);

    expect(
      await screen.findByText(
        "Pas encore assez d'historique pour une recommandation. Continue à réviser."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Rien de fragile en ce moment.")).toBeInTheDocument();
    expect(screen.getByText("Aucune charge fragile à venir.")).toBeInTheDocument();
  });

  it("recommends the most urgent group and opens its Study scope on click", async () => {
    getProfile.mockResolvedValue({
      signed_in: false,
      account_email: null,
      profile: null
    });
    getStats.mockResolvedValue({
      ...STATS,
      guidance: {
        weakest_groups: [
          { id: 7, name: "Départements français", total: 10, fragile_count: 4, fragile_ratio: 0.4, recent_miss_items: 3 }
        ],
        improving_groups: [],
        close_to_mastery_groups: [],
        fragile_upcoming_load_groups: [
          { id: 7, name: "Départements français", fragile_count: 4, upcoming_load: 6 }
        ],
        new_material_runway: { unseen_total: 12, days_remaining: 5 },
        retention_by_tag: [
          { tag: "core:geography", label: "Géographie", reviews: 40, retention: 82 }
        ]
      }
    });
    const onOpenStudy = vi.fn();

    render(<Profile setMode={vi.fn()} onOpenStudy={onOpenStudy} />);

    expect(
      await screen.findByText(/Départements français.*arrivent bientôt/)
    ).toBeInTheDocument();
    expect(screen.getByText("Géographie")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Étudier ce groupe →" })
    );

    expect(onOpenStudy).toHaveBeenCalledWith({
      type: "group",
      id: 7,
      name: "Départements français"
    });
  });
});
