import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DesktopTitleBar from "./DesktopTitleBar";

describe("DesktopTitleBar", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      )
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
    document.documentElement.style.removeProperty("--shell-top");
  });

  it("stays hidden in a plain browser", () => {
    const { container } = render(<DesktopTitleBar />);

    expect(container.querySelector(".desktop-titlebar")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders from the ?shell=desktop flag alone", () => {
    window.history.replaceState(null, "", "/?shell=desktop");

    const { container } = render(<DesktopTitleBar />);

    expect(container.querySelector(".desktop-titlebar")).not.toBeNull();
    expect(
      container.querySelectorAll(".desktop-titlebar__button")
    ).toHaveLength(3);
    expect(
      document.documentElement.style.getPropertyValue("--shell-top")
    ).toBe("36px");
  });

  it("shows resize edge strips when restored and hides them maximized", async () => {
    window.history.replaceState(null, "", "/?shell=desktop");

    fetch.mockImplementation((url) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            url === "/shell/window/state" ? { maximized: false } : {}
          )
      })
    );

    const { container, unmount } = render(<DesktopTitleBar />);

    await waitFor(() => {
      expect(container.querySelectorAll(".shell-resize-edge")).toHaveLength(8);
    });

    fireEvent.pointerDown(
      container.querySelector(".shell-resize-edge--nw"),
      { button: 0 }
    );
    expect(fetch).toHaveBeenCalledWith("/shell/window/start-resize?edge=nw", {
      method: "POST"
    });

    unmount();

    fetch.mockImplementation((url) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            url === "/shell/window/state" ? { maximized: true } : {}
          )
      })
    );

    const maximizedRender = render(<DesktopTitleBar />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/shell/window/state", {
        method: "GET"
      });
    });
    expect(
      maximizedRender.container.querySelectorAll(".shell-resize-edge")
    ).toHaveLength(0);
  });

  it("drives the window over the /shell/window HTTP routes", async () => {
    window.history.replaceState(null, "", "/?shell=desktop");

    const { getByLabelText, container } = render(<DesktopTitleBar />);

    // Initial glyph sync + readiness report for the gesture test.
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/shell/window/state", {
        method: "GET"
      });
    });
    expect(fetch).toHaveBeenCalledWith("/shell/window/client-ready", {
      method: "POST"
    });

    fireEvent.click(getByLabelText("Réduire"));
    expect(fetch).toHaveBeenCalledWith("/shell/window/minimize", {
      method: "POST"
    });

    fireEvent.click(getByLabelText("Fermer"));
    expect(fetch).toHaveBeenCalledWith("/shell/window/close", {
      method: "POST"
    });

    fireEvent.pointerDown(
      container.querySelector(".desktop-titlebar__drag"),
      { button: 0, detail: 1 }
    );
    expect(fetch).toHaveBeenCalledWith("/shell/window/start-drag", {
      method: "POST"
    });

  });
});
