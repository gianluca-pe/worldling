import { expect, test } from "@playwright/test";

test("renders the application without startup errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?seed=474F44");

  await expect(
    page.getByRole("heading", { name: "Worldling", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await expect(page.getByTestId("edit-count")).toHaveText("0 edits");
  await page.getByRole("button", { name: "Raise", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Raise", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("fits the viewport without horizontal overflow", async ({ page }) => {
  await page.goto("/?seed=474F44");

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    buttons: [...document.querySelectorAll("button")]
      .filter((button) => button.checkVisibility())
      .map((button) => {
        const bounds = button.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right };
      }),
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  for (const button of dimensions.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(0);
    expect(button.right).toBeLessThanOrEqual(dimensions.viewport);
  }
});
