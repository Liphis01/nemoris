import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DesktopStartupGate from "./DesktopStartupGate";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  relaunch: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: tauri.relaunch }));
vi.mock("./DesktopTitleBar", () => ({
  default: () => <div data-testid="desktop-titlebar" />
}));

let statusListener;
let stopListening;

beforeEach(() => {
  delete window.__NEMORIS_BACKEND__;
  statusListener = null;
  stopListening = vi.fn();
  tauri.invoke.mockReset();
  tauri.listen.mockReset();
  tauri.relaunch.mockReset();
  tauri.invoke.mockResolvedValue({ phase: "starting" });
  tauri.listen.mockImplementation(async (_event, listener) => {
    statusListener = listener;
    return stopListening;
  });
  tauri.relaunch.mockResolvedValue();
});

afterEach(() => {
  cleanup();
  delete window.__NEMORIS_BACKEND__;
});

describe("DesktopStartupGate", () => {
  it("renders web children immediately without contacting Tauri", () => {
    render(
      <DesktopStartupGate>
        <div>Application prête</div>
      </DesktopStartupGate>
    );

    expect(screen.getByText("Application prête")).toBeInTheDocument();
    expect(tauri.listen).not.toHaveBeenCalled();
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("keeps desktop children unmounted until the backend is ready", async () => {
    window.__NEMORIS_BACKEND__ = "http://127.0.0.1:1234";

    render(
      <DesktopStartupGate>
        <div>Application prête</div>
      </DesktopStartupGate>
    );

    expect(screen.getByText("Démarrage de Nemoris…")).toBeInTheDocument();
    expect(screen.queryByText("Application prête")).not.toBeInTheDocument();
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("backend_status"));

    act(() => statusListener({ payload: { phase: "ready" } }));

    expect(screen.getByText("Application prête")).toBeInTheDocument();
    expect(screen.queryByText("Démarrage de Nemoris…")).not.toBeInTheDocument();
  });

  it("does not regress to starting when an older snapshot arrives after ready", async () => {
    window.__NEMORIS_BACKEND__ = "http://127.0.0.1:1234";
    let resolveSnapshot;
    tauri.invoke.mockImplementation(() => new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));

    render(
      <DesktopStartupGate>
        <div>Application prête</div>
      </DesktopStartupGate>
    );

    await waitFor(() => expect(statusListener).toBeTypeOf("function"));
    act(() => statusListener({ payload: { phase: "ready" } }));
    expect(screen.getByText("Application prête")).toBeInTheDocument();

    await act(async () => resolveSnapshot({ phase: "starting" }));
    expect(screen.getByText("Application prête")).toBeInTheDocument();
  });

  it("shows a recoverable error and relaunches Nemoris", async () => {
    window.__NEMORIS_BACKEND__ = "http://127.0.0.1:1234";
    tauri.invoke.mockResolvedValue({ phase: "failed" });

    render(
      <DesktopStartupGate>
        <div>Application prête</div>
      </DesktopStartupGate>
    );

    expect(await screen.findByText("Nemoris n’a pas pu démarrer")).toBeInTheDocument();
    expect(screen.queryByText("Application prête")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Relancer Nemoris" }));
    expect(tauri.relaunch).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes from backend status changes on unmount", async () => {
    window.__NEMORIS_BACKEND__ = "http://127.0.0.1:1234";

    const { unmount } = render(
      <DesktopStartupGate>
        <div>Application prête</div>
      </DesktopStartupGate>
    );

    await waitFor(() => expect(tauri.invoke).toHaveBeenCalled());
    unmount();
    expect(stopListening).toHaveBeenCalledTimes(1);
  });
});
