import { test, expect } from "@playwright/test";
test.use({
  viewport: { width: 402, height: 874 },
  screen: { width: 402, height: 874 },
  isMobile: true,
  deviceScaleFactor: 3,
});

test("pinned ONNX gaze model runs on a real face fixture in its worker", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { FaceLandmarker, FilesetResolver } = await import(
      /* @vite-ignore */ "/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs" as string
    );
    const { GazeProvider } = await import(
      /* @vite-ignore */ "/src/gaze/provider.ts" as string
    );
    const model = await FaceLandmarker.createFromOptions(
      await FilesetResolver.forVisionTasks("/vendor/mediapipe"),
      {
        baseOptions: {
          modelAssetPath: "/models/face_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      },
    );
    const img = new Image();
    img.src = "/tests/fixtures/portrait.jpg";
    await img.decode();
    const frame = document.createElement("canvas");
    frame.width = img.width;
    frame.height = img.height;
    frame.getContext("2d")!.drawImage(img, 0, 0);
    const face = model.detect(frame);
    model.close();
    const provider = new GazeProvider();
    try {
      await provider.initialize();
      const result = await provider.infer(frame, face.faceLandmarks[0]);
      return { ...result, loadMs: provider.loadMs };
    } finally {
      provider.dispose();
    }
  });
  expect(result.direction).toBeTruthy();
  expect(
    Math.hypot(result.direction.x, result.direction.y, result.direction.z),
  ).toBeCloseTo(1, 5);
  expect(result.direction.z).toBeLessThan(0);
  expect(result.inferenceMs).toBeGreaterThan(0);
  console.log(
    "Real ONNX gaze fixture (desktop WASM; no accuracy ground truth)",
    JSON.stringify(result),
  );
});

test("gaze assets are lazy, live collection can be cancelled, and head tracking survives", async ({
  page,
}) => {
  test.setTimeout(90000);
  const gazeRequests: string[] = [];
  page.on("request", (r) => {
    if (/mobilegaze|ort-wasm|ort.wasm/.test(r.url()))
      gazeRequests.push(r.url());
  });
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
  expect(gazeRequests).toEqual([]);
  await page.getByRole("button", { name: "Calibration", exact: true }).click();
  await page.locator("#start-gaze").click();
  await expect(page.locator("#gaze-target")).toBeVisible({ timeout: 60000 });
  await expect(page.locator("#gaze-progress-bar")).not.toHaveAttribute(
    "value",
    "0",
    { timeout: 20000 },
  );
  expect(gazeRequests.some((r) => r.endsWith("mobilegaze.onnx"))).toBe(true);
  await page.locator("#cancel-gaze").click();
  await expect(page.locator("#gaze-dialog")).not.toBeVisible();
  await expect(page.locator("#gaze-status")).toContainText("unloaded");
  await page.getByRole("button", { name: "Portal", exact: true }).click();
  await expect(page.locator("#tracking-state")).toContainText("Face detected");
  await expect(page.locator("#gaze-a")).toBeDisabled();
  await page.locator("#stop-camera").click();
});
