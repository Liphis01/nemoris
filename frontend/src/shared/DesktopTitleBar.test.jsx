import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowApi = {
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  isMaximized: vi.fn(() => Promise.resolve(true)),
  onResized: vi.fn(() => Promise.resolve(() => {}))
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi
}));

import DesktopTitleBar from "./DesktopTitleBar";

describe("DesktopTitleBar", () => {
  afterEach(() => {
    cleanup();
    delete window.__NEMORIS_BACKEND__;
    document.documentElement.style.removeProperty("--shell-top");
    vi.clearAllMocks();
  });

  it("stays hidden outside the Tauri shell", () => {
    const { container } = render(<DesktopTitleBar />);

    expect(container.querySelector(".desktop-titlebar")).toBeNull();
    expect(
      document.documentElement.style.getPropertyValue("--shell-top")
    ).toBe("0px");
  });

  describe("inside the Tauri shell", () => {
    beforeEach(() => {
      window.__NEMORIS_BACKEND__ = "http://127.0.0.1:1234";
    });

    it("renders the bar with a native drag region and reserves --shell-top", async () => {
      const { container } = render(<DesktopTitleBar />);

      expect(container.querySelector(".desktop-titlebar")).not.toBeNull();
      expect(
        container.querySelector(".desktop-titlebar__drag[data-tauri-drag-region]")
      ).not.toBeNull();
      expect(
        container.querySelectorAll(".desktop-titlebar__button")
      ).toHaveLength(3);
      expect(
        document.documentElement.style.getPropertyValue("--shell-top")
      ).toBe("36px");

      await waitFor(() => expect(windowApi.isMaximized).toHaveBeenCalled());
    });

    it("drives the window through the Tauri window API", async () => {
      const { getByLabelText } = render(<DesktopTitleBar />);

      await waitFor(() => expect(windowApi.isMaximized).toHaveBeenCalled());

      fireEvent.click(getByLabelText("Réduire"));
      expect(windowApi.minimize).toHaveBeenCalled();

      fireEvent.click(getByLabelText("Restaurer"));
      expect(windowApi.toggleMaximize).toHaveBeenCalled();

      fireEvent.click(getByLabelText("Fermer"));
      expect(windowApi.close).toHaveBeenCalled();
    });
  });
});
