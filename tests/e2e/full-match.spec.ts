import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Point } from "../../src/sim/settlement";
import { Simulation } from "../../src/sim/simulation";

async function activateTile(
  page: Page,
  tile: Point,
  cursor: Point,
): Promise<void> {
  await page.getByTestId("world-canvas").focus();
  while (cursor.x !== tile.x || cursor.y !== tile.y) {
    if (cursor.x < tile.x) {
      await page.keyboard.press("d");
      cursor.x += 1;
    } else if (cursor.x > tile.x) {
      await page.keyboard.press("a");
      cursor.x -= 1;
    }
    if (cursor.y < tile.y) {
      await page.keyboard.press("s");
      cursor.y += 1;
    } else if (cursor.y > tile.y) {
      await page.keyboard.press("w");
      cursor.y -= 1;
    }
  }
  await page.keyboard.press("Enter");
}

test("a real production match finishes and restarts", async ({ page }) => {
  test.skip(
    test.info().project.name !== "desktop-chromium",
    "Long production-match verification",
  );
  test.setTimeout(900000);
  const simulation = new Simulation(0x47_4f_44, "skirmish");
  let sequence = 0;
  const initialTime = Date.now();
  await page.clock.install({ time: initialTime });
  await page.clock.pauseAt(initialTime);
  await page.goto("/?seed=474F44");
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await page.clock.runFor(50);
  const cursorTile = { x: 32, y: 32 };

  for (let tick = 0; tick <= 30000; tick += 300) {
    const snapshot = simulation.snapshot();
    if (snapshot.matchStatus !== "playing") break;
    const target = snapshot.settlement.followers
      .slice()
      .sort(
        (first, second) =>
          (snapshot.terrain.heights[
            first.y * snapshot.terrain.size + first.x
          ] ?? 0) -
            (snapshot.terrain.heights[
              second.y * snapshot.terrain.size + second.x
            ] ?? 0) || first.id - second.id,
      )[0];
    const type = snapshot.settlement.mana >= 50 ? "flood" : "earthquake";
    const cost = type === "flood" ? 50 : 30;
    let executedCommand = false;
    if (snapshot.settlement.mana >= cost && target) {
      const name = type === "flood" ? "Flood" : "Earthquake";
      await page.getByRole("button", { name, exact: true }).click();
      await activateTile(page, target, cursorTile);
      cursorTile.x = target.x;
      cursorTile.y = target.y;
      await page.clock.runFor(50);
      await expect(page.locator("#selection-status")).toContainText(
        `${name} gathering`,
      );
      simulation.queue({
        tick,
        sequence: sequence++,
        type,
        faction: "player",
        x: target.x,
        y: target.y,
      });
      simulation.advanceTo(tick + 1);
      executedCommand = true;
    }
    await page.clock.runFor(executedCommand ? 14950 : 15000);
    simulation.advanceTo(tick + 300);
    if (await page.locator("#outcome-panel").isVisible()) break;
  }

  expect(simulation.snapshot().matchStatus).toBe("defeat");
  await expect(page.locator("#outcome-panel")).toBeVisible();
  await expect(page.locator("#outcome-text")).toContainText("Defeat");
  await page.getByTestId("restart").click();
  await expect(page.locator("#outcome-panel")).toBeHidden();
  await expect(page.getByTestId("population-count")).toHaveText("6");
  await expect(page.getByTestId("opponent-population")).toHaveText("6");
  await expect(page.getByTestId("house-count")).toHaveText("0");
  await expect(page.getByTestId("opponent-houses")).toHaveText("0");
});
