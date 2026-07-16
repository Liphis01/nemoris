import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DesktopTitleBar from "./DesktopTitleBar";

describe("DesktopTitleBar", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    document.documentElement.style.removeProperty("--shell-top");
  });

  it("stays hidden in a plain browser", () => {
    const { container } = render(<DesktopTitleBar />);

    expect(container.querySelector(".desktop-titlebar")).toBeNull();
  });

  it("renders from the ?shell=desktop flag alone, before the pywebview bridge injects", () => {
    // The desktop launcher opens /?shell=desktop; on WebView2 the bridge
    // lands after React mounts, so the flag must be enough to show the bar.
    window.history.replaceState(null, "", "/?shell=desktop");

    const { container } = render(<DesktopTitleBar />);

    expect(container.querySelector(".desktop-titlebar")).not.toBeNull();
    expect(
      container.querySelector(".desktop-titlebar .pywebview-drag-region")
    ).not.toBeNull();
    expect(
      container.querySelectorAll(".desktop-titlebar__button")
    ).toHaveLength(3);
    expect(container.querySelector(".desktop-resize-grip")).not.toBeNull();
    expect(
      document.documentElement.style.getPropertyValue("--shell-top")
    ).toBe("36px");
  });
});
