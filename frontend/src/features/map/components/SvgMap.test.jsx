import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SvgMap from "./SvgMap";
import { mapZoneGeometry } from "./mapGeometry";

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

const v2SvgMarkup = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
    <path data-nemoris-shape="s000001" data-code="ignored-source-answer" d="M0 0h10v10H0z" />
    <path data-nemoris-shape="s000002" d="M10 0h10v10H10z" />
  </svg>
`;

const v2Manifest = {
  schema_version: 2,
  canonicalizer_version: 1,
  zones: [{
    code: "logical",
    shape_ids: ["s000001"],
    hit_shape_ids: ["s000002"],
    source_keys: ["data-code:logical"]
  }]
};

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

  it("zooms around the viewport center from external zoom commands", async () => {
    mockSvgFetch();
    const { container, rerender } = renderTestMap({
      zoomDirection: 0,
      zoomVersion: 0
    });

    await waitFor(() => {
      expectFill(zone(container, "neutral"), "#444");
    });

    const layer = mapLayer(container);
    const wrapper = layer.parentElement;

    wrapper.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100
    }));

    rerender(
      <div style={{ height: "320px", width: "480px" }}>
        <SvgMap
          svgPath="/maps/test.svg"
          found={["found"]}
          missed={["missed"]}
          dueItems={["due"]}
          unsaved={["unsaved"]}
          selected="selected"
          zoomDirection={1}
          zoomVersion={1}
        />
      </div>
    );

    await waitFor(() => {
      expect(layer.style.transform)
        .toBe("translate(-25px, -12.5px) scale(1.25)");
    });

    rerender(
      <div style={{ height: "320px", width: "480px" }}>
        <SvgMap
          svgPath="/maps/test.svg"
          found={["found"]}
          missed={["missed"]}
          dueItems={["due"]}
          unsaved={["unsaved"]}
          selected="selected"
          zoomDirection={-1}
          zoomVersion={2}
        />
      </div>
    );

    await waitFor(() => {
      expect(layer.style.transform).toBe("translate(0px, 0px) scale(1)");
    });
  });

  it("limits selection to clickable zone codes without changing hover behavior", async () => {
    mockSvgFetch();
    const onSelect = vi.fn();
    const { container } = renderTestMap({
      clickableCodes: ["due"],
      onSelect
    });

    await waitFor(() => {
      expectFill(zone(container, "neutral"), "#444");
    });

    const neutralZone = zone(container, "neutral");
    const dueZone = zone(container, "due");

    expect(neutralZone).toHaveStyle({ cursor: "pointer" });
    expect(dueZone).toHaveStyle({ cursor: "pointer" });

    fireEvent.mouseEnter(neutralZone);
    expectFill(neutralZone, "#888");
    fireEvent.mouseLeave(neutralZone);
    expectFill(neutralZone, "#444");

    fireEvent.click(neutralZone);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(dueZone);
    expect(onSelect).toHaveBeenCalledWith("due");
  });
});

describe("mapZoneGeometry", () => {
  it("unions multipart zone boxes and ignores invalid geometry", () => {
    const geometry = mapZoneGeometry([
      { code: "islands", el: { getBBox: () => ({ x: 2, y: 4, width: 3, height: 2 }) } },
      { code: "islands", el: { getBBox: () => ({ x: 8, y: 1, width: 4, height: 5 }) } },
      { code: "broken", el: { getBBox: () => { throw new Error("no bbox"); } } }
    ], { viewBox: { baseVal: { width: 30, height: 40 } } });

    expect(geometry.diagonal).toBe(50);
    expect(geometry.zones).toEqual({
      islands: {
        bbox: { x: 2, y: 1, width: 10, height: 5 },
        centroid: { x: 7, y: 3.5 }
      }
    });
  });
});

describe("SvgMap package v2", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("binds canonical shape ids and ignores source semantics", async () => {
    mockSvgFetch(v2SvgMarkup);
    const onSelect = vi.fn();
    const onCodesLoaded = vi.fn();
    const { container } = renderTestMap({
      mapManifest: v2Manifest,
      onSelect,
      onCodesLoaded
    });

    await waitFor(() => {
      expect(onCodesLoaded).toHaveBeenCalledWith(["logical"]);
    });
    fireEvent.click(container.querySelector('[data-nemoris-shape="s000001"]'));
    fireEvent.click(container.querySelector('[data-nemoris-shape="s000002"]'));

    expect(onSelect).toHaveBeenNthCalledWith(1, "logical");
    expect(onSelect).toHaveBeenNthCalledWith(2, "logical");
    expect(onSelect).not.toHaveBeenCalledWith("ignored-source-answer");
  });

  it("makes due hit-area island shapes more visible than normal due country shapes", async () => {
    mockSvgFetch(v2SvgMarkup);
    const { container } = renderTestMap({
      mapManifest: v2Manifest,
      dueItems: ["logical"]
    });

    await waitFor(() => {
      expect(container.querySelector('[data-nemoris-shape="s000001"]')).toBeInTheDocument();
    });

    const countryShape = container.querySelector('[data-nemoris-shape="s000001"]');
    const hitAreaShape = container.querySelector('[data-nemoris-shape="s000002"]');

    expectFill(countryShape, "#0e3e5adc");
    expectFill(hitAreaShape, "#22d3ee");
    expect(hitAreaShape).toHaveStyle({ opacity: "0.55" });

    fireEvent.mouseEnter(hitAreaShape);
    expectFill(hitAreaShape, "#7dd3fc");
    fireEvent.mouseLeave(hitAreaShape);
    expectFill(hitAreaShape, "#22d3ee");
  });

  it("fails closed when a manifest shape is missing", async () => {
    mockSvgFetch(v2SvgMarkup);
    const missingManifest = {
      ...v2Manifest,
      zones: [{
        ...v2Manifest.zones[0],
        shape_ids: ["s999999"],
        hit_shape_ids: []
      }]
    };
    const { container, findByRole } = renderTestMap({
      mapManifest: missingManifest
    });

    expect(await findByRole("status")).toHaveTextContent(
      "Map manifest does not match its SVG"
    );
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});
