import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportDatabase, importDatabase } from "../../../api/backup";
import {
  getBlueprintCatalogSettings,
  saveBlueprintCatalogSettings
} from "../../../api/blueprints";
import {
  getReviewSettings,
  rebalanceReviewCalendar,
  updateReviewSettings
} from "../../../api/review";
import { getSyncStatus } from "../../../api/sync";
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

vi.mock("../../../api/blueprints", () => ({
  getBlueprintCatalogSettings: vi.fn(),
  saveBlueprintCatalogSettings: vi.fn()
}));

vi.mock("../../../api/sync", () => ({
  getSyncStatus: vi.fn(),
  setSyncServerUrl: vi.fn(),
  requestSyncCode: vi.fn(),
  verifySyncCode: vi.fn(),
  syncPush: vi.fn(),
  syncPull: vi.fn(),
  syncSignOut: vi.fn()
}));

describe("Settings", () => {
  beforeEach(() => {
    getReviewSettings.mockResolvedValue({ catchup_daily_target: 35 });
    updateReviewSettings.mockResolvedValue({ catchup_daily_target: 40 });
    rebalanceReviewCalendar.mockResolvedValue({});
    exportDatabase.mockResolvedValue("quiz-app-backup-2026-06-18.zip");
    importDatabase.mockResolvedValue({ status: "imported" });
    getBlueprintCatalogSettings.mockResolvedValue({ url: "" });
    saveBlueprintCatalogSettings.mockResolvedValue({ url: "" });
    getSyncStatus.mockResolvedValue({
      signed_in: false,
      account_email: null,
      server_url: "",
      last_server_version: 0,
      code_schema_version: "0016",
      server_meta: null
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the current daily target", async () => {
    render(<Settings setMode={vi.fn()} />);

    expect(await screen.findByDisplayValue("35")).toBeInTheDocument();
    expect(getReviewSettings).toHaveBeenCalledTimes(1);
  });

  it("saves a normalized target and rebalances the calendar", async () => {
    render(<Settings setMode={vi.fn()} />);

    const input = await screen.findByLabelText("Objectif quotidien");
    fireEvent.change(input, {
      target: {
        value: "40.8"
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      expect(updateReviewSettings).toHaveBeenCalledWith({
        catchup_daily_target: 40
      });
    });

    expect(rebalanceReviewCalendar).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("40")).toBeInTheDocument();
    expect(
      screen.getByText("Paramètres enregistrés. Calendrier rééquilibré.")
    ).toBeInTheDocument();
  });

  it("does not save or rebalance an unchanged target", async () => {
    render(<Settings setMode={vi.fn()} />);

    await screen.findByDisplayValue("35");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(updateReviewSettings).not.toHaveBeenCalled();
    expect(rebalanceReviewCalendar).not.toHaveBeenCalled();
  });

  it("shows save errors and restores the previous target draft", async () => {
    updateReviewSettings.mockRejectedValue(new Error("Save failed"));
    render(<Settings setMode={vi.fn()} />);

    const input = await screen.findByLabelText("Objectif quotidien");
    fireEvent.change(input, {
      target: {
        value: "42"
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByDisplayValue("35")).toBeInTheDocument();
    expect(rebalanceReviewCalendar).not.toHaveBeenCalled();
  });

  it("renders the database export and import controls", async () => {
    render(<Settings setMode={vi.fn()} />);

    await screen.findByDisplayValue("35");
    expect(
      screen.getByRole("button", { name: "Exporter la base" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Importer la base" })
    ).toBeInTheDocument();
  });

  it("exports the database and reports the downloaded filename", async () => {
    render(<Settings setMode={vi.fn()} />);

    await screen.findByDisplayValue("35");
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

    await screen.findByDisplayValue("35");
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

    await screen.findByDisplayValue("35");
    const file = new File(["zip"], "backup.zip", {
      type: "application/zip"
    });
    fireEvent.change(screen.getByLabelText("Importer la base"), {
      target: { files: [file] }
    });

    expect(importDatabase).not.toHaveBeenCalled();
  });
});
