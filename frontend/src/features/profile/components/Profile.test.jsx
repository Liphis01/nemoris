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
});
