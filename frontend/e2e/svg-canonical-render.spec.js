import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";


const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../.."
);
const fixtureRoot = path.join(
  repoRoot, "backend/tests/fixtures/map_import"
);


for (const name of [
  "clean_codes",
  "local_use",
  "simplemaps_duplicate_labels"
]) {
  test(`canonical ${name} keeps the supported source rendering`, async ({ page }) => {
    const [source, canonical] = await Promise.all([
      readFile(path.join(fixtureRoot, `${name}.svg`), "utf8"),
      readFile(
        path.join(fixtureRoot, "expected", `${name}.canonical.svg`),
        "utf8"
      )
    ]);

    await page.setContent(`
      <style>
        body { margin: 0; background: white }
        .fixture { width: 600px; height: 300px }
        svg { width: 100%; height: 100%; display: block }
      </style>
      <div class="fixture" id="source">${source}</div>
      <div class="fixture" id="canonical">${canonical}</div>
    `);

    const sourceScreenshot = await page.locator("#source").screenshot({
      animations: "disabled"
    });
    const canonicalScreenshot = await page.locator("#canonical").screenshot({
      animations: "disabled"
    });

    expect(canonicalScreenshot).toEqual(sourceScreenshot);
  });
}


test("canonical dimensions-only SVG gains a complete scalable viewport", async ({
  page
}) => {
  const [source, canonical] = await Promise.all([
    readFile(
      path.join(fixtureRoot, "dimensions_without_viewbox.svg"),
      "utf8"
    ),
    readFile(
      path.join(
        fixtureRoot,
        "expected",
        "dimensions_without_viewbox.canonical.svg"
      ),
      "utf8"
    )
  ]);

  expect(source).not.toContain("viewBox=");
  await page.setContent(`
    <style>
      body { margin: 0; background: white }
      #canonical { width: 600px; height: 300px }
      svg { width: 100%; height: 100%; display: block }
    </style>
    <div id="canonical">${canonical}</div>
  `);

  const viewport = await page.locator("#canonical svg").evaluate((svg) => {
    const bounds = Array.from(
      svg.querySelectorAll("[data-nemoris-shape]")
    ).map((shape) => {
      const box = shape.getBBox();
      return {
        left: box.x,
        top: box.y,
        right: box.x + box.width,
        bottom: box.y + box.height
      };
    });
    return {
      viewBox: svg.getAttribute("viewBox"),
      bounds
    };
  });

  expect(viewport.viewBox).toBe("0 0 569 392");
  expect(viewport.bounds).toHaveLength(2);
  for (const box of viewport.bounds) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(569);
    expect(box.bottom).toBeLessThanOrEqual(392);
  }
});
