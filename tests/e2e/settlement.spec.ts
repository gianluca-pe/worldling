import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("worldling.guide-dismissed.v1", "1");
    } catch {
      // Ignore storage denial on auxiliary navigation documents.
    }
  });
  await page.goto("/?seed=474F44");
  await expect(page.getByTestId("world-canvas")).toBeVisible();
});

test("starts with followers and generates mana over time", async ({ page }) => {
  await expect(page.getByTestId("population-count")).toHaveText("6");
  await expect(page.getByTestId("house-count")).toHaveText("0");
  const initialMana = Number.parseInt(
    (await page.getByTestId("mana-count").textContent()) ?? "0",
    10,
  );
  await expect(page.getByTestId("mana-count")).not.toHaveText(
    String(initialMana),
    { timeout: 15000 },
  );
});

test("settlers visibly expand and explain the settlement state", async ({
  page,
}) => {
  await expect(page.getByTestId("settlement-hint")).toContainText("gathering");
  await expect
    .poll(
      async () =>
        Number.parseInt(
          (await page.getByTestId("house-count").textContent()) ?? "0",
          10,
        ),
      { timeout: 15000 },
    )
    .toBeGreaterThan(1);
  await expect(page.getByTestId("settlement-hint")).toContainText(
    /Houses full|Growing population/,
  );
  await expect(page.getByTestId("settlement-hint")).toBeVisible();
});

test("rally command gives visible feedback", async ({ page }) => {
  await page.getByRole("button", { name: "Rally", exact: true }).click();
  const bounds = await page.getByTestId("world-canvas").boundingBox();
  if (!bounds) throw new Error("Canvas has no bounds");
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await expect(page.locator("#selection-status")).toContainText(
    "Followers rallying to",
  );
});

test("terrain editing spends mana", async ({ page }) => {
  const before = Number.parseInt(
    (await page.getByTestId("mana-count").textContent()) ?? "0",
    10,
  );
  await page.getByRole("button", { name: "Raise", exact: true }).click();
  const bounds = await page.getByTestId("world-canvas").boundingBox();
  if (!bounds) throw new Error("Canvas has no bounds");
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await expect(page.getByTestId("edit-count")).toHaveText("1 edit");
  const after = Number.parseInt(
    (await page.getByTestId("mana-count").textContent()) ?? "0",
    10,
  );
  expect(after).toBeLessThan(before);
});
