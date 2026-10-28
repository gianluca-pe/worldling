import { expect, test } from "@playwright/test";

test("fresh visits, seed entry, random islands, and restart follow seed semantics", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let nextSeed = Number(sessionStorage.getItem("test-next-seed") ?? 1);
    Object.defineProperty(window.crypto, "getRandomValues", {
      value: (array: Uint32Array) => {
        array[0] = nextSeed;
        nextSeed += 1;
        sessionStorage.setItem("test-next-seed", String(nextSeed));
        return array;
      },
    });
  });
  await page.goto("/");
  const currentSeed = page.getByTestId("current-seed");
  await expect(currentSeed).toHaveText("1");

  await page.reload();
  await expect(currentSeed).toHaveText("1");

  await page.locator("#seed-menu > summary").click();
  await page.getByTestId("random-island").click();
  await expect(currentSeed).toHaveText("2");
  await expect(page.locator("#seed-menu")).not.toHaveAttribute("open", "");

  await page.locator("#seed-menu > summary").click();
  await page.locator("#seed-entry").fill("474F44");
  await page.getByTestId("load-seed").click();
  await expect(currentSeed).toHaveText("474F44");
  await expect(page.locator("#selection-status")).toContainText(
    "Island 474F44 loaded",
  );

  await page.locator("#seed-menu > summary").click();
  await page.getByTestId("random-island").click();
  await expect(currentSeed).toHaveText("3");
  await page.getByTestId("restart-match").click();
  await expect(currentSeed).toHaveText("3");
});

test("an explicit seed URL reproduces the requested island", async ({
  page,
}) => {
  await page.goto("/?seed=00000006");
  await expect(page.getByTestId("current-seed")).toHaveText("6");
  await page.reload();
  await expect(page.getByTestId("current-seed")).toHaveText("6");
  await expect(page.getByTestId("edit-count")).toHaveText("0 edits");
});
