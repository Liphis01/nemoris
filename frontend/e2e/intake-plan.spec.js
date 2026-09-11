import { expect, test } from "@playwright/test";
import { mockApi } from "./apiMock";


function deck(key, name, position, section, extra = {}) {
  return {
    key,
    group_id: position,
    name,
    type_group: "text",
    paused: false,
    section,
    position,
    counts: { unseen: 10, suspended: 0 },
    today_count: section === "focus" ? 2 : 0,
    eta: { starts: section === "focus" ? "today" : "months", finishes: "month" },
    ...extra
  };
}


const intakePlan = {
  revision: 1,
  settings: { focus: 2, new_decks: "end" },
  counts: { waiting: 30, paused: 0, suspended: 0, decks: 3, paused_decks: 0 },
  today: {
    quota: 4,
    count: 4,
    by_deck: [
      { key: "group:a", count: 2 },
      { key: "group:b", count: 2 }
    ],
    breakdown: null
  },
  decks: [
    deck("group:a", "Pokemons 1g", 1, "focus"),
    deck("group:b", "Biais cognitifs", 2, "focus"),
    deck("group:c", "Préfectures de France", 3, "next")
  ]
};


test("the new-question plan reorders decks from Manage", async ({ page }) => {
  const state = await mockApi(page, { intakePlan });

  await page.goto("/");
  await page.getByText("Gestionnaire").click();

  const entry = page.getByRole("button", { name: /File des nouvelles/ });
  await expect(entry).toContainText("Pokemons 1g, Biais cognitifs");
  await entry.click();

  const dialog = page.getByRole("dialog", { name: "File des nouvelles" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Ensuite" })).toContainText("Préfectures de France");

  // Keyboard move: Préfectures joins the focus window in second place.
  await dialog.getByRole("button", { name: /^Préfectures de France,/ }).focus();
  await page.keyboard.press("Alt+ArrowUp");

  await expect(dialog.getByRole("region", { name: "En cours" })).toContainText("Préfectures de France");
  await expect.poll(() => state.intakePlanActions.length).toBe(1);
  expect(state.intakePlanActions[0]).toEqual({
    base_revision: 1,
    actions: [{ type: "move", key: "group:c", to_index: 1 }]
  });

  // Escape closes and hands focus back to the entry that opened it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(entry).toBeFocused();
});
