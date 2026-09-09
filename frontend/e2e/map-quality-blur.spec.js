import { expect, test } from "@playwright/test";
import { mockApi } from "./apiMock.js";

// A zoomed map is drawn by CSS-scaling the SVG. Chromium rasterises that layer
// once for the whole length of a transform transition instead of re-rastering
// per frame, so *any* transition on it reads as the map going blurry and then
// snapping back — including one whose start and end frame the exact same view.
// Answering must therefore leave the transform completely untouched: the zone on
// screen is still the answered one until its grade is picked.

const mapSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
  <path data-code="alpha" d="M20 20h26v26H20z" />
  <path data-code="beta" d="M330 150h26v26H330z" />
</svg>`;

function zone(question_id, code, label) {
  return {
    question_id,
    code,
    label,
    aliases: [],
    progress: { interval: 0, history: [], reps: 0 },
    projected_intervals: { 0: 0, 1: 1, 2: 3, 3: 7 }
  };
}

const items = [zone(101, "alpha", "Alpha"), zone(102, "beta", "Beta")];
const labelByCode = Object.fromEntries(items.map(item => [item.code, item.label]));

const mapGroup = {
  group_id: 1,
  type_q: "map",
  name: "Carte de test",
  media: "/static/maps/test.svg",
  tags: [],
  mode: "type_prompt",
  context_items: items,
  items
};

// Reads the transform the map layer currently holds, and starts counting the
// transform transitions it runs from here on.
async function watchMapTransform(page) {
  return page.evaluate(() => {
    const layer = document.querySelector("svg").parentElement;

    window.__transitions = 0;
    layer.addEventListener("transitionstart", (event) => {
      if (event.propertyName === "transform") window.__transitions += 1;
    });

    return getComputedStyle(layer).transform;
  });
}

async function readMapTransform(page) {
  return page.evaluate(() => {
    const layer = document.querySelector("svg").parentElement;

    return {
      transform: getComputedStyle(layer).transform,
      transitions: window.__transitions
    };
  });
}

test("the map zoom stays untouched while the quality buttons appear", async ({ page }) => {
  await mockApi(page, { review: [mapGroup] });
  await page.route("**/*.svg", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: mapSvg
  }));
  await page.addInitScript(() => {
    window.localStorage.setItem("quizApp.mapReview.autoZoomEnabled", "true");
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Révision du jour/ }).click();

  const input = page.locator("[data-map-typed-input-area] input");
  await expect(input).toBeVisible();
  await expect(page.locator("svg [data-code]").first()).toBeVisible();

  // The prompted zone is the highlighted one; type_prompt shuffles which comes
  // first, so read it rather than assuming an order.
  const promptCode = await page.evaluate(() => {
    const hit = [...document.querySelectorAll("[data-code]")]
      .find((node) => getComputedStyle(node).fill === "rgb(243, 156, 18)");

    return hit?.getAttribute("data-code") || null;
  });
  expect(promptCode).toBeTruthy();

  // Let the opening auto-zoom finish before watching for further ones.
  await page.waitForTimeout(600);
  const zoomedIn = await watchMapTransform(page);
  expect(zoomedIn).not.toBe("none");

  await input.fill(labelByCode[promptCode]);
  await input.press("Enter");
  await expect(page.locator("[data-map-typed-rating]")).toBeVisible();
  await page.waitForTimeout(600);

  const withPanel = await readMapTransform(page);
  expect(withPanel.transitions).toBe(0);
  expect(withPanel.transform).toBe(zoomedIn);

  // Grading releases the prompt, and only then does the map travel to the next
  // zone — one transition, the zoom the user actually asked for.
  await input.press("2");
  await page.waitForTimeout(600);

  const afterGrade = await readMapTransform(page);
  expect(afterGrade.transitions).toBe(1);
  expect(afterGrade.transform).not.toBe(zoomedIn);
});
