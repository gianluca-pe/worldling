import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  createCornerHeights,
  projectTile,
  surfaceCenter,
  surfaceQuad,
} from "../../src/render/isometric";
import { createSkirmishSettlements } from "../../src/sim/skirmish";
import { generateIsland, WATER_LEVEL } from "../../src/sim/terrain";
import type { Point } from "../../src/sim/settlement";

async function clickTile(page: Page, tile: Point): Promise<void> {
  const terrain = generateIsland(0x47_4f_44);
  const starts = createSkirmishSettlements(terrain);
  const point = surfaceCenter(
    surfaceQuad(tile.x, tile.y, terrain.size, createCornerHeights(terrain)),
  );
  const origin = projectTile(
    starts.player.banner.x,
    starts.player.banner.y,
    WATER_LEVEL,
  );
  const bounds = await page.getByTestId("world-canvas").boundingBox();
  if (!bounds) throw new Error("Canvas has no bounds");
  const target = {
    x: bounds.x + bounds.width / 2 + (point.x - origin.x) * 0.42,
    y: bounds.y + bounds.height / 2 + (point.y - origin.y) * 0.42,
  };
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const delta = { x: target.x - center.x, y: target.y - center.y };
  if (Math.abs(delta.x) > 0.01 || Math.abs(delta.y) > 0.01) {
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x - delta.x, center.y - delta.y, { steps: 8 });
    await page.mouse.up();
  }
  await page.mouse.click(center.x, center.y);
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("worldling.guide-dismissed.v1", "1");
    } catch {
      // Ignore storage denial on auxiliary navigation documents.
    }
  });
  if (testInfo.title === "starts two factions with equal opening resources") {
    const initialTime = Date.now();
    await page.clock.install({ time: initialTime });
    await page.clock.pauseAt(initialTime);
  }
  await page.goto("/?seed=474F44");
  await expect(page.getByTestId("world-canvas")).toBeVisible();
});

test("starts two factions with equal opening resources", async ({ page }) => {
  await expect(page.locator(".faction-key .player")).toHaveText("You: blue");
  await expect(page.locator(".faction-key .rival")).toHaveText("Rival: red");
  await expect(page.getByTestId("population-count")).toHaveText("6");
  await expect(page.getByTestId("opponent-population")).toHaveText("6");
  await expect(page.getByTestId("mana-count")).toHaveText("30");
  await expect(page.getByTestId("house-count")).toHaveText("0");
  await expect(page.getByTestId("opponent-houses")).toHaveText("0");
});

test("pause stops the simulation and resume continues it", async ({ page }) => {
  await page.getByTestId("pause").click();
  await expect(page.getByTestId("pause")).toHaveText("Resume");
  const mana = await page.getByTestId("mana-count").textContent();
  const houses = await page.getByTestId("house-count").textContent();
  await page.waitForTimeout(500);
  await expect(page.getByTestId("mana-count")).toHaveText(mana ?? "");
  await expect(page.getByTestId("house-count")).toHaveText(houses ?? "");
  await expect(
    page.getByRole("button", { name: "Raise", exact: true }),
  ).toBeDisabled();

  await page.getByTestId("pause").click();
  await expect(page.getByTestId("pause")).toHaveText("Pause");
  await expect(page.getByTestId("house-count")).not.toHaveText("0", {
    timeout: 6000,
  });
});

test("pause and resume preserve the keyboard tile cursor", async ({ page }) => {
  const canvas = page.getByTestId("world-canvas");
  await canvas.focus();
  await page.keyboard.press("2");
  await page.keyboard.press("d");
  await expect(page.locator("#selection-status")).toContainText(
    "Cursor 33, 32",
  );
  await page.getByTestId("pause").click();
  await page.getByTestId("pause").click();
  await canvas.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#selection-status")).toContainText(
    "Tile 33, 32 · height",
  );
});

test("earthquake targeting shows a telegraph and then resolves", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Earthquake", exact: true }).click();
  await clickTile(page, { x: 32, y: 32 });
  await expect(page.locator("#selection-status")).toContainText(
    "Earthquake gathering at 32, 32",
  );
  await expect(page.getByTestId("settlement-hint")).toContainText("earthquake");
  await expect(page.getByTestId("settlement-hint")).toContainText(
    "Your earthquake at 32,32",
  );
  await expect(page.getByTestId("settlement-hint")).not.toContainText(
    "Your earthquake",
    { timeout: 7000 },
  );
});

test("flood rejection explains insufficient mana", async ({ page }) => {
  await page.getByRole("button", { name: "Flood", exact: true }).click();
  await clickTile(page, { x: 32, y: 32 });
  await expect(page.locator("#selection-status")).toContainText(
    "Not enough mana",
  );
});

test("restart resets both factions and match controls", async ({ page }) => {
  await expect(page.getByTestId("house-count")).not.toHaveText("0", {
    timeout: 6000,
  });
  await page.getByTestId("restart-match").click();
  await expect(page.getByTestId("population-count")).toHaveText("6");
  await expect(page.getByTestId("opponent-population")).toHaveText("6");
  await expect(page.getByTestId("house-count")).toHaveText("0");
  await expect(page.getByTestId("opponent-houses")).toHaveText("0");
  await expect(page.getByTestId("mana-count")).toHaveText("30");
  await expect(page.getByTestId("pause")).toHaveText("Pause");
  await expect(page.locator("#outcome-panel")).toBeHidden();
  await page.getByTestId("world-canvas").focus();
  await page.keyboard.press("d");
  await expect(page.locator("#selection-status")).toContainText(
    "Cursor 33, 32",
  );
});
