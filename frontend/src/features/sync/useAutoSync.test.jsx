import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLLECTION_MUTATION_EVENT } from "../../api/http";
import {
  getSyncStatus,
  syncAuto,
  syncPull,
  syncPush
} from "../../api/sync";
import AutoSyncBanner from "./AutoSyncBanner";
import { useAutoSync } from "./useAutoSync";

vi.mock("../../api/sync", () => ({
  getSyncStatus: vi.fn(),
  syncAuto: vi.fn(),
  syncPull: vi.fn(),
  syncPush: vi.fn()
}));

const ENABLED_STATUS = {
  signed_in: true,
  auto_sync_enabled: true,
  last_server_version: 1,
  server_meta: { version: 1 }
};

const DISABLED_STATUS = {
  signed_in: true,
  auto_sync_enabled: false,
  last_server_version: 1,
  server_meta: { version: 1 }
};

function HookProbe({ options = {}, withBanner = false }) {
  const autoSync = useAutoSync(options);

  return (
    <>
      <div data-testid="phase">{autoSync.phase}</div>
      {withBanner && <AutoSyncBanner {...autoSync} />}
    </>
  );
}

describe("useAutoSync", () => {
  beforeEach(() => {
    getSyncStatus.mockResolvedValue(ENABLED_STATUS);
    syncAuto.mockResolvedValue({ status: "idle" });
    syncPull.mockResolvedValue({ status: "pulled", version: 2 });
    syncPush.mockResolvedValue({ status: "pushed", version: 2 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("runs once on startup when automatic sync is enabled", async () => {
    render(<HookProbe />);

    await waitFor(() => {
      expect(syncAuto).toHaveBeenCalledTimes(1);
    });
  });

  it("does not run on startup when automatic sync is disabled", async () => {
    getSyncStatus.mockResolvedValue(DISABLED_STATUS);
    render(<HookProbe />);

    await waitFor(() => {
      expect(getSyncStatus).toHaveBeenCalledTimes(1);
    });
    expect(syncAuto).not.toHaveBeenCalled();
  });

  it("runs again when the window regains focus", async () => {
    render(<HookProbe options={{ lifecycleMinIntervalMs: 0 }} />);

    await waitFor(() => {
      expect(syncAuto).toHaveBeenCalledTimes(1);
    });
    syncAuto.mockClear();

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(syncAuto).toHaveBeenCalledTimes(1);
    });
  });

  it("debounces sync after a local collection mutation event", async () => {
    render(
      <HookProbe
        options={{ debounceMs: 50, lifecycleMinIntervalMs: 0 }}
      />
    );

    await waitFor(() => {
      expect(syncAuto).toHaveBeenCalledTimes(1);
    });
    syncAuto.mockClear();
    vi.useFakeTimers();

    window.dispatchEvent(new CustomEvent(COLLECTION_MUTATION_EVENT));

    await act(async () => {
      vi.advanceTimersByTime(49);
    });
    expect(syncAuto).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(syncAuto).toHaveBeenCalledTimes(1);
  });

  it("shows conflicts and force-pushes through the existing sync API", async () => {
    syncAuto.mockResolvedValue({ status: "conflict", server_version: 5 });
    render(<HookProbe withBanner />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Conflit de synchronisation : cloud v5.");

    fireEvent.click(screen.getByRole("button", { name: "Envoyer quand même" }));

    await waitFor(() => {
      expect(syncPush).toHaveBeenCalledWith({ force: true });
    });
  });

  it("downloads conflict resolution through the existing sync API and reloads", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload }
    });
    syncAuto.mockResolvedValue({ status: "conflict", server_version: 5 });
    render(<HookProbe withBanner />);

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Télécharger" }));

    await waitFor(() => {
      expect(syncPull).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
