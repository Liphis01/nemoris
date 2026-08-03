import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportDatabase, importDatabase } from "../../../api/backup";
import { getPackCatalogDiagnostics } from "../../../api/packs";
import {
  getReviewSettings,
  rebalanceReviewCalendar,
  updateReviewSettings
} from "../../../api/review";
import { getSyncStatus } from "../../../api/sync";
import { checkForUpdate } from "../../../api/updater";
import { getVersion } from "@tauri-apps/api/app";
import Settings from "./Settings";

vi.mock("../../../api/review", () => ({
  getReviewSettings: vi.fn(),
  rebalanceReviewCalendar: vi.fn(),
  updateReviewSettings: vi.fn()
}));

vi.mock("../../../api/backup", () => ({
  exportDatabase: vi.fn(),
  importDatabase: vi.fn()
}));

vi.mock("../../../api/packs", () => ({
  getPackCatalogDiagnostics: vi.fn()
}));

vi.mock("../../../api/sync", () => ({
  deleteAccountData: vi.fn(),
  getSyncStatus: vi.fn(),
  setSyncPreferences: vi.fn(),
  requestSyncCode: vi.fn(),
  verifySyncCode: vi.fn(),
  syncAuto: vi.fn(),
  syncPush: vi.fn(),
  syncPull: vi.fn(),
  syncSignOut: vi.fn()
}));

vi.mock("../../../api/updater", () => ({
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn()
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn()
}));

const PACE_TIERS = [
  { key: "leger", daily_target: 10, estimated_minutes: 3 },
  { key: "regulier", daily_target: 20, estimated_minutes: 5 },
  { key: "soutenu", daily_target: 40, estimated_minutes: 10 },
  { key: "intensif", daily_target: 80, estimated_minutes: 20 }
];

describe("Settings", () => {
  beforeEach(() => {
    getReviewSettings.mockResolvedValue({
      catchup_daily_target: 20,
      pace_tier: "regulier",
      pace_tier_resolved: "regulier",
      effective_daily_target: 20,
      pace_tiers: PACE_TIERS
    });
    updateReviewSettings.mockResolvedValue({
      catchup_daily_target: 40,
      pace_tier: "soutenu",
      pace_tier_resolved: "soutenu",
      effective_daily_target: 40,
      pace_tiers: PACE_TIERS
    });
    rebalanceReviewCalendar.mockResolvedValue({});
    exportDatabase.mockResolvedValue("quiz-app-backup-2026-06-18.zip");
    importDatabase.mockResolvedValue({ status: "imported" });
    getPackCatalogDiagnostics.mockResolvedValue({
      status: "ok",
      summary: "Catalogue prêt.",
      key_type: "publishable",
      total: 2,
      checks: [
        {
          id: "project_url",
          label: "URL projet",
          status: "ok",
          detail: "URL projet Supabase valide."
        },
        {
          id: "zip_files",
          label: "Fichiers ZIP",
          status: "ok",
          detail: "2 ZIP testés."
        }
      ],
      sample_packs: [
        {
          pack_guid: "world-map",
          name: "Pays du monde",
          download_status: "ok"
        }
      ]
    });
    getSyncStatus.mockResolvedValue({
      signed_in: false,
      account_email: null,
      server_url: "https://project.supabase.co",
      last_server_version: 0,
      auto_sync_enabled: false,
      local_change_seq: 0,
      last_synced_change_seq: 0,
      collection_dirty: false,
      last_auto_sync_at: null,
      last_auto_sync_status: null,
      last_auto_sync_error: null,
      code_schema_version: "0016",
      server_meta: null
    });
    checkForUpdate.mockResolvedValue(null);
    getVersion.mockResolvedValue("1.2.1");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the current pace tier", async () => {
    render(<Settings setMode={vi.fn()} />);

    const tier = await screen.findByRole("radio", { name: /Régulier/ });

    expect(tier).toHaveAttribute("aria-checked", "true");
    expect(getReviewSettings).toHaveBeenCalledTimes(1);
  });

  it("offers every tier with its time estimate", async () => {
    render(<Settings setMode={vi.fn()} />);

    await screen.findByRole("radio", { name: /Régulier/ });

    expect(screen.getByRole("radio", { name: /Léger/ })).toHaveTextContent(
      "~3 min"
    );
    expect(screen.getByRole("radio", { name: /Intensif/ })).toHaveTextContent(
      "80 questions"
    );
  });

  it("saves a picked tier and rebalances the calendar", async () => {
    render(<Settings setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("radio", { name: /Soutenu/ }));

    await waitFor(() => {
      expect(updateReviewSettings).toHaveBeenCalledWith({
        pace_tier: "soutenu"
      });
    });

    expect(rebalanceReviewCalendar).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Rythme enregistré. Calendrier rééquilibré.")
    ).toBeInTheDocument();
  });

  it("does not save or rebalance the tier already in use", async () => {
    render(<Settings setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("radio", { name: /Régulier/ }));

    expect(updateReviewSettings).not.toHaveBeenCalled();
    expect(rebalanceReviewCalendar).not.toHaveBeenCalled();
  });

  it("shows save errors and restores the previous tier", async () => {
    updateReviewSettings.mockRejectedValue(new Error("Save failed"));
    render(<Settings setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("radio", { name: /Soutenu/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(
      screen.getByRole("radio", { name: /Régulier/ })
    ).toHaveAttribute("aria-checked", "true");
    expect(rebalanceReviewCalendar).not.toHaveBeenCalled();
  });

  it("shows the auto-adjusted rate when it differs from the tier", async () => {
    getReviewSettings.mockResolvedValue({
      catchup_daily_target: 20,
      pace_tier: "regulier",
      pace_tier_resolved: "regulier",
      effective_daily_target: 14,
      pace_tiers: PACE_TIERS
    });
    render(<Settings setMode={vi.fn()} />);

    expect(
      await screen.findByText(/Rythme actuel : 14 \/ jour/)
    ).toBeInTheDocument();
  });

  it("highlights the nearest tier for a pre-tier custom target", async () => {
    getReviewSettings.mockResolvedValue({
      catchup_daily_target: 50,
      pace_tier: null,
      pace_tier_resolved: "soutenu",
      effective_daily_target: 50,
      pace_tiers: PACE_TIERS
    });
    render(<Settings setMode={vi.fn()} />);

    const tier = await screen.findByRole("radio", { name: /Soutenu/ });

    expect(tier).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(/Rythme personnalisé : 50 questions \/ jour/)
    ).toBeInTheDocument();
  });

  it("renders the database export and import controls", async () => {
    render(<Settings setMode={vi.fn()} />);

    await screen.findByRole("radio", { name: /Régulier/ });
    expect(
      screen.getByRole("button", { name: "Exporter la base" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Importer" })
    ).toBeInTheDocument();
  });

  it("prioritizes sync before local backup controls", async () => {
    render(<Settings setMode={vi.fn()} />);

    await screen.findByRole("radio", { name: /Régulier/ });
    const main = screen.getByRole("main", { name: "Paramètres" });
    const syncHeading = within(main).getByRole("heading", {
      name: "Synchronisation"
    });
    const dataHeading = within(main).getByRole("heading", {
      name: "Données"
    });

    expect(
      syncHeading.compareDocumentPosition(dataHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Envoyer vers le cloud" })
    ).toBeInTheDocument();
  });

  it("does not render the removed startup review setting", async () => {
    render(<Settings setMode={vi.fn()} />);

    await screen.findByRole("radio", { name: /Régulier/ });
    expect(
      screen.queryByText("Ouvrir la révision au démarrage si due")
    ).not.toBeInTheDocument();
  });

  it("does not offer to configure the catalogue project", async () => {
    render(<Settings setMode={vi.fn()} />);

    await screen.findByRole("radio", { name: /Régulier/ });
    expect(
      screen.queryByLabelText("URL du projet Supabase")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Clé publishable Supabase")
    ).not.toBeInTheDocument();
  });

  it("runs the pack catalogue diagnostic", async () => {
    render(<Settings setMode={vi.fn()} />);

    await screen.findByRole("radio", { name: /Régulier/ });
    fireEvent.click(screen.getByRole("button", { name: "Tester le catalogue" }));

    await waitFor(() => {
      expect(getPackCatalogDiagnostics).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Catalogue prêt.")).toBeInTheDocument();
    expect(screen.getByText("2 packs publics")).toBeInTheDocument();
    expect(screen.getByText("Fichiers ZIP")).toBeInTheDocument();
    expect(screen.getByText("Pays du monde")).toBeInTheDocument();
  });

  it("exports the database and reports the downloaded filename", async () => {
    render(<Settings setMode={vi.fn()} />);

    await screen.findByRole("radio", { name: /Régulier/ });
    fireEvent.click(screen.getByRole("button", { name: "Exporter la base" }));

    await waitFor(() => {
      expect(exportDatabase).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText(/quiz-app-backup-2026-06-18\.zip/)
    ).toBeInTheDocument();
  });

  it("imports a chosen backup file after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload }
    });

    render(<Settings setMode={vi.fn()} />);

    await screen.findByRole("radio", { name: /Régulier/ });
    const file = new File(["zip"], "backup.zip", {
      type: "application/zip"
    });
    fireEvent.change(screen.getByLabelText("Importer la base"), {
      target: { files: [file] }
    });

    await waitFor(() => {
      expect(importDatabase).toHaveBeenCalledWith(file);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not import when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<Settings setMode={vi.fn()} />);

    await screen.findByRole("radio", { name: /Régulier/ });
    const file = new File(["zip"], "backup.zip", {
      type: "application/zip"
    });
    fireEvent.change(screen.getByLabelText("Importer la base"), {
      target: { files: [file] }
    });

    expect(importDatabase).not.toHaveBeenCalled();
  });
});
