import { test, expect } from "@playwright/test";
test("renders WebGL portal and responds to simulated eye movement", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#portal-main canvas")).toBeVisible();
  await page.locator("#sx").fill("45");
  await expect(page.locator("#eye-readout")).toContainText("X 45");
  await page.locator("#scene").selectOption("tunnel");
  await page.screenshot({
    path: "test-results/portal-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test.describe("portrait device", () => {
  test.use({
    viewport: { width: 402, height: 874 },
    screen: { width: 402, height: 874 },
    isMobile: true,
    deviceScaleFactor: 3,
  });
  test("portrait calibration locks aspect ratio and persists across reload", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Calibration", exact: true })
      .click();
    await page.locator("#open-card").click();
    await page.locator("#card-width").fill("300");
    const size = await page.locator("#card-outline").boundingBox();
    expect(size!.width / size!.height).toBeCloseTo(53.98 / 85.6, 3);
    await page.locator("#save-card").click();
    await expect(page.locator("#scale-value")).toHaveText("0.17993");
    await page.reload();
    await page
      .getByRole("button", { name: "Calibration", exact: true })
      .click();
    await expect(page.locator("#scale-value")).toHaveText("0.17993");
    await expect(page.locator("#card-results")).toContainText(
      "1 card measurements",
    );
  });
});
test("records labeled simulated trial, ratings, and downloadable export", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Experiments", exact: true }).click();
  await page.locator("#start-trial").click();
  await expect(page.locator("#trial-status")).toContainText("SIMULATED");
  await page.waitForTimeout(300);
  await page.locator("#stop-trial").click();
  await expect(page.locator("#trial-list")).toContainText("simulated");
  await expect(page.locator("#trial-list")).toContainText("unavailable");
  await page.locator("#save-ratings").click();
  const download = page.waitForEvent("download");
  await page.locator("#export-json").click();
  expect((await download).suggestedFilename()).toBe("portal-session.json");
  await page.locator("#run-paired").click();
  await expect(page.locator("#toast")).toContainText("camera");
});
test("synthetic bench and diagnostics expose honest provenance", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Experiments", exact: true }).click();
  await page.locator("#run-synthetic").click();
  await expect(page.locator("#synthetic-table tbody tr")).toHaveCount(7);
  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  await expect(page.locator("#diagnostic-data")).toContainText(
    "inferenceMirrored",
  );
  await expect(page.locator("#diag-state")).toHaveText("SIMULATED");
});
test("camera permission failure is recoverable", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Test denial", "NotAllowedError");
    };
  });
  await page.goto("/");
  await page.locator("#start-camera").click();
  await expect(page.locator("#toast")).toContainText(
    "Could not start tracking",
  );
  await expect(page.locator("#start-camera")).toBeEnabled();
  await expect(page.locator("#tracking-state")).toContainText("Camera is off");
});
test.describe("mobile layout", () => {
  test.use({
    viewport: { width: 402, height: 874 },
    screen: { width: 402, height: 874 },
    isMobile: true,
    deviceScaleFactor: 3,
  });
  test("mobile layout fits width and offers accessible controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto("/");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(402);
    await page.screenshot({
      path: "test-results/portal-mobile.png",
      fullPage: true,
    });
    await expect(page.locator("#start-camera")).toBeVisible();
  });
});
