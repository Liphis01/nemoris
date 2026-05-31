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
    {
      question_id: 1,
      quality: 2
    }
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

  await expect(page.getByText("Résultat")).toBeVisible();
  await expect(page.getByText("réussite", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Valider" }).click();

  await expect(page.getByText("Session terminée")).toBeVisible();
  expect(state.mapAnswerRequests).toEqual([
    {
      items: {
        10: 2
      }
    }
  ]);
});

test("timeline quick input creates a normalized timeline question", async ({ page }) => {
  const state = await mockApi(page);

  await page.goto("/");
  await page.getByText("Gestionnaire").click();

  await page.getByRole("button", { name: /Nouvelle question/ }).click();
  await page.getByRole("button", { name: /Événement timeline/ }).click();
  await page.getByRole("textbox", { name: "Question", exact: true }).fill("Assassinat de César");
  await page.getByPlaceholder(/1914/).fill("44 av. J.-C.");
  await page.getByRole("button", { name: "Appliquer" }).click();

  await expect(page.getByLabel("Réponse générée")).toHaveValue("44 av. J.-C.");

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
