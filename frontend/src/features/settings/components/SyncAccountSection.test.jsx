import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSyncStatus,
  requestSyncCode,
  setSyncPreferences,
  syncPull,
  syncPush,
  syncSignOut,
  verifySyncCode
} from "../../../api/sync";
import SyncAccountSection from "./SyncAccountSection";

vi.mock("../../../api/sync", () => ({
  deleteAccountData: vi.fn(),
  getSyncStatus: vi.fn(),
  setSyncPreferences: vi.fn(),
  requestSyncCode: vi.fn(),
  verifySyncCode: vi.fn(),
  syncPush: vi.fn(),
  syncPull: vi.fn(),
  syncSignOut: vi.fn()
}));

const SIGNED_OUT = {
  signed_in: false,
  account_email: null,
  server_url: "http://127.0.0.1:9000",
  last_server_version: 0,
  auto_sync_enabled: false,
  local_change_seq: 0,
  last_synced_change_seq: 0,
  collection_dirty: false,
  last_auto_sync_at: null,
  last_auto_sync_status: null,
  last_auto_sync_error: null,
  code_schema_version: "0016",
  server_meta: null,
  server_reachable: null,
  server_error: null
};

const SIGNED_IN = {
  signed_in: true,
  account_email: "user@example.com",
  server_url: "http://127.0.0.1:9000",
  last_server_version: 1,
  auto_sync_enabled: false,
  local_change_seq: 0,
  last_synced_change_seq: 0,
  collection_dirty: false,
  last_auto_sync_at: null,
  last_auto_sync_status: null,
  last_auto_sync_error: null,
  code_schema_version: "0016",
  server_meta: { version: 1, schema_version: "0016", updated_at: "x" },
  server_reachable: true,
  server_error: null
};

describe("SyncAccountSection", () => {
  beforeEach(() => {
    requestSyncCode.mockResolvedValue({ code: "123456" });
    verifySyncCode.mockResolvedValue({});
    setSyncPreferences.mockResolvedValue({
      ...SIGNED_IN,
      auto_sync_enabled: true
    });
    syncPush.mockResolvedValue({ status: "pushed", version: 2 });
    syncPull.mockResolvedValue({ status: "pulled", version: 2 });
    syncSignOut.mockResolvedValue(SIGNED_OUT);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("runs the sign-in flow: email -> code -> signed in", async () => {
    getSyncStatus.mockResolvedValue(SIGNED_OUT);
    render(<SyncAccountSection />);

    const emailInput = await screen.findByLabelText("E-mail du compte");
    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Recevoir un code" }));

    // Dev code hint appears; code step shown.
    expect(await screen.findByLabelText("Code de connexion")).toBeInTheDocument();
    expect(screen.getByText(/Code \(dev\) : 123456/)).toBeInTheDocument();

    // Verifying flips status to signed-in on the follow-up refresh.
    getSyncStatus.mockResolvedValue(SIGNED_IN);
    fireEvent.change(screen.getByLabelText("Code de connexion"), {
      target: { value: "123456" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    await waitFor(() => {
      expect(verifySyncCode).toHaveBeenCalledWith("user@example.com", "123456");
    });
    expect(await screen.findByText(/Connecté en tant que/)).toBeInTheDocument();
  });

  it("disables resend during the cooldown and re-enables once it expires", async () => {
    // The whole flow runs under fake timers from the start: mixing a
    // real-timer setInterval (started before vi.useFakeTimers()) with a
    // later vi.advanceTimersByTime() would leave the interval untouched, so
    // real async findBy*/waitFor calls are avoided in favor of flushing
    // microtasks through act().
    vi.useFakeTimers();
    getSyncStatus.mockResolvedValue(SIGNED_OUT);
    render(<SyncAccountSection />);

    await act(async () => {});

    fireEvent.change(screen.getByLabelText("E-mail du compte"), {
      target: { value: "user@example.com" }
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recevoir un code" }));
    });

    const resendButton = screen.getByRole("button", { name: /Renvoyer/ });
    expect(resendButton).toHaveTextContent("Renvoyer (60s)");
    expect(resendButton).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByRole("button", { name: "Renvoyer le code" })).toBeEnabled();
  });

  it("lets the user fix a mistyped email from the code step", async () => {
    getSyncStatus.mockResolvedValue(SIGNED_OUT);
    render(<SyncAccountSection />);

    const emailInput = await screen.findByLabelText("E-mail du compte");
    fireEvent.change(emailInput, { target: { value: "typo@exemple.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Recevoir un code" }));

    await screen.findByLabelText("Code de connexion");
    fireEvent.click(screen.getByRole("button", { name: "Changer d'adresse" }));

    const fixedEmailInput = await screen.findByLabelText("E-mail du compte");
    expect(fixedEmailInput).toHaveValue("typo@exemple.com");
    expect(screen.queryByLabelText("Code de connexion")).not.toBeInTheDocument();
  });

  it("pushes and shows a success message", async () => {
    getSyncStatus.mockResolvedValue(SIGNED_IN);
    render(<SyncAccountSection />);

    const pushButton = await screen.findByRole("button", {
      name: "Envoyer vers le cloud"
    });
    fireEvent.click(pushButton);

    expect(await screen.findByText(/Envoyé \(v2\)\./)).toBeInTheDocument();
  });

  it("surfaces a conflict with download / force choices", async () => {
    getSyncStatus.mockResolvedValue(SIGNED_IN);
    syncPush.mockResolvedValue({ status: "conflict", server_version: 5 });
    render(<SyncAccountSection />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Envoyer vers le cloud" })
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/La copie cloud est plus récente \(v5\)/);
    // The conflict panel itself offers both resolutions.
    expect(
      within(alert).getByRole("button", { name: "Télécharger" })
    ).toBeInTheDocument();
    expect(
      within(alert).getByRole("button", { name: "Envoyer quand même" })
    ).toBeInTheDocument();
  });

  it("saves the automatic sync preference", async () => {
    getSyncStatus.mockResolvedValue(SIGNED_IN);
    render(<SyncAccountSection />);

    const toggle = await screen.findByLabelText("Synchronisation automatique");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(setSyncPreferences).toHaveBeenCalledWith({
        auto_sync_enabled: true
      });
    });
    expect(
      await screen.findByText("Synchronisation automatique activée.")
    ).toBeInTheDocument();
  });

  it("does not show a stale unreachable auto-sync error when cloud status is reachable", async () => {
    getSyncStatus.mockResolvedValue({
      ...SIGNED_IN,
      auto_sync_enabled: true,
      last_auto_sync_status: "skipped",
      last_auto_sync_error: "Sync server unreachable"
    });
    render(<SyncAccountSection />);

    expect(await screen.findByText("Active · Ignorée")).toBeInTheDocument();
    expect(screen.getByText(/cloud : v1/)).toBeInTheDocument();
    expect(screen.queryByText(/Sync server unreachable/)).not.toBeInTheDocument();
  });

  it("shows the current cloud error when the status probe cannot reach it", async () => {
    getSyncStatus.mockResolvedValue({
      ...SIGNED_IN,
      auto_sync_enabled: true,
      server_meta: null,
      server_reachable: false,
      server_error: "Sync server unreachable",
      last_auto_sync_status: "skipped",
      last_auto_sync_error: "Sync server unreachable"
    });
    render(<SyncAccountSection />);

    expect(
      await screen.findByText(/cloud inaccessible : Sync server unreachable/)
    ).toBeInTheDocument();
    expect(
      screen.getByText("Active · Ignorée · Sync server unreachable")
    ).toBeInTheDocument();
  });

  it("signs out", async () => {
    getSyncStatus.mockResolvedValue(SIGNED_IN);
    render(<SyncAccountSection />);

    fireEvent.click(await screen.findByRole("button", { name: "Se déconnecter" }));
    await waitFor(() => expect(syncSignOut).toHaveBeenCalled());
  });
});
