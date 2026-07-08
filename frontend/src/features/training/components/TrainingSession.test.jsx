import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTrainingItems,
  gradeTrainingTimeline,
  listTrainingScopes,
  recordCollectionTrainingAttempt,
  recordGroupTrainingAttempt
} from "../../../api/training";
import {
  createCollection,
  deleteCollection,
  getCollection,
  listCollectionQuestionCandidates,
  listCollectionQuestions,
  updateCollection
} from "../../../api/collections";
import TrainingSession from "./TrainingSession";

vi.mock("../../../api/training", () => ({
  getTrainingItems: vi.fn(),
  gradeTrainingTimeline: vi.fn(),
  listTrainingScopes: vi.fn(),
  recordCollectionTrainingAttempt: vi.fn(),
  recordGroupTrainingAttempt: vi.fn()
}));

vi.mock("../../../api/collections", () => ({
  createCollection: vi.fn(),
  deleteCollection: vi.fn(),
  getCollection: vi.fn(),
  listCollectionQuestionCandidates: vi.fn(),
  listCollectionQuestions: vi.fn(),
  updateCollection: vi.fn()
}));


describe("TrainingSession", () => {
  beforeEach(() => {
    listTrainingScopes.mockResolvedValue({
      groups: [
        {
          id: 5,
          type_group: "map",
          name: "Europe",
          media: "europe.svg",
          tags: ["Geo"],
          question_count: 8,
          training_record: {
            best_found_percent: 100,
            best_found_count: 8,
            best_found_elapsed_ms: 92000,
            best_found_at: "2026-06-02T10:00:00+00:00",
            best_time_ms: 90000,
            best_time_at: "2026-06-02T10:00:00+00:00",
            question_count: 8
          },
          training_records: {
            type_all: {
              best_found_percent: 100,
              best_found_count: 8,
              best_found_elapsed_ms: 92000,
              best_found_at: "2026-06-02T10:00:00+00:00",
              best_time_ms: 90000,
              best_time_at: "2026-06-02T10:00:00+00:00",
              question_count: 8
            },
            click_prompt: {
              best_found_percent: 100,
              best_found_count: 8,
              best_found_elapsed_ms: 84000,
              best_found_at: "2026-06-02T10:00:00+00:00",
              best_time_ms: 84000,
              best_time_at: "2026-06-02T10:00:00+00:00",
              question_count: 8
            },
            type_prompt: {
              best_found_percent: 50,
              best_found_count: 4,
              best_found_elapsed_ms: 45000,
              best_found_at: "2026-06-02T10:00:00+00:00",
              question_count: 8
            }
          }
        },
        {
          id: 6,
          type_group: "media",
          name: "Flags",
          media: null,
          tags: ["Geo"],
          question_count: 5,
          training_records: {
            type_prompt: {
              best_found_percent: 100,
              best_found_count: 5,
              best_found_elapsed_ms: 31000,
              best_found_at: "2026-06-02T10:00:00+00:00",
              best_time_ms: 31000,
              best_time_at: "2026-06-02T10:00:00+00:00",
              question_count: 5
            },
            click_prompt: {
              best_found_percent: 50,
              best_found_count: 3,
              best_found_elapsed_ms: 35000,
              best_found_at: "2026-06-02T10:00:00+00:00",
              question_count: 5
            },
            multiple_choice_image: {
              best_found_percent: 100,
              best_found_count: 5,
              best_found_elapsed_ms: 30000,
              best_found_at: "2026-06-02T10:00:00+00:00",
              best_time_ms: 30000,
              best_time_at: "2026-06-02T10:00:00+00:00",
              question_count: 5
            }
          }
        }
      ],
      collections: [
        {
          id: 8,
          name: "Questions difficiles",
          question_count: 1,
          generated: true,
          auto_collection_key: "hard_questions",
          training_record: null
        },
        {
          id: 9,
          name: "Capitales",
          question_count: 2,
          generated: false,
          auto_collection_key: null,
          training_record: {
            best_found_percent: 50,
            best_found_count: 1,
            best_found_elapsed_ms: 45000,
            best_found_at: "2026-06-02T10:00:00+00:00",
            best_time_ms: 45000,
            best_time_at: "2026-06-02T10:00:00+00:00",
            question_count: 2
          }
        }
      ],
      tags: [
        {
          name: "Geo",
          count: 13
        }
      ]
    });
    getTrainingItems.mockResolvedValue([]);
    gradeTrainingTimeline.mockResolvedValue({ status: "ok", results: [] });
    recordGroupTrainingAttempt.mockResolvedValue({});
    recordCollectionTrainingAttempt.mockResolvedValue({});
    listCollectionQuestionCandidates.mockResolvedValue({
      items: [
        {
          id: 1,
          type_q: "text",
          group_id: null,
          title: "Capitale de la France",
          question: "Capitale de la France",
          answer_preview: "Paris",
          tags: ["Geo"],
          has_media: false,
          group: null
        },
        {
          id: 2,
          type_q: "map",
          group_id: 5,
          title: "France",
          question: "Zone",
          answer_preview: "France",
          tags: ["Geo"],
          has_media: false,
          group: {
            id: 5,
            name: "Europe",
            type_group: "map"
          }
        }
      ],
      total: 2,
      limit: 50,
      offset: 0
    });
    listCollectionQuestions.mockResolvedValue([
      {
        id: 1,
        type_q: "text",
        group_id: null,
        title: "Capitale de la France",
        question: "Capitale de la France",
        answer_preview: "Paris",
        tags: ["Geo"],
        has_media: false,
        group: null
      }
    ]);
    getCollection.mockResolvedValue({
      id: 9,
      name: "Capitales",
      question_ids: [1],
      question_count: 1
    });
    createCollection.mockResolvedValue({
      id: 10,
      name: "Nouveau",
      question_ids: [1],
      question_count: 1
    });
    updateCollection.mockResolvedValue({
      id: 9,
      name: "Capitales bis",
      question_ids: [1, 2],
      question_count: 2
    });
    deleteCollection.mockResolvedValue({ status: "deleted" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows aggregate group score and keeps time on mode rows", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    const europeTile = await screen.findByRole("button", { name: "Sélectionner Europe" });
    const flagsTile = await screen.findByRole("button", { name: "Sélectionner Flags" });

    expect(screen.getByText("Score total")).toBeInTheDocument();
    expect(screen.queryByText("Score par défaut")).not.toBeInTheDocument();
    expect(screen.queryByText("Temps parfait")).not.toBeInTheDocument();
    expect(within(europeTile).getByText("63%")).toBeInTheDocument();
    expect(within(flagsTile).getByText("50%")).toBeInTheDocument();
    expect(flagsTile.querySelector(".training-total-score-bar span"))
      .toHaveStyle({ width: "50%" });
    expect(screen.getAllByText("1:30").length).toBeGreaterThanOrEqual(1);
  });

  it("opens side-panel mode lists for map and image groups", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sélectionner Europe" }));

    expect(screen.getByText("Modes d'entrainement")).toBeInTheDocument();
    expect(screen.getByText("Tape toutes les zones dans l'ordre que tu veux.")).toBeInTheDocument();
    expect(screen.getByText("Regarde la zone surlignée, puis choisis le nom.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sélectionner Flags" }));

    expect(screen.getByText("Tape tous les médias dans l'ordre que tu veux.")).toBeInTheDocument();
    expect(screen.getByText("Lis le nom, puis choisis le bon média.")).toBeInTheDocument();
  });

  it("starts a selected group mode from the detail panel", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sélectionner Europe" }));
    fireEvent.click(screen.getByRole("button", { name: "Démarrer QCM pour Europe" }));

    await waitFor(() => {
      expect(getTrainingItems).toHaveBeenCalledWith({
        scopeType: "group",
        groupId: 5,
        mapMode: "multiple_choice"
      });
    });
  });

  it("keeps the selected group when returning from a training mode", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sélectionner Flags" }));
    fireEvent.click(screen.getByRole("button", { name: "Démarrer Nommer pour Flags" }));

    await waitFor(() => {
      expect(getTrainingItems).toHaveBeenCalledWith({
        scopeType: "group",
        groupId: 6,
        imageMode: "type_prompt"
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /Retour/ }));

    const flagsTile = await screen.findByRole("button", { name: "Sélectionner Flags" });
    const europeTile = screen.getByRole("button", { name: "Sélectionner Europe" });

    expect(flagsTile).toHaveAttribute("aria-pressed", "true");
    expect(europeTile).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "Flags" })).toBeInTheDocument();
  });

  it("uses the compact visual shell for active image training", async () => {
    getTrainingItems.mockResolvedValueOnce([
      {
        type_q: "media",
        name: "Flags",
        mode: "type_prompt",
        tags: ["Geo"],
        items: [
          {
            question_id: 11,
            answer: "France",
            label: "France",
            media: "/static/france.png"
          }
        ]
      }
    ]);

    const { container } = render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sélectionner Flags" }));
    fireEvent.click(screen.getByRole("button", { name: "Démarrer Nommer pour Flags" }));

    await waitFor(() => {
      expect(container.querySelector("[data-visual-session-shell]"))
        .toBeInTheDocument();
    });

    const shell = container.querySelector("[data-visual-session-shell]");
    const bar = container.querySelector("[data-visual-session-bar]");
    const actions = container.querySelector("[data-visual-session-actions]");
    const status = container.querySelector("[data-visual-session-status]");
    const secondary = container.querySelector("[data-visual-session-secondary]");
    const renderer = container.querySelector("[data-visual-renderer]");
    const imageHeader = container.querySelector("[data-image-review-header]");

    expect(getTrainingItems).toHaveBeenCalledWith({
      scopeType: "group",
      groupId: 6,
      imageMode: "type_prompt"
    });
    expect(shell).toHaveStyle({
      height: "calc(100dvh - 48px)",
      overflow: "hidden"
    });
    expect(bar).toHaveStyle({
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 520px) minmax(0, 1fr)",
      minHeight: "72px"
    });
    expect(renderer).toHaveStyle({
      overflow: "hidden",
      minHeight: "0"
    });
    expect(renderer.style.flex).toBe("1 1 0%");
    expect(actions).toContainElement(screen.getByRole("button", { name: /Retour/ }));
    expect(screen.queryByRole("button", { name: "Changer" })).not.toBeInTheDocument();
    expect(status).toHaveTextContent("Training");
    expect(status).toHaveTextContent("Flags");
    expect(status).toHaveTextContent("Question 1 / 1");
    expect(status).toHaveTextContent("#Geo");
    expect(secondary.querySelector('[data-training-timer-panel="prominent"]'))
      .toBeInTheDocument();
    expect(secondary).toHaveTextContent("Temps");
    expect(secondary).toHaveTextContent("Meilleur");
    expect(secondary).toHaveTextContent("31s");
    expect(bar).not.toHaveTextContent("Nommer");
    expect(imageHeader).not.toHaveTextContent("IMAGE");
    expect(imageHeader).not.toHaveTextContent("Temps");
    expect(screen.queryByRole("heading", { name: "Flags" }))
      .not.toBeInTheDocument();
  });

  it("starts tag training directly from a compact tile", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Tags" }));
    fireEvent.click(screen.getByRole("button", { name: "Démarrer le tag Geo" }));

    await waitFor(() => {
      expect(getTrainingItems).toHaveBeenCalledWith({
        scopeType: "tag",
        tag: "Geo"
      });
    });
  });

  it("shows collections and starts selected collection training", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Collections" }));
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner Capitales" }));

    expect(screen.getByRole("heading", { name: "Capitales" })).toBeInTheDocument();
    expect(screen.getByText("45s")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Démarrer/ }));

    await waitFor(() => {
      expect(getTrainingItems).toHaveBeenCalledWith({
        scopeType: "collection",
        collectionId: 9
      });
    });
  });

  it("marks generated collections as automatic and read-only", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Collections" }));
    fireEvent.click(screen.getByRole("button", {
      name: "Sélectionner Questions difficiles"
    }));

    const detail = screen
      .getByRole("heading", { name: "Questions difficiles" })
      .closest("aside");

    expect(detail).toHaveTextContent("Générée automatiquement");
    expect(within(detail).queryByText("auto")).not.toBeInTheDocument();
    expect(within(detail).queryByText("collection")).not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Modifier" }))
      .not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Supprimer" }))
      .not.toBeInTheDocument();

    fireEvent.click(within(detail).getByRole("button", { name: /Démarrer/ }));

    await waitFor(() => {
      expect(getTrainingItems).toHaveBeenCalledWith({
        scopeType: "collection",
        collectionId: 8
      });
    });
  });

  it("creates and updates collections from the full-screen composer", async () => {
    render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Collections" }));
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle collection" }));

    expect(await screen.findByRole("heading", { name: "Nouvelle collection" }))
      .toBeInTheDocument();
    await waitFor(() => {
      expect(listCollectionQuestionCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 50,
          offset: 0,
          sort: "recent"
        }),
        expect.any(Object)
      );
    });

    fireEvent.change(await screen.findByLabelText("Nom de la collection"), {
      target: { value: "Nouveau" }
    });
    expect(screen.queryByLabelText("Sélectionner Capitale de la France"))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Déplier Sans groupe" }));
    fireEvent.click(await screen.findByLabelText("Sélectionner Capitale de la France"));

    const availableQuestions = screen.getByLabelText("Questions disponibles");
    const visibleEuropeSection = within(availableQuestions)
      .getByText("Europe")
      .closest("section");
    fireEvent.click(within(visibleEuropeSection).getByRole("button", {
      name: "Ajouter le groupe visible"
    }));
    const tray = screen.getByLabelText("Questions sélectionnées");
    const trayEuropeSection = within(tray).getByText("Europe").closest("section");
    fireEvent.click(within(trayEuropeSection).getByRole("button", {
      name: "Retirer le groupe"
    }));

    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      expect(createCollection).toHaveBeenCalledWith({
        name: "Nouveau",
        question_ids: [1]
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Collections" }));
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner Capitales" }));
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }));

    await waitFor(() => {
      expect(getCollection).toHaveBeenCalledWith(9);
    });
    expect(listCollectionQuestions).toHaveBeenCalledWith(9);

    fireEvent.change(screen.getByLabelText("Nom de la collection"), {
      target: { value: "Capitales bis" }
    });
    fireEvent.change(screen.getByLabelText("Rechercher une question"), {
      target: { value: "France" }
    });
    await waitFor(() => {
      expect(listCollectionQuestionCandidates).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: "France"
        }),
        expect.any(Object)
      );
    });
    // The active search filter auto-expands the "Europe" section, so the
    // "Sélectionner France" control is already revealed without a manual expand.
    fireEvent.click(await screen.findByLabelText("Sélectionner France"));
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      expect(updateCollection).toHaveBeenCalledWith(9, {
        name: "Capitales bis",
        question_ids: [1, 2]
      });
    });
  });

  it("deletes collections from the detail panel", async () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockReturnValue(true);

    render(<TrainingSession setMode={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Collections" }));
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner Capitales" }));
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() => {
      expect(deleteCollection).toHaveBeenCalledWith(9);
    });
    expect(confirmSpy).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});
