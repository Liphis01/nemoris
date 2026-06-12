import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SvgMap from "./SvgMap";

const svgMarkup = `
  <svg viewBox="0 0 100 100">
    <path data-code="neutral" d="M0 0h10v10H0z" />
    <path data-code="due" d="M10 0h10v10H10z" />
    <path data-code="missed" d="M20 0h10v10H20z" />
    <path data-code="found" d="M30 0h10v10H30z" />
    <path data-code="unsaved" d="M40 0h10v10H40z" />
    <path data-code="selected" d="M50 0h10v10H50z" />
  </svg>
`;

function mockSvgFetch(markup = svgMarkup) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue(markup)
    })
  );
}

function zone(container, code) {
  return container.querySelector(`[data-code="${code}"]`);
}

function mapLayer(container, code = "neutral") {
  return zone(container, code).closest("div");
}

function expectFill(element, color) {
  expect(element).toHaveStyle({ fill: color });
}

function renderTestMap(props = {}) {
  return render(
    <div style={{ height: "320px", width: "480px" }}>
      <SvgMap
        svgPath="/maps/test.svg"
        found={["found"]}
        missed={["missed"]}
        dueItems={["due"]}
        unsaved={["unsaved"]}
        selected="selected"
        {...props}
      />
    </div>
  );
}

describe("SvgMap zone hover colors", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses state-aware hover colors for every zone state", async () => {
    mockSvgFetch();

    const { container } = renderTestMap();

    await waitFor(() => {
      expect(zone(container, "neutral")).toBeInTheDocument();
    });

    const expectedBaseColors = {
      neutral: "#444",
      due: "#0e3e5adc",
      missed: "#e93723",
      found: "#21eb75",
      unsaved: "#facc15",
      selected: "#f39c12"
    };

    const expectedHoverColors = {
      neutral: "#888",
      due: "#38bdf8",
      missed: "#fb7185",
      found: "#34d399",
      unsaved: "#fde047",
      selected: "#fbbf24"
    };

    await waitFor(() => {
      expectFill(zone(container, "neutral"), expectedBaseColors.neutral);
    });

    Object.entries(expectedBaseColors).forEach(([code, color]) => {
      const mapZone = zone(container, code);

      expectFill(mapZone, color);
      fireEvent.mouseEnter(mapZone);
      expectFill(mapZone, expectedHoverColors[code]);
      fireEvent.mouseLeave(mapZone);
      expectFill(mapZone, color);
    });
  });

  it("keeps the hover color when map styles are reapplied under the pointer", async () => {
    mockSvgFetch();

    const { container, rerender } = renderTestMap({
      onSelect: vi.fn()
    });

    await waitFor(() => {
      expectFill(zone(container, "due"), "#0e3e5adc");
    });

    const dueZone = zone(container, "due");

    fireEvent.mouseEnter(dueZone);
    expectFill(dueZone, "#38bdf8");

    rerender(
      <div style={{ height: "320px", width: "480px" }}>
        <SvgMap
          svgPath="/maps/test.svg"
          found={["found"]}
          missed={["missed"]}
          dueItems={["due"]}
          unsaved={["unsaved"]}
          selected="selected"
          onSelect={vi.fn()}
        />
      </div>
    );

    await waitFor(() => {
      expectFill(zone(container, "due"), "#38bdf8");
    });

    fireEvent.mouseLeave(zone(container, "due"));
    expectFill(zone(container, "due"), "#0e3e5adc");
  });

  it("pans with left click drag without selecting the dragged zone", async () => {
    mockSvgFetch();
    const onSelect = vi.fn();
    const { container } = renderTestMap({ onSelect });

    await waitFor(() => {
      expectFill(zone(container, "neutral"), "#444");
    });

    const neutralZone = zone(container, "neutral");
    const layer = mapLayer(container);

    fireEvent.mouseDown(neutralZone, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.mouseMove(layer, { buttons: 1, clientX: 42, clientY: 34 });
    fireEvent.mouseUp(layer, { button: 0, clientX: 42, clientY: 34 });
    fireEvent.click(neutralZone);

    expect(layer.style.transform).toBe("translate(32px, 14px) scale(1)");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps normal left clicks selecting zones", async () => {
    mockSvgFetch();
    const onSelect = vi.fn();
    const { container } = renderTestMap({ onSelect });

    await waitFor(() => {
      expectFill(zone(container, "neutral"), "#444");
    });

    const neutralZone = zone(container, "neutral");

    fireEvent.mouseDown(neutralZone, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.mouseUp(neutralZone, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.click(neutralZone);

    expect(onSelect).toHaveBeenCalledWith("neutral");
  });
});
