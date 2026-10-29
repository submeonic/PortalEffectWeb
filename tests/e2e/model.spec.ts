import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("real MediaPipe inference on a known portrait fixture produces metric pose", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { FaceLandmarker, FilesetResolver } = await import(
      /* @vite-ignore */ "/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs" as string
    );
    const files = await FilesetResolver.forVisionTasks("/vendor/mediapipe");
    const model = await FaceLandmarker.createFromOptions(files, {
      baseOptions: {
        modelAssetPath: "/models/face_landmarker.task",
        delegate: "CPU",
      },
      runningMode: "IMAGE",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
    const img = new Image();
    img.src = "/tests/fixtures/portrait.jpg";
    await img.decode();
    const start = performance.now();
    const detected = model.detect(img);
    const inferenceMs = performance.now() - start;
    model.close();
    return {
      faces: detected.faceLandmarks.length,
      matrix: detected.facialTransformationMatrixes[0]?.data,
      landmarks: detected.faceLandmarks[0]?.length,
      inferenceMs,
    };
  });
  expect(result.faces).toBe(1);
  expect(result.landmarks).toBe(478);
  expect(result.matrix).toHaveLength(16);
  expect(result.matrix![14]).toBeLessThan(0);
  expect(result.matrix![15]).toBeCloseTo(1, 5);
  console.log(
    "Fixture inference (desktop CPU, not device camera)",
    JSON.stringify(result),
  );
});

test("camera pipeline uses worker inference and records replayable fixture observations", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const context = await browser.newContext({
    viewport: { width: 402, height: 874 },
    screen: { width: 402, height: 874 },
    isMobile: true,
    baseURL: "http://127.0.0.1:5173",
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image();
      image.src = "/tests/fixtures/portrait.jpg";
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const draw = () => {
        canvas.getContext("2d")!.drawImage(image, 0, 0);
        requestAnimationFrame(draw);
      };
      draw();
      return canvas.captureStream(24);
    };
  });
  await page.goto("/");
  await page.locator("#start-camera").click();
  await expect(page.locator("#tracking-state")).toContainText("Face detected", {
    timeout: 45000,
  });
  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  await expect(page.locator("#delegate")).toContainText("worker CPU");
  await page.getByRole("button", { name: "Experiments", exact: true }).click();
  await page.locator("#start-trial").click();
  await page.waitForTimeout(900);
  await page.locator("#stop-trial").click();
  await expect(page.locator("#trial-list")).toContainText("camera");
  const download = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const session = JSON.parse(await readFile(await (await download).path(), "utf8"));
  const sample = session.trials[0].samples.find((s: { raw: unknown }) => s.raw);
  expect(session.trials[0].windowModels).toHaveLength(2);
  expect(sample.windowEyes).toHaveLength(2);
  expect(sample.raw).toEqual(sample.windowEyes[0]);
  await page.locator("#run-paired").click();
  await expect(page.locator("#paired-results")).toContainText(
    "matchedIndependentErrors",
  );
  await page.getByRole("button", { name: "Portal", exact: true }).click();
  await page.locator("#stop-camera").click();
  await expect(page.locator("#tracking-state")).toContainText("Camera is off");
  await context.close();
});
