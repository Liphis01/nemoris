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

  // With no due questions left, the session offers bonus review before
  // returning to the menu; the mock has no bonus groups configured, so it's
  // immediately "done" and only needs the explicit return click.
  await expect(page.getByRole("heading", { name: "Bonus terminés" })).toBeVisible();
  await page.getByRole("button", { name: "Retour au menu" }).click();

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

  // With no due questions left, the session offers bonus review before
  // returning to the menu; the mock has no bonus groups configured, so it's
  // immediately "done" and only needs the explicit return click.
  await expect(page.getByRole("heading", { name: "Bonus terminés" })).toBeVisible();
  await page.getByRole("button", { name: "Retour au menu" }).click();

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

test("profil screen shows a sign-in prompt and lightweight stats when signed out", async ({ page }) => {
  await mockApi(page, {
    stats: {
      counts: { total: 5, due_total: 2, overdue: 0, due_today: 2, new: 1, mastered: 1 },
      retention_by_type: {
        text: { reviews: 4, success: 3, failed: 1, hard: 0, retention: 75 }
      }
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Profil", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Profil" })).toBeVisible();
  await expect(page.getByText("Non connecté")).toBeVisible();
  await expect(page.getByText("5", { exact: true })).toBeVisible();
  await expect(page.getByText("75%")).toBeVisible();

  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Paramètres" })).toBeVisible();
});

test("profil screen lets a signed-in user update their username and avatar", async ({ page }) => {
  const state = await mockApi(page, {
    syncStatus: { signed_in: true, account_email: "louis@example.com" },
    profile: { username: "Louis", avatar_emoji: "🙂", avatar_color: "violet" },
    stats: {
      counts: { total: 5, due_total: 2, overdue: 0, due_today: 2, new: 1, mastered: 1 },
      retention_by_type: {}
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Profil", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Profil" })).toBeVisible();
  await expect(page.getByText("Louis", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Avatar 🦊" }).click();
  await page.getByRole("button", { name: "Couleur teal" }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText("Profil enregistré.")).toBeVisible();
  expect(state.profileUpdates).toEqual([
    {
      username: "Louis",
      avatar_emoji: "🦊",
      avatar_color: "teal"
    }
  ]);
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
