import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { primeTags, resetTags } from "../../../shared/tagLabels";
import TagFilterControl from "./TagFilterControl";

vi.mock("../../../api/tags", () => ({
  getTags: vi.fn(() => Promise.resolve({ hierarchy: {}, usage: {} }))
}));


function tagNode(id, label, parents = [], extra = {}) {
  return {
    id,
    label,
    labels: { fr: label },
    default_locale: "fr",
    parents,
    direct_count: 0,
    total_count: 0,
    kind: id.startsWith("core:") ? "core" : "custom",
    origin: "local",
    pack_ids: [],
    source_packs: [],
    representative_questions: [],
    classification: parents.length ? "placed" : "unplaced",
    hidden: false,
    ...extra
  };
}


function seedTags(overrides = {}) {
  primeTags({
    revision: 4,
    nodes: [
      tagNode("science", "Sciences", [], { kind: "core", classification: "root" }),
      tagNode("technology", "Technologie", ["science"]),
      tagNode("computing", "Informatique", ["technology"]),
      tagNode("linux", "Linux", ["computing"]),
      tagNode("biology", "Biologie", ["science"]),
      tagNode("geography", "Géographie", [], { kind: "core", classification: "root" }),
      tagNode("europe", "Europe", ["geography"]),
      tagNode("shrek", "Shrek"),
      ...(overrides.nodes || [])
    ],
    usage: {
      linux: 4,
      europe: 2,
      shrek: 1,
      ...(overrides.usage || {})
    },
    total_usage: {
      science: 4,
      technology: 4,
      computing: 4,
      linux: 4,
      geography: 2,
      europe: 2,
      shrek: 1,
      ...(overrides.total_usage || {})
    }
  });
}


function setup(props = {}) {
  const onChange = vi.fn();

  render(
    <TagFilterControl
      value=""
      onChange={onChange}
      availableTags={["linux", "europe", "shrek"]}
      {...props}
    />
  );

  return { onChange };
}


function openFilter() {
  fireEvent.click(screen.getByRole("button", { name: "Filtrer par tag" }));
}


function restoreDescriptor(proto, key, descriptor) {
  if (descriptor) {
    Object.defineProperty(proto, key, descriptor);
  } else {
    delete proto[key];
  }
}


describe("TagFilterControl", () => {
  beforeEach(() => {
    resetTags();
    seedTags();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a filter placeholder instead of assignment chips by default", () => {
    setup();

    expect(screen.getByText("Filtrer par tag…")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Retirer le tag/i)).not.toBeInTheDocument();
  });

  it("opens on root filter categories only", () => {
    setup();
    openFilter();

    expect(screen.getByText("#Sciences")).toBeInTheDocument();
    expect(screen.getByText("#Géographie")).toBeInTheDocument();
    expect(screen.queryByText("#Linux")).not.toBeInTheDocument();
    expect(screen.queryByText("#Shrek")).not.toBeInTheDocument();
  });

  it("selects a root filter", () => {
    const { onChange } = setup();
    openFilter();

    fireEvent.mouseDown(screen.getByText("#Sciences"));

    expect(onChange).toHaveBeenCalledWith("science");
  });

  it("opens child branches without selecting", () => {
    const { onChange } = setup();
    openFilter();

    fireEvent.mouseDown(screen.getByLabelText("Ouvrir Sciences"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("#Technologie")).toBeInTheDocument();
    expect(screen.queryByText("#Biologie")).not.toBeInTheDocument();
  });

  it("finds and selects an unplaced tag by searching", () => {
    const { onChange } = setup();
    openFilter();

    fireEvent.change(screen.getByLabelText("Rechercher un tag à filtrer"), {
      target: { value: "shr" }
    });
    fireEvent.mouseDown(screen.getByText("#Shrek"));

    expect(onChange).toHaveBeenCalledWith("shrek");
  });

  it("clears the active filter", () => {
    const { onChange } = setup({ value: "linux" });

    expect(screen.getByText("Linux")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Effacer le filtre tag"));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("keeps the highlighted keyboard row visible inside the dropdown", async () => {
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const offsetTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.getAttribute("role") === "listbox" ? 60 : 0;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return this.hasAttribute("data-tag-filter-row-index") ? 24 : 0;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get() {
        const index = Number(this.getAttribute("data-tag-filter-row-index"));
        return Number.isFinite(index) ? index * 28 : 0;
      }
    });

    try {
      seedTags({
        nodes: Array.from({ length: 8 }, (_, index) => (
          tagNode(`core:root-${index}`, `Racine ${index}`, [], {
            kind: "core",
            classification: "root"
          })
        )),
        usage: Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [`core:root-${index}`, 1])
        ),
        total_usage: Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [`core:root-${index}`, 1])
        )
      });

      setup({
        availableTags: Array.from({ length: 8 }, (_, index) => `core:root-${index}`)
      });
      openFilter();
      const input = screen.getByLabelText("Rechercher un tag à filtrer");
      const listbox = screen.getByRole("listbox");

      expect(listbox.scrollTop).toBe(0);

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });

      await waitFor(() => expect(listbox.scrollTop).toBeGreaterThan(0));
    } finally {
      restoreDescriptor(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
      restoreDescriptor(HTMLElement.prototype, "offsetHeight", offsetHeightDescriptor);
      restoreDescriptor(HTMLElement.prototype, "offsetTop", offsetTopDescriptor);
    }
  });
});
