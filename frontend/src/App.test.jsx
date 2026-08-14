import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./api/review", () => ({
  getReviewSummary: vi.fn(() => Promise.resolve({ due_count: 0 })),
  getStartupRebalanceNotice: vi.fn(() => Promise.resolve(null))
}));

vi.mock("./features/manage/hooks/useManageLibrary", () => ({
  useManageLibrary: vi.fn(() => ({
    allQuestions: [],
    resetManageFilters: vi.fn(),
    setIsCreatingGroup: vi.fn(),
    setIsCreatingQuestion: vi.fn(),
    setSelectedItem: vi.fn(),
    setViewMode: vi.fn()
  }))
}));

vi.mock("./features/review/hooks/useReviewSession", () => ({
  useReviewSession: vi.fn(() => ({}))
}));

vi.mock("./features/sync/useAutoSync", () => ({
  useAutoSync: vi.fn(() => ({}))
}));

vi.mock("./shared/DesktopTitleBar", () => ({
  default: () => null
}));

vi.mock("./features/update/UpdateBanner", () => ({
  default: () => null
}));

vi.mock("./features/sync/AutoSyncBanner", () => ({
  default: () => null
}));

vi.mock("./features/menu/Menu", () => ({
  default: ({ setMode }) => (
    <main>
      <h1>Menu</h1>
      <button type="button" onClick={() => setMode("manage")}>Gestionnaire</button>
      <button type="button" onClick={() => setMode("calendar")}>Calendrier</button>
      <button type="button" onClick={() => setMode("training")}>Entrainement</button>
    </main>
  )
}));

vi.mock("./features/manage/components/Manage", () => ({
  default: ({ setMode }) => (
    <main>
      <h1>Gestionnaire</h1>
      <button type="button" onClick={() => setMode("settings")}>Reglages</button>
    </main>
  )
}));

vi.mock("./features/settings/components/Settings", () => ({
  default: () => <main><h1>Reglages</h1></main>
}));

vi.mock("./features/calendar/components/ReviewCalendar", () => ({
  default: () => <main><h1>Calendrier</h1></main>
}));

vi.mock("./features/review/components/ReviewSession", () => ({
  default: () => <main><h1>Review</h1></main>
}));

vi.mock("./features/training/components/TrainingSession", () => ({
  default: ({ initialMode, initialScope, onOpenStudy }) => (
    <main>
      <h1>Entrainement</h1>
      <div data-testid="training-target">
        {initialScope ? `${initialScope.type}:${initialScope.id}:${initialMode || ""}` : "none"}
      </div>
      <button
        type="button"
        onClick={() => onOpenStudy({
          type: "group",
          id: 5,
          name: "Europe",
          type_group: "map"
        })}
      >
        Study Europe
      </button>
    </main>
  )
}));

vi.mock("./features/study/components/StudyScreen", () => ({
  default: ({ onStartTraining, scope }) => (
    <main>
      <h1>Study {scope?.name}</h1>
      <button
        type="button"
        onClick={() => onStartTraining(scope, "multiple_choice")}
      >
        Start scoped training
      </button>
    </main>
  )
}));

vi.mock("./features/profile/components/Profile", () => ({
  default: () => <main><h1>Profil</h1></main>
}));

vi.mock("./features/packs/components/BrowsePacks", () => ({
  default: () => <main><h1>Packs</h1></main>
}));

afterEach(() => {
  cleanup();
});

describe("App mouse navigation", () => {
  it("uses mouse buttons 4 and 5 to go back and forward through app routes", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Gestionnaire" }));
    expect(screen.getByRole("heading", { name: "Gestionnaire" })).toBeInTheDocument();

    fireEvent.mouseDown(window, { button: 3 });
    expect(screen.getByRole("heading", { name: "Menu" })).toBeInTheDocument();

    fireEvent.mouseDown(window, { button: 4 });
    expect(screen.getByRole("heading", { name: "Gestionnaire" })).toBeInTheDocument();
  });

  it("clears the forward stack after a new route is opened", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Gestionnaire" }));
    fireEvent.click(screen.getByRole("button", { name: "Reglages" }));
    expect(screen.getByRole("heading", { name: "Reglages" })).toBeInTheDocument();

    fireEvent.mouseDown(window, { button: 3 });
    expect(screen.getByRole("heading", { name: "Gestionnaire" })).toBeInTheDocument();

    fireEvent.mouseDown(window, { button: 3 });
    expect(screen.getByRole("heading", { name: "Menu" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Calendrier" }));
    expect(screen.getByRole("heading", { name: "Calendrier" })).toBeInTheDocument();

    fireEvent.mouseDown(window, { button: 4 });
    expect(screen.getByRole("heading", { name: "Calendrier" })).toBeInTheDocument();
  });

  it("opens Study from a feature and can launch scoped training", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Entrainement" }));
    fireEvent.click(screen.getByRole("button", { name: "Study Europe" }));

    expect(screen.getByRole("heading", { name: "Study Europe" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start scoped training" }));

    expect(screen.getByRole("heading", { name: "Entrainement" })).toBeInTheDocument();
    expect(screen.getByTestId("training-target")).toHaveTextContent(
      "group:5:multiple_choice"
    );
  });
});
