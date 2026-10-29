import { test, expect } from "@playwright/test";
test("renders WebGL portal and responds to simulated eye movement", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#portal-main canvas")).toBeVisible();
  await page.locator(".comparison-settings summary").click();
  await page.locator("#sx").fill("45");
  await expect(page.locator("#eye-readout")).toContainText("X 45");
  await page.locator("#scene").selectOption("tunnel");
  await page.screenshot({
    path: "test-results/portal-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("both visible portals remain attached to their scrolling apertures", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#portal-second canvas")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 180));
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  await expect(page.locator("#diagnostic-data")).toContainText("sceneCenter");
  const snapshot = JSON.parse(
    (await page.locator("#diagnostic-data").textContent()) ?? "{}",
  );
  for (const portal of snapshot.portals.filter(
    (p: { frustum: unknown }) => p.frustum,
  )) {
    expect(portal.frustum.near).toBe(1);
    expect(portal.sceneCenter.x).toBeCloseTo(
      (portal.metric.left + portal.metric.right) / 2,
      5,
    );
    expect(portal.sceneCenter.y).toBeCloseTo(
      (portal.metric.top + portal.metric.bottom) / 2,
      5,
    );
  }
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
    await page.getByRole("button", { name: "Portal", exact: true }).click();
    await expect(page.locator("#card-b")).toBeEnabled();
    await page.locator("#card-b").check();
    expect(
      JSON.parse((await page.locator("#model-b").textContent()) ?? "{}")
        .mmPerCss,
    ).toBeCloseTo(53.98 / 300, 4);
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
    await page.locator("#expand-inspection").click();
    await page.locator("#device-c").selectOption("reference");
    const rect = await page.locator("#portal-inspection").boundingBox();
    expect(rect!.height).toBeGreaterThan(570);
    await page.screenshot({ path: "test-results/inspection-mobile.png" });
  });
});

test("inspection fills viewport, has independent selection and adjustable foreground cube", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#expand-inspection").click();
  await expect(page.locator("#inspection")).toHaveClass(/expanded/);
  const size = await page.locator("#portal-inspection").boundingBox();
  expect(size!.height).toBeGreaterThan(600);
  await page.locator("#device-c").selectOption("reference");
  expect(await page.locator("#device-b").inputValue()).toBe("unknown");
  await page.locator("#cube-z").fill("12");
  await expect(page.locator("#cube-z-value")).toContainText("toward viewer");
  await page.screenshot({ path: "test-results/inspection-desktop.png" });
  await page.locator("#reset-cube").click();
  await expect(page.locator("#cube-z-value")).toContainText("half outside");
  await page.keyboard.press("Escape");
  await expect(page.locator("#inspection")).not.toHaveClass(/expanded/);
});

test("renderer moves local geometry with scrolled aperture and retains true foreground depth", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { Portal } = await import(
      /* @vite-ignore */ "/src/rendering/portal.ts" as string
    );
    const { DEFAULT_CONDITION } = await import(
      /* @vite-ignore */ "/src/storage/profiles.ts" as string
    );
    const { Vector3, Box3, PointLight, Mesh } = await import(
      /* @vite-ignore */ "/node_modules/three/build/three.module.js" as string
    );
    const el = document.createElement("div");
    el.style.cssText = "width:350px;height:350px";
    document.body.append(el);
    const p = new Portal(el),
      eye = { x: 30, y: 20, z: 400 };
    const bounds = { left: -30, right: 30, bottom: -30, top: 30 };
    p.render(eye, bounds, DEFAULT_CONDITION);
    const before = { ...p.sceneCenter };
    p.render(eye, { ...bounds, top: 50, bottom: -10 }, DEFAULT_CONDITION);
    p.scene.updateMatrixWorld(true);
    p.camera.updateMatrixWorld(true);
    const cube = p.objects.getObjectByName("protruding-cube");
    const box = new Box3().setFromObject(cube);
    const foreground = new Vector3(
      p.sceneCenter.x,
      p.sceneCenter.y,
      10,
    ).project(p.camera);
    const back = p.room.getObjectByName("back-wall");
    const output = {
      before,
      after: p.sceneCenter,
      front: box.max.z,
      back: box.min.z,
      clipZ: foreground.z,
      depth: back.position.z,
      rotation: back.rotation.toArray().slice(0, 3),
      near: p.lastFrustum.near,
      columns: p.room.children
        .filter((o: any) => o.name === "depth-column")
        .map((o: any) => o.geometry.type),
      lights: p.lighting.children.filter((o: any) => o.isPointLight).length,
      colors: p.room.children
        .filter((o: any) => o.isMesh)
        .map((o: any) => o.material.color.getHex()),
    };
    p.dispose();
    el.remove();
    return output;
  });
  expect(result.after.y - result.before.y).toBeCloseTo(20);
  expect(result.front).toBeGreaterThan(10);
  expect(result.back).toBeLessThan(-10);
  expect(result.clipZ).toBeGreaterThan(-1);
  expect(result.clipZ).toBeLessThan(1);
  expect(result.depth).toBe(-25.4);
  expect(result.rotation).toEqual([0, 0, 0]);
  expect(result.near).toBe(1);
  expect(result.columns.length).toBe(10);
  expect(new Set(result.columns)).toEqual(new Set(["BoxGeometry"]));
  expect(new Set(result.colors).size).toBe(1);
  expect(result.lights).toBeGreaterThan(1);
});
