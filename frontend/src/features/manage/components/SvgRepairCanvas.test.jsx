import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SvgRepairCanvas from "./SvgRepairCanvas";


const inspectionSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 10">
    <path data-nemoris-draft-shape="p000001" d="M0 0H10V10H0Z"/>
    <path data-nemoris-draft-shape="p000002" d="M20 0H30V10H20Z"/>
  </svg>
`;


describe("SvgRepairCanvas", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads only the inspection SVG and supports click and Shift-click selection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(inspectionSvg)
    }));
    const onSelectionChange = vi.fn();
    const { container, rerender } = render(
      <SvgRepairCanvas
        svgPath="/inspection.svg"
        shapes={[
          { ref: "p000001", role: "zone" },
          { ref: "p000002", role: "unresolved", risk: "required" }
        ]}
        selectedRefs={[]}
        hoveredRef={null}
        onSelectionChange={onSelectionChange}
        onHover={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(
        container.querySelector('[data-nemoris-draft-shape="p000001"]')
      ).toBeInTheDocument();
    });
    expect(fetch).toHaveBeenCalledWith(
      "/inspection.svg",
      expect.objectContaining({ cache: "no-store" })
    );

    const first = container.querySelector(
      '[data-nemoris-draft-shape="p000001"]'
    );
    fireEvent.pointerDown(first, {
      button: 0, clientX: 5, clientY: 5, pointerId: 1
    });
    fireEvent.pointerUp(first, {
      button: 0, clientX: 5, clientY: 5, pointerId: 1
    });
    expect(onSelectionChange).toHaveBeenLastCalledWith(["p000001"]);

    rerender(
      <SvgRepairCanvas
        svgPath="/inspection.svg"
        shapes={[
          { ref: "p000001", role: "zone" },
          { ref: "p000002", role: "unresolved", risk: "required" }
        ]}
        selectedRefs={["p000001"]}
        hoveredRef={null}
        onSelectionChange={onSelectionChange}
        onHover={vi.fn()}
      />
    );
    const second = container.querySelector(
      '[data-nemoris-draft-shape="p000002"]'
    );
    fireEvent.pointerDown(second, {
      button: 0,
      clientX: 25,
      clientY: 5,
      pointerId: 2,
      shiftKey: true
    });
    fireEvent.pointerUp(second, {
      button: 0,
      clientX: 25,
      clientY: 5,
      pointerId: 2,
      shiftKey: true
    });
    expect(onSelectionChange).toHaveBeenLastCalledWith([
      "p000001", "p000002"
    ]);
  });

  it("selects every intersecting shape with a dragged rectangle", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(inspectionSvg)
    }));
    const onSelectionChange = vi.fn();
    const { container } = render(
      <SvgRepairCanvas
        svgPath="/inspection.svg"
        shapes={[]}
        selectedRefs={[]}
        hoveredRef={null}
        onSelectionChange={onSelectionChange}
        onHover={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(container.querySelectorAll("[data-nemoris-draft-shape]")).toHaveLength(2);
    });

    const canvas = container.firstChild;
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100
    });
    const [first, second] = container.querySelectorAll(
      "[data-nemoris-draft-shape]"
    );
    first.getBoundingClientRect = () => ({
      left: 5, top: 5, right: 15, bottom: 15, width: 10, height: 10
    });
    second.getBoundingClientRect = () => ({
      left: 70, top: 70, right: 80, bottom: 80, width: 10, height: 10
    });

    fireEvent.pointerDown(canvas, {
      button: 0, clientX: 0, clientY: 0, pointerId: 4
    });
    fireEvent.pointerMove(canvas, {
      clientX: 30, clientY: 30, pointerId: 4
    });
    fireEvent.pointerUp(canvas, {
      button: 0, clientX: 30, clientY: 30, pointerId: 4
    });
    expect(onSelectionChange).toHaveBeenLastCalledWith(["p000001"]);
  });
});
