import { expect, test } from "@playwright/test";
import { mockApi } from "./apiMock";

test("review session advances a text question", async ({ page }) => {
  const state = await mockApi(page, {
    review: [
      {
        question_id: 1,
        type_q: "text",
        question: "Capital test",
        answer: "Answer test",
        tags: ["geo"]
      }
    ]
  });

  await page.goto("/");
  await page.getByText("Révision du jour").click();

  await expect(page.getByText("Capital test")).toBeVisible();
  await page.getByRole("button", { name: "Voir la réponse" }).click();
  await expect(page.getByText("Answer test")).toBeVisible();

  await page.getByRole("button", { name: /Bon/ }).click();

  await expect(page.getByText("Session terminée")).toBeVisible();
  expect(state.answerRequests).toEqual([
    expect.objectContaining({
      question_id: 1,
      quality: 2,
      review_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    })
  ]);
});

test("map recap sends per-zone quality", async ({ page }) => {
  const state = await mockApi(page, {
    review: [
      {
        type_q: "map",
        name: "Carte monde",
        media: "world.svg",
        items: [
          {
            question_id: 10,
            code: "FR",
            label: "France",
            aliases: ["france"],
            progress: { reps: 0 },
            projected_intervals: {
              0: 0,
              1: 1,
              2: 4,
              3: 8
            }
          }
        ]
      }
    ]
  });

  await page.goto("/");
  await page.getByText("Révision du jour").click();

  await page.getByPlaceholder("Tape une zone...").fill("France");
  await page.keyboard.press("Enter");

  await expect(page.getByText("MAP RESULT")).toBeVisible();
  await expect(page.getByText("réussite", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Valider" }).click();

  await expect(page.getByText("Session terminée")).toBeVisible();
  expect(state.mapAnswerRequests).toEqual([
    expect.objectContaining({
      mode: "type_all",
      items: {
        10: 2
      },
      review_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    })
  ]);
});

test("timeline quick input creates a normalized timeline question", async ({ page }) => {
  const state = await mockApi(page);

  await page.goto("/");
  await page.getByText("Gestionnaire").click();

  await page.getByRole("button", { name: /Nouvelle question/ }).click();
  await page.getByRole("button", { name: /Événement timeline/ }).click();
  await page.getByRole("textbox", { name: "Question", exact: true }).fill("Assassinat de César");
  // Type the magnitude, then flip the era with the pretty toggle.
  await page.getByLabel("Date", { exact: true }).fill("44");
  await page.getByRole("button", { name: /Basculer l'ère/ }).click();

  // The live preview echoes the formatted, era-applied answer.
  await expect(page.getByText("44 av. J.-C.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Créer" }).click();
  await expect.poll(() => state.createdQuestions.length).toBe(1);
  expect(state.createdQuestions[0]).toMatchObject({
    question: "Assassinat de César",
    answer: "44 av. J.-C.",
    type_q: "timeline",
    group_id: null,
    data: {
      timeline: {
        kind: "point",
        start: {
          year: -44,
          month: null,
          day: null,
          precision: "year"
        }
      }
    }
  });
});

test("Manage autosaves dirty question edits before selection changes", async ({ page }) => {
  const state = await mockApi(page, {
    questions: [
      {
        id: 1,
        type_q: "text",
        question: "Original prompt",
        answer: "Original answer",
        tags: [],
        media: null,
        data: {},
        progress: null
      },
      {
        id: 2,
        type_q: "text",
        question: "Second prompt",
        answer: "Second answer",
        tags: [],
        media: null,
        data: {},
        progress: null
      }
    ]
  });

  await page.goto("/");
  await page.getByText("Gestionnaire").click();

  await page.getByText("Original prompt").click();
  await page.getByRole("textbox", { name: "Question", exact: true }).fill("Edited prompt");
  await page.getByText("Second prompt").click();

  await expect.poll(() => state.questionUpdates.length).toBe(1);
  expect(state.questionUpdates[0]).toMatchObject({
    id: 1,
    payload: {
      question: "Edited prompt",
      answer: "Original answer",
      media: null,
      type_q: "text",
      tags: [],
      data: {}
    }
  });
  await expect(page.getByText("Enregistré")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Question", exact: true })).toHaveValue("Second prompt");
});

test("stats screen shows metrics, toggles favorites, and opens Manage", async ({ page }) => {
  const loadByType = Array.from({ length: 30 }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    total: index === 0 ? 3 : 0,
    types: {
      text: index === 0 ? 2 : 0,
      map: index === 0 ? 1 : 0,
      timeline: 0
    }
  }));
  const hardQuestion = {
    id: 1,
    type_q: "text",
    question: "Hard prompt",
    answer: "Hard answer",
    tags: [],
    media: null,
    data: { source: "stats" },
    group_id: null,
    group: null,
    favorite: false,
    reviews: 3,
    success_count: 1,
    failed_count: 2,
    hard_count: 0,
    retention: 33,
    difficulty: 8,
    lapses: 2,
    reps: 3,
    last_review: "2026-01-01",
    next_review: "2026-01-01"
  };
  const mapQuestion = {
    id: 2,
    type_q: "map",
    question: "Europe - FR",
    answer: "France",
    tags: [],
    media: null,
    data: { code: "FR", aliases: ["France"] },
    group_id: 7,
    group: {
      id: 7,
      name: "Europe",
      type_group: "map"
    },
    favorite: false,
    reviews: 2,
    success_count: 1,
    failed_count: 1,
    hard_count: 0,
    retention: 50,
    difficulty: 6,
    lapses: 1,
    reps: 2,
    last_review: "2026-01-01",
    next_review: "2026-01-03"
  };
  const state = await mockApi(page, {
    questions: [
      {
        id: 1,
        type_q: "text",
        question: "Hard prompt",
        answer: "Hard answer",
        tags: [],
        media: null,
        data: { source: "stats" },
        progress: {
          next_review: "2026-01-01",
          reps: 3,
          lapses: 2,
          history: []
        }
      }
    ],
    stats: {
      generated_on: "2026-01-01",
      windows: {
        load_days: 30,
        retention_days: 90,
        retention_start: "2025-10-04"
      },
      counts: {
        total: 2,
        due_total: 3,
        overdue: 1,
        due_today: 2,
        new: 1,
        by_type: {
          text: { total: 1, due: 2, overdue: 1, due_today: 1, new: 0 },
          map: { total: 1, due: 1, overdue: 0, due_today: 1, new: 1 },
          timeline: { total: 0, due: 0, overdue: 0, due_today: 0, new: 0 }
        }
      },
      load_by_type: loadByType,
      retention_by_type: {
        text: { reviews: 3, success: 1, failed: 2, hard: 0, retention: 33 },
        map: { reviews: 2, success: 1, failed: 1, hard: 0, retention: 50 },
        timeline: { reviews: 0, success: 0, failed: 0, hard: 0, retention: null }
      },
      hard_questions: [hardQuestion],
      favorite_questions: [],
      weak_spots: {
        map: [mapQuestion],
        timeline: []
      }
    }
  });

  await page.goto("/");
  await page.getByText("Statistiques").click();

  await expect(page.getByRole("heading", { name: "Statistiques" })).toBeVisible();
  await expect(page.getByText("Questions difficiles")).toBeVisible();
  await expect(page.getByText("Hard prompt")).toBeVisible();

  await page.getByRole("button", { name: "Ajouter aux favoris" }).first().click();
  await expect.poll(() => state.questionUpdates.length).toBe(1);
  expect(state.questionUpdates[0]).toMatchObject({
    id: 1,
    payload: {
      data: {
        source: "stats",
        favorite: true
      }
    }
  });

  await page.getByText("Hard prompt").click();
  await expect(page.getByRole("textbox", { name: "Question", exact: true })).toHaveValue("Hard prompt");
});

test("group deletion removes grouped questions from the Manage cache", async ({ page }) => {
  const state = await mockApi(page, {
    groups: [
      {
        id: 7,
        name: "Europe map",
        type_group: "map",
        media: "world.svg",
        question_count: 1
      },
      {
        id: 8,
        name: "Other map",
        type_group: "map",
        media: "world.svg",
        question_count: 1
      }
    ],
    questions: [
      {
        id: 20,
        type_q: "map",
        question: "France zone",
        answer: "France",
        group_id: 7,
        group: {
          id: 7,
          name: "Europe map",
          type_group: "map"
        },
        tags: [],
        data: { code: "FR" },
        progress: null
      },
      {
        id: 21,
        type_q: "text",
        question: "Loose question",
        answer: "Loose answer",
        tags: [],
        data: {},
        progress: null
      }
    ]
  });

  await page.goto("/");
  await page.getByText("Gestionnaire").click();
  await page.getByRole("button", { name: /Groupes/ }).click();

  await expect(page.locator('[data-manage-group-id="7"]')).toBeVisible();
  await page.locator('[data-manage-group-id="7"]').click({ button: "right" });
  await page.locator('[data-manage-group-id="7"] button').click();

  await expect.poll(() => state.deletedGroupIds).toEqual([7]);
  await expect(page.getByText("Europe map")).toHaveCount(0);
  await expect(page.getByText("Other map")).toBeVisible();

  await page.getByRole("button", { name: /Questions/ }).click();

  await expect(page.getByText("Loose question")).toBeVisible();
  await expect(page.getByText("France zone")).toHaveCount(0);
});
