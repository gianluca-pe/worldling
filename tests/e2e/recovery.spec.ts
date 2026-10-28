import { expect, test } from "@playwright/test";

test("terrain edits survive reload and restart clears the saved island", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/?seed=474F44");
  await page.evaluate(() => history.replaceState(null, "", "/"));
  await page.getByTestId("world-canvas").focus();
  await page.keyboard.press("2");
  await page.keyboard.press("d");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("edit-count")).toHaveText("1 edit");
  await page.clock.runFor(200);

  await page.reload();
  await expect(page.getByTestId("edit-count")).toHaveText("1 edit");
  await expect(page.locator("#selection-status")).toContainText(
    "Island restored",
  );
  const saved = await page.evaluate(() => {
    const value = localStorage.getItem("worldling.session.v1");
    return value ? JSON.parse(value) : null;
  });
  expect(saved.replay.mode).toBe("skirmish");
  expect(saved.replay.commands).toHaveLength(1);
  expect(saved.replay.commands[0]).toMatchObject({
    type: "raise-land",
    x: 33,
    y: 32,
  });

  await page.getByTestId("restart-match").click();
  await expect(page.getByTestId("edit-count")).toHaveText("0 edits");
  const cleared = await page.evaluate(() =>
    localStorage.getItem("worldling.session.v1"),
  );
  expect(cleared).toBeNull();
});

test("an edit survives reload before the next animation frame", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/?seed=474F44");
  await page.evaluate(() => history.replaceState(null, "", "/"));
  await page.getByTestId("world-canvas").focus();
  await page.keyboard.press("2");
  await page.keyboard.press("d");
  await page.keyboard.press("Enter");
  await page.reload();
  await expect(page.getByTestId("edit-count")).toHaveText("1 edit");
  const commands = await page.evaluate(() => {
    const value = localStorage.getItem("worldling.session.v1");
    return value ? JSON.parse(value).replay.commands : [];
  });
  expect(commands).toHaveLength(1);
});

test("invalid saved data falls back to a playable new island", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("worldling.session.v1", "not valid json");
  });
  await page.goto("/");
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await expect(page.getByTestId("edit-count")).toHaveText("0 edits");
  expect(
    await page.evaluate(() => localStorage.getItem("worldling.session.v1")),
  ).toBeNull();
  expect(errors).toEqual([]);
});
