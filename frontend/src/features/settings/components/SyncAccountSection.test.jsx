import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSyncStatus,
  requestSyncCode,
  syncPush,
  syncSignOut,
  verifySyncCode
} from "../../../api/sync";
import SyncAccountSection from "./SyncAccountSection";

vi.mock("../../../api/sync", () => ({
  getSyncStatus: vi.fn(),
  setSyncServerUrl: vi.fn(),
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
  code_schema_version: "0016",
  server_meta: null
};

const SIGNED_IN = {
  signed_in: true,
  account_email: "user@example.com",
  server_url: "http://127.0.0.1:9000",
  last_server_version: 1,
  code_schema_version: "0016",
  server_meta: { version: 1, schema_version: "0016", updated_at: "x" }
};

describe("SyncAccountSection", () => {
  beforeEach(() => {
    requestSyncCode.mockResolvedValue({ code: "123456" });
    verifySyncCode.mockResolvedValue({});
    syncPush.mockResolvedValue({ status: "pushed", version: 2 });
    syncSignOut.mockResolvedValue(SIGNED_OUT);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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

  it("signs out", async () => {
    getSyncStatus.mockResolvedValue(SIGNED_IN);
    render(<SyncAccountSection />);

    fireEvent.click(await screen.findByRole("button", { name: "Se déconnecter" }));
    await waitFor(() => expect(syncSignOut).toHaveBeenCalled());
  });
});
