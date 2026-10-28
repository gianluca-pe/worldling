import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  createCornerHeights,
  projectTile,
  surfaceCenter,
  surfacePoint,
  surfaceQuad,
} from "../../src/render/isometric";
import { createSkirmishSettlements } from "../../src/sim/skirmish";
import {
  WATER_LEVEL,
  editTerrain,
  generateIsland,
} from "../../src/sim/terrain";
import type { TerrainState } from "../../src/sim/terrain";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("worldling.guide-dismissed.v1", "1");
    } catch {
      // Storage is unavailable on the about:blank navigation used by one test.
    }
  });
});

function cameraOriginForTest(terrain: TerrainState) {
  const starts = createSkirmishSettlements(terrain);
  return projectTile(
    starts.player.banner.x,
    starts.player.banner.y,
    WATER_LEVEL,
  );
}

async function tilePoint(
  page: Page,
  terrain: TerrainState,
  tile: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
  zoom = 0.42,
) {
  const point = surfaceCenter(
    surfaceQuad(tile.x, tile.y, terrain.size, createCornerHeights(terrain)),
  );
  const origin = cameraOriginForTest(terrain);
  const target = {
    x: bounds.x + bounds.width / 2 + (point.x - origin.x) * zoom,
    y: bounds.y + bounds.height / 2 + (point.y - origin.y) * zoom,
  };
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  const delta = { x: target.x - center.x, y: target.y - center.y };
  if (Math.abs(delta.x) > 0.01 || Math.abs(delta.y) > 0.01) {
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x - delta.x, center.y - delta.y, { steps: 8 });
    await page.mouse.up();
  }
  return center;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?seed=474F44");
  await expect(page.getByTestId("world-canvas")).toBeVisible();
});

test("raises and lowers a tile through explicit tools", async ({ page }) => {
  const canvas = page.getByTestId("world-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Canvas has no bounds");
  const terrain = generateIsland(0x47_4f_44);
  const point = await tilePoint(page, terrain, { x: 32, y: 32 }, bounds);

  await page.getByRole("button", { name: "Raise", exact: true }).click();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("edit-count")).toHaveText("1 edit");

  await page.getByRole("button", { name: "Lower", exact: true }).click();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("edit-count")).toHaveText("2 edits");
  await expect(page.locator("#selection-status")).toHaveText(
    "Tile 32, 32 · height 5",
  );
});

test("picks an off-center sloped surface after editing, zoom, and resize", async ({
  page,
}) => {
  const canvas = page.getByTestId("world-canvas");
  const initialBounds = await canvas.boundingBox();
  if (!initialBounds) throw new Error("Canvas has no bounds");
  await page.getByRole("button", { name: "Raise", exact: true }).click();
  const initialTerrain = generateIsland(0x47_4f_44);
  const initialPoint = await tilePoint(
    page,
    initialTerrain,
    { x: 32, y: 32 },
    initialBounds,
  );
  await page.getByRole("button", { name: "Raise", exact: true }).click();
  await page.mouse.click(initialPoint.x, initialPoint.y);
  await expect(page.getByTestId("edit-count")).toHaveText("1 edit");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();

  const terrain = generateIsland(0x47_4f_44);
  createSkirmishSettlements(terrain);
  editTerrain(terrain, 32, 32, "raise");
  const corners = createCornerHeights(terrain);
  const surface = surfaceQuad(33, 32, terrain.size, corners);
  const slopePoint = surfacePoint(surface, 0.5, 0.5);
  const cameraOrigin = projectTile(32, 32, WATER_LEVEL);
  const zoom = 0.42 * 1.2 ** 2;
  const clickSlope = async () => {
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("Canvas has no bounds");
    await page.mouse.click(
      bounds.x + bounds.width / 2 + (slopePoint.x - cameraOrigin.x) * zoom,
      bounds.y + bounds.height / 2 + (slopePoint.y - cameraOrigin.y) * zoom,
    );
    await expect(page.locator("#selection-status")).toHaveText(
      "Tile 33, 32 · height 5",
    );
  };

  await clickSlope();
  await page.setViewportSize({ width: 900, height: 500 });
  await page.waitForTimeout(100);
  await clickSlope();
});

test("explains when a terrain edit is rejected", async ({ page }) => {
  const canvas = page.getByTestId("world-canvas");
  const terrain = generateIsland(0x47_4f_44);
  await page.getByRole("button", { name: "Raise", exact: true }).click();
  await canvas.focus();

  for (let index = 0; index < 3; index += 1) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
    editTerrain(terrain, 32, 32, "raise");
  }
  await expect(page.getByTestId("edit-count")).toHaveText("2 edits");
  await expect(page.locator("#selection-status")).toContainText(
    "cannot be changed",
  );
});

test("pan and zoom never edit terrain", async ({ page, isMobile }) => {
  const canvas = page.getByTestId("world-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Canvas has no bounds");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;

  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 50, { steps: 8 });
  await page.mouse.up();
  const initialZoom = await page.getByTestId("zoom-level").textContent();
  if (isMobile) {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  } else {
    await page.mouse.wheel(0, -200);
  }
  await expect(page.getByTestId("edit-count")).toHaveText("0 edits");
  await expect(page.getByTestId("zoom-level")).not.toHaveText(
    initialZoom ?? "",
  );
});

test("mouse drag paints terrain across multiple tiles", async ({ page }) => {
  const canvas = page.getByTestId("world-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Canvas has no bounds");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.getByRole("button", { name: "Raise", exact: true }).click();
  await page.mouse.click(x, y);
  await page.mouse.click(x, y);
  await expect(page.getByTestId("edit-count")).toHaveText("2 edits");

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 6 });
  await expect(page.getByTestId("edit-count")).not.toHaveText("0 edits");
  const outwardCount = Number.parseInt(
    (await page.getByTestId("edit-count").textContent()) ?? "0",
    10,
  );
  expect(outwardCount).toBeGreaterThan(1);
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  const finalCount = Number.parseInt(
    (await page.getByTestId("edit-count").textContent()) ?? "0",
    10,
  );
  expect(finalCount).toBeGreaterThanOrEqual(outwardCount);
});

test("tool buttons meet touch-target and state requirements", async ({
  page,
}) => {
  const raise = page.getByRole("button", { name: "Raise", exact: true });
  await raise.click();
  await expect(raise).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Inspect" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  for (const button of await page.getByRole("button").all()) {
    const bounds = await button.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    await expect(button).toHaveCSS("touch-action", "manipulation");
  }
});

test("game surface suppresses accidental text selection", async ({ page }) => {
  await expect(page.locator("body")).toHaveCSS("user-select", "none");
});

test("navigation away and back restores working tools", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("about:blank");
  await page.goBack();
  await expect(page.getByTestId("world-canvas")).toBeVisible();

  await page.getByRole("button", { name: "Raise", exact: true }).click();
  const bounds = await page.getByTestId("world-canvas").boundingBox();
  if (!bounds) throw new Error("Canvas has no bounds");
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await expect(page.getByTestId("edit-count")).toHaveText("1 edit");
  expect(errors).toEqual([]);
});

test("keyboard controls and focus are usable", async ({ page }) => {
  const canvas = page.getByTestId("world-canvas");
  await canvas.focus();
  await expect(canvas).toBeFocused();
  await page.keyboard.press("2");
  await expect(
    page.getByRole("button", { name: "Raise", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("+");
  await expect(page.getByTestId("zoom-level")).not.toHaveText("42%");
  await page.keyboard.press("d");
  await expect(page.locator("#selection-status")).toContainText(
    "Cursor 33, 32",
  );
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("edit-count")).toHaveText("1 edit");
});

test("WASD reaches a tile that differs only on the x axis", async ({
  page,
}) => {
  await page.getByTestId("world-canvas").focus();
  for (let index = 0; index < 8; index += 1) await page.keyboard.press("d");
  for (let index = 0; index < 23; index += 1) await page.keyboard.press("w");
  await expect(page.locator("#selection-status")).toContainText("Cursor 40, 9");
  await page.keyboard.press("a");
  await expect(page.locator("#selection-status")).toContainText("Cursor 39, 9");
});

test("canvas uses a fixed pixel-art buffer and fits the viewport", async ({
  page,
}) => {
  const dimensions = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#world");
    if (!canvas) throw new Error("Canvas missing");
    const bounds = canvas.getBoundingClientRect();
    return {
      ratio: canvas.width / bounds.width,
      rendering: getComputedStyle(canvas).imageRendering,
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    };
  });
  expect(dimensions.ratio).toBeCloseTo(0.5, 1);
  expect(dimensions.rendering).toBe("pixelated");
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});

test("touch tap edits and one-finger touch drag pans", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== "chromium" || !isMobile, "CDP touch test");
  const canvas = page.getByTestId("world-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Canvas has no bounds");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const session = await page.context().newCDPSession(page);
  await page.getByRole("button", { name: "Raise", exact: true }).click();

  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByTestId("edit-count")).toHaveText("1 edit");

  const beforePan = await canvas.screenshot();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + 70, y: y + 40, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const afterPan = await canvas.screenshot();
  expect(beforePan.equals(afterPan)).toBe(false);
  await expect(page.getByTestId("edit-count")).toHaveText("1 edit");
});

test("pinch, midpoint pan, and staged finger lifting work together", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== "chromium" || !isMobile, "CDP touch test");
  const canvas = page.getByTestId("world-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Canvas has no bounds");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const initialZoom = await page.getByTestId("zoom-level").textContent();
  const session = await page.context().newCDPSession(page);

  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: x - 30, y, id: 1 },
      { x: x + 30, y, id: 2 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x - 70, y: y + 20, id: 1 },
      { x: x + 70, y: y + 20, id: 2 },
    ],
  });
  await expect(page.getByTestId("zoom-level")).not.toHaveText(
    initialZoom ?? "",
  );

  const beforeRemainingPan = await canvas.screenshot();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [{ x: x - 70, y: y + 20, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + 120, y: y + 60, id: 2 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const afterRemainingPan = await canvas.screenshot();

  expect(beforeRemainingPan.equals(afterRemainingPan)).toBe(false);
  await expect(page.getByTestId("edit-count")).toHaveText("0 edits");
});

test("orientation changes preserve usable controls and picking", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Raise", exact: true }),
  ).toBeVisible();
  for (let index = 0; index < 8; index += 1) {
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  }
  const portraitZoom = Number.parseInt(
    (await page.getByTestId("zoom-level").textContent()) ?? "0",
    10,
  );

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(
    page.getByRole("button", { name: "Raise", exact: true }),
  ).toBeVisible();
  const landscapeZoom = Number.parseInt(
    (await page.getByTestId("zoom-level").textContent()) ?? "0",
    10,
  );
  expect(landscapeZoom).toBeGreaterThanOrEqual(portraitZoom);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  await page.getByRole("button", { name: "Raise", exact: true }).click();
  const bounds = await page.getByTestId("world-canvas").boundingBox();
  if (!bounds) throw new Error("Canvas has no bounds");
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await expect(page.getByTestId("edit-count")).toHaveText("1 edit");
});
