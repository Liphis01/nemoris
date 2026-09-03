import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getReviewIntakeQueue,
  updateReviewIntakeOrder,
  updateReviewIntakeSuspension
} from "../../../api/review";
import IntakeQueuePanel from "./IntakeQueuePanel";

vi.mock("../../../api/review", () => ({
  getReviewIntakeQueue: vi.fn(),
  updateReviewIntakeOrder: vi.fn(),
  updateReviewIntakeSuspension: vi.fn()
}));


const baseQueue = {
  quota: 2,
  today_ids: [1, 2],
  active_ids: [1, 2, 3],
  suspended_ids: [4],
  counts: {
    today: 2,
    active: 3,
    suspended: 1,
    total: 4
  }
};

const questions = [
  {
    id: 1,
    type_q: "text",
    question: "Alpha",
    answer: "A",
    tags: ["geo"],
    data: { favorite: true },
    progress: { next_review: null },
    suspended: false
  },
  {
    id: 2,
    type_q: "map",
    question: "Map 1",
    answer: "Beta",
    tags: ["history"],
    data: {},
    group_id: 10,
    group: { id: 10, type_group: "map", name: "Europe" },
    progress: { next_review: null },
    suspended: false
  },
  {
    id: 3,
    type_q: "map",
    question: "Map 2",
    answer: "Gamma",
    tags: ["history"],
    data: {},
    group_id: 10,
    group: { id: 10, type_group: "map", name: "Europe" },
    progress: { next_review: null },
    suspended: false
  },
  {
    id: 4,
    type_q: "media",
    question: "Delta",
    answer: "D",
    tags: ["geo"],
    data: {},
    progress: { next_review: null },
    suspended: true
  }
];


function renderPanel(props = {}) {
  const merged = {
    allQuestions: questions,
    tagParents: {},
    tagLabels: {},
    patchQuestionsInCache: vi.fn(),
    setSelectedItem: vi.fn(),
    ...props
  };

  render(<IntakeQueuePanel {...merged} />);
  return merged;
}


async function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /File des nouvelles/ }));
  await screen.findByText("Aujourd'hui · 2");
}


describe("IntakeQueuePanel", () => {
  beforeEach(() => {
    getReviewIntakeQueue.mockResolvedValue({ ...baseQueue });
    updateReviewIntakeOrder.mockResolvedValue({
      ...baseQueue,
      today_ids: [2, 3],
      active_ids: [2, 3, 1]
    });
    updateReviewIntakeSuspension.mockResolvedValue({
      ...baseQueue,
      today_ids: [2, 3],
      active_ids: [2, 3],
      suspended_ids: [4, 1],
      counts: { today: 2, active: 2, suspended: 2, total: 4 }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders today, reserve, and suspended rows with counts", async () => {
    renderPanel();
    await openPanel();

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Europe")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Réserve · 4/ }));
    expect(screen.getByRole("button", { name: /Actives · 3/ })).toBeInTheDocument();
    expect(screen.getByText("2 questions")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Suspendues · 1/ }));
    expect(screen.getByText("Delta")).toBeInTheDocument();
  });

  it("respects Manage filters for displayed queue rows", async () => {
    renderPanel({ tagFilter: "geo" });
    await openPanel();

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Europe")).not.toBeInTheDocument();
  });

  it("disables reorder controls outside the unfiltered active reserve", async () => {
    renderPanel();
    await openPanel();

    expect(screen.getAllByRole("button", { name: "Descendre dans la file" })[0]).toBeDisabled();

    cleanup();
    renderPanel({ search: "Alpha" });
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Réserve · 4/ }));

    expect(screen.getAllByRole("button", { name: "Descendre dans la file" })[0]).toBeDisabled();
  });

  it("sends the full active order when moving a block", async () => {
    renderPanel();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Réserve · 4/ }));

    fireEvent.click(screen.getAllByRole("button", { name: "Descendre dans la file" })[0]);

    await waitFor(() => {
      expect(updateReviewIntakeOrder).toHaveBeenCalledWith([2, 3, 1]);
    });
  });

  it("sends the full active order when moving inside an expanded group", async () => {
    renderPanel();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Réserve · 4/ }));
    fireEvent.click(screen.getByRole("button", { name: "Afficher" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Descendre dans la file" })[2]);

    await waitFor(() => {
      expect(updateReviewIntakeOrder).toHaveBeenCalledWith([1, 3, 2]);
    });
  });

  it("suspends a row and patches the Manage cache", async () => {
    const props = renderPanel();
    await openPanel();

    fireEvent.click(screen.getAllByRole("button", { name: "Suspendre la question" })[0]);

    await waitFor(() => {
      expect(updateReviewIntakeSuspension).toHaveBeenCalledWith([1], true);
    });
    expect(props.patchQuestionsInCache).toHaveBeenCalledWith([
      { id: 1, suspended: true }
    ]);
  });

  it("resumes a suspended row", async () => {
    const props = renderPanel();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Réserve · 4/ }));
    fireEvent.click(screen.getByRole("button", { name: /Suspendues · 1/ }));

    fireEvent.click(screen.getByRole("button", { name: "Reprendre la question" }));

    await waitFor(() => {
      expect(updateReviewIntakeSuspension).toHaveBeenCalledWith([4], false);
    });
    expect(props.patchQuestionsInCache).toHaveBeenCalledWith([
      { id: 4, suspended: false }
    ]);
  });
});
