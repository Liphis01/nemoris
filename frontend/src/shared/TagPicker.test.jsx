import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TagPicker from "./TagPicker";
import { primeTags, resetTags } from "./tagLabels";
import { applyTagActions } from "../api/tags";

vi.mock("../api/tags", () => ({
  getTags: vi.fn(() => Promise.resolve({ hierarchy: {}, usage: {} })),
  applyTagActions: vi.fn()
}));


const HIERARCHY = {
  parents: {
    technology: ["science"],
    computing: ["technology"],
    linux: ["computing"],
    biology: ["science"],
    europe: ["geography"]
  },
  labels: {
    science: "Sciences",
    technology: "Technologie",
    computing: "Informatique",
    linux: "Linux",
    biology: "Biologie",
    geography: "Géographie",
    europe: "Europe"
  }
};

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


function setup(props = {}) {
  const onAdd = vi.fn();
  const onChange = vi.fn();

  const utils = render(
    <TagPicker
      tags={[]}
      value=""
      onChange={onChange}
      onAdd={onAdd}
      onRemove={vi.fn()}
      {...props}
    />
  );

  return { onAdd, onChange, ...utils };
}


function openPicker() {
  fireEvent.focus(screen.getByLabelText("Ajouter un tag"));
}


function restoreDescriptor(proto, key, descriptor) {
  if (descriptor) {
    Object.defineProperty(proto, key, descriptor);
  } else {
    delete proto[key];
  }
}


describe("TagPicker", () => {
  beforeEach(() => {
    resetTags();
    primeTags({ revision: 4, hierarchy: HIERARCHY, usage: { linux: 4, biology: 2 } });
    applyTagActions.mockImplementation((_revision, actions) => Promise.resolve({
      revision: 5,
      hierarchy: {
        parents: {
          ...HIERARCHY.parents,
          [actions[0].tag_id]: actions[0].parent_ids
        },
        labels: {
          ...HIERARCHY.labels,
          [actions[0].tag_id]: actions[0].label
        }
      },
      usage: {},
      created_ids: [actions[0].tag_id]
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the root categories when focused with an empty box", () => {
    // The whole point: you should not need to remember your own vocabulary.
    setup();
    openPicker();

    expect(screen.getByText("#Sciences")).toBeInTheDocument();
    expect(screen.getByText("#Géographie")).toBeInTheDocument();
    // Nested nodes stay hidden until you go looking for them.
    expect(screen.queryByText("#Linux")).not.toBeInTheDocument();
  });

  it("hides unplaced parentless tags from browse mode until they are searched", () => {
    resetTags();
    primeTags({
      revision: 4,
      nodes: [
        tagNode("core:geography", "Géographie", [], { kind: "core", classification: "root" }),
        tagNode("core:science", "Sciences", [], { kind: "core", classification: "root" }),
        tagNode("33333333-3333-4333-8333-333333333333", "Shrek")
      ]
    });

    const { onAdd, rerender } = setup();
    openPicker();

    expect(screen.getByText("#Sciences")).toBeInTheDocument();
    expect(screen.queryByText("#Shrek")).not.toBeInTheDocument();

    rerender(
      <TagPicker
        tags={[]}
        value="shr"
        onChange={vi.fn()}
        onAdd={onAdd}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getByText("#Shrek")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText("#Shrek"));
    expect(onAdd).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
  });

  it("drills into a category's children without applying it", () => {
    const { onAdd } = setup();
    openPicker();

    fireEvent.mouseDown(screen.getByLabelText("Ouvrir Sciences"));

    expect(screen.getByText("#Technologie")).toBeInTheDocument();
    expect(screen.getByText("#Biologie")).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("applies a category directly, not only leaves", () => {
    const { onAdd } = setup();
    openPicker();

    fireEvent.mouseDown(screen.getByText("#Sciences"));

    expect(onAdd).toHaveBeenCalledWith("science");
  });

  it("walks back up from a drilled branch", () => {
    setup();
    openPicker();

    fireEvent.mouseDown(screen.getByLabelText("Ouvrir Sciences"));
    fireEvent.mouseDown(screen.getByLabelText("Ouvrir Technologie"));
    expect(screen.getByText("#Informatique")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText(/^◂/));

    expect(screen.getByText("#Technologie")).toBeInTheDocument();
  });

  it("searches with a breadcrumb so duplicates are distinguishable", () => {
    setup({ value: "linux" });
    openPicker();

    expect(screen.getByText("#Linux")).toBeInTheDocument();
    expect(
      screen.getByText("Sciences › Technologie › Informatique")
    ).toBeInTheDocument();
  });

  it("hides tags that are already applied", () => {
    setup({ tags: ["science"] });
    openPicker();

    // Scoped to the dropdown: "Sciences" is legitimately still on screen as
    // the applied chip, it just must not be offered again.
    const list = within(screen.getByRole("listbox"));

    expect(list.queryByText("#Sciences")).not.toBeInTheDocument();
    expect(list.getByText("#Géographie")).toBeInTheDocument();
  });

  it("files a newly created tag under the branch being browsed", async () => {
    const { onAdd, rerender } = setup();
    openPicker();
    fireEvent.mouseDown(screen.getByLabelText("Ouvrir Sciences"));
    fireEvent.mouseDown(screen.getByLabelText("Ouvrir Technologie"));
    fireEvent.mouseDown(screen.getByLabelText("Ouvrir Informatique"));

    rerender(
      <TagPicker tags={[]} value="Debian" onChange={vi.fn()} onAdd={onAdd} />
    );
    fireEvent.mouseDown(screen.getByText("＋ Créer « Debian »"));

    await waitFor(() => expect(applyTagActions).toHaveBeenCalled());

    // Browsing to Informatique is the user saying where it belongs.
    const [baseRevision, actions] = applyTagActions.mock.calls[0];
    expect(baseRevision).toBe(4);
    expect(actions).toEqual([expect.objectContaining({
      type: "create",
      tag_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      label: "Debian",
      locale: "fr",
      parent_ids: ["computing"]
    })]);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(actions[0].tag_id));
  });

  it("creates an opaque unparented tag when nothing was browsed", async () => {
    const { onAdd } = setup({ value: "Shrek" });
    const input = screen.getByLabelText("Ajouter un tag");
    openPicker();

    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(applyTagActions).toHaveBeenCalled());
    const actions = applyTagActions.mock.calls[0][1];
    expect(actions[0]).toEqual(expect.objectContaining({
      type: "create",
      label: "Shrek",
      parent_ids: []
    }));
    expect(actions[0]).not.toHaveProperty("classification");
    expect(actions[0].tag_id).not.toBe("shrek");
    expect(onAdd).toHaveBeenCalledWith(actions[0].tag_id);
  });

  it("does not apply an identity that the backend failed to create", async () => {
    applyTagActions.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { onAdd, rerender } = setup();
    openPicker();
    fireEvent.mouseDown(screen.getByLabelText("Ouvrir Sciences"));

    rerender(
      <TagPicker tags={[]} value="Astro" onChange={vi.fn()} onAdd={onAdd} />
    );
    fireEvent.keyDown(screen.getByLabelText("Ajouter un tag"), { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Création impossible"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("turns a built-in descendant suggestion into a local UUID", async () => {
    resetTags();
    primeTags({
      revision: 8,
      hierarchy: HIERARCHY,
      usage: {},
      suggestions: [{ key: "seed:linux", label: "Linux", suggested_parent_id: "computing" }]
    });
    const { onAdd } = setup({ value: "Linux" });
    const input = screen.getByLabelText("Ajouter un tag");
    openPicker();

    expect(screen.getByText("Suggestions")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Tab" });

    await waitFor(() => expect(applyTagActions).toHaveBeenCalled());
    const [revision, actions] = applyTagActions.mock.calls[0];
    expect(revision).toBe(8);
    expect(actions[0]).toEqual(expect.objectContaining({
      label: "Linux",
      parent_ids: ["computing"],
      suggestion_key: "seed:linux"
    }));
    expect(onAdd).toHaveBeenCalledWith(actions[0].tag_id);
  });

  it("navigates and selects with the keyboard", () => {
    const { onAdd } = setup();
    const input = screen.getByLabelText("Ajouter un tag");
    fireEvent.focus(input);

    // Roots sort as Géographie, Sciences.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledWith("science");
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
        return this.hasAttribute("data-tag-picker-row-index") ? 24 : 0;
      }
    });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get() {
        const index = Number(this.getAttribute("data-tag-picker-row-index"));
        return Number.isFinite(index) ? index * 28 : 0;
      }
    });

    try {
      resetTags();
      primeTags({
        revision: 4,
        nodes: Array.from({ length: 8 }, (_, index) => (
          tagNode(`core:root-${index}`, `Racine ${index}`, [], {
            kind: "core",
            classification: "root"
          })
        ))
      });

      setup();
      const input = screen.getByLabelText("Ajouter un tag");
      fireEvent.focus(input);
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

  it("drills with ArrowRight and climbs with ArrowLeft", () => {
    setup();
    const input = screen.getByLabelText("Ajouter un tag");
    fireEvent.focus(input);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(screen.getByText("#Biologie")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(screen.getByText("#Sciences")).toBeInTheDocument();
  });

  it("can be told not to offer creation", () => {
    setup({ value: "brandnew", allowCreate: false });
    openPicker();

    expect(screen.queryByText(/Créer/)).not.toBeInTheDocument();
  });

  it("lets modal callers raise the portaled dropdown above their overlay", () => {
    setup({ portalZIndex: 80 });
    openPicker();

    expect(screen.getByRole("listbox")).toHaveStyle({ zIndex: "80" });
  });
});
