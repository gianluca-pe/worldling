import { expect, test } from "@playwright/test";

test("first-run help is dismissible, persistent, and available on demand", async ({
  page,
}) => {
  await page.goto("/?seed=474F44");
  const guide = page.getByTestId("field-guide");
  const help = page.getByTestId("help");
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("Grow your blue settlement");
  await expect(help).toHaveAttribute("aria-expanded", "true");

  await help.focus();
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
  await expect(help).toBeFocused();
  await page.reload();
  await expect(guide).toBeHidden();

  await help.click();
  await expect(guide).toBeVisible();
  await page.getByTestId("dismiss-guide").click();
  await expect(guide).toBeHidden();
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await expect(help).toBeFocused();
});

test("short-screen help scrolls without tapping through to the island", async ({
  page,
}) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await page.goto("/?seed=474F44");
  const guide = page.getByTestId("field-guide");
  await expect(guide).toBeVisible();
  await page.getByRole("button", { name: "Raise", exact: true }).click();
  await guide.click({ position: { x: 12, y: 12 } });
  await expect(page.getByTestId("edit-count")).toHaveText("0 edits");
  const scroll = await guide.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return {
      top: element.scrollTop,
      height: element.scrollHeight,
      client: element.clientHeight,
    };
  });
  expect(scroll.height).toBeGreaterThan(scroll.client);
  expect(scroll.top).toBeGreaterThan(0);
});

test("help and tools fit a narrow Android-sized viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/?seed=474F44");
  await expect(page.getByTestId("field-guide")).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    buttons: [...document.querySelectorAll("button")]
      .filter((button) => button.checkVisibility())
      .map((button) => {
        const bounds = button.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
        };
      }),
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  for (const button of dimensions.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(0);
    expect(button.right).toBeLessThanOrEqual(dimensions.viewport);
    expect(button.top).toBeGreaterThanOrEqual(0);
    expect(button.bottom).toBeLessThanOrEqual(740);
  }
});
