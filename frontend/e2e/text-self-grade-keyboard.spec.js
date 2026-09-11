import { expect, test } from "@playwright/test";
import { mockApi } from "./apiMock.js";

// Only a real (trusted) keystroke reproduces this: React flushes the reveal in
// a microtask between listeners, so a window listener re-armed by that reveal
// can still receive the very Enter that caused it. jsdom's script-dispatched
// events never leave that gap, which is why this lives in e2e.

function textItem(question_id, question, answer) {
  return {
    question_id,
    question,
    answer,
    aliases: [],
    type_q: "text",
    progress: { interval: 0, history: [], reps: 0 },
    projected_intervals: { 0: 0, 1: 1, 2: 3, 3: 7 }
  };
}

const items = [
  textItem(301, "Capitale de la France", "Paris"),
  textItem(302, "Capitale de l'Italie", "Rome"),
  textItem(303, "Capitale de l'Espagne", "Madrid")
];

const textGroup = {
  group_id: 7,
  type_q: "text",
  name: "Capitales",
  tags: [],
  mode: "type_all",
  context_items: items,
  items
};

// The unshifted AZERTY top row: the character differs from the digit, only
// the physical key code says which grade it is.
const azertyKeys = { 1: "&", 2: "é", 3: "\"" };

async function pressAzertyDigit(cdp, digit) {
  const key = azertyKeys[digit];
  const base = {
    key,
    code: `Digit${digit}`,
    windowsVirtualKeyCode: 48 + digit,
    nativeVirtualKeyCode: 48 + digit
  };

  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: key, unmodifiedText: key });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

test("self-graded text keeps each keyboard grade through to the recap", async ({ page }) => {
  await mockApi(page, { review: [textGroup] });
  const cdp = await page.context().newCDPSession(page);

  await page.goto("/");
  await page.getByRole("button", { name: /Révision du jour/ }).click();

  const card = page.locator("[data-text-self-grade-card]");
  const grades = [1, 3, 1];

  for (const [index, item] of items.entries()) {
    await expect(card).toContainText(item.question);

    const input = page.getByLabel("Réponse facultative");
    await input.fill(item.answer);
    await input.press("Enter");

    // Revealing must only reveal: the grade stays the learner's to pick, well
    // past the pick-hold that an accidental default grade would run.
    await expect(page.locator("[data-text-self-grade-rating]")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(card).toContainText(item.question);
    await expect(page.locator("[data-text-self-grade-quality][aria-pressed='true']"))
      .toHaveCount(0);

    await pressAzertyDigit(cdp, grades[index]);

    if (index < items.length - 1) {
      await expect(card).toContainText(items[index + 1].question);
    }
  }

  const rows = page.locator("[data-text-recap-row]");
  await expect(rows).toHaveCount(items.length);

  for (const [index, grade] of grades.entries()) {
    await expect(rows.nth(index).locator("[data-text-recap-quality][aria-pressed='true']"))
      .toHaveAttribute("data-text-recap-quality", String(grade));
  }
});
