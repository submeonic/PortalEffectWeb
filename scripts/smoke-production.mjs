import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const context = await browser.newContext({
    viewport: { width: 402, height: 874 },
    screen: { width: 402, height: 874 },
    isMobile: true,
  });
  const page = await context.newPage();
  const fixture =
    "data:image/jpeg;base64," +
    readFileSync("tests/fixtures/portrait.jpg").toString("base64");
  await page.addInitScript(
    ({ fixture }) => {
      navigator.mediaDevices.getUserMedia = async () => {
        const image = new Image();
        image.src = fixture;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const draw = () => {
          canvas.getContext("2d").drawImage(image, 0, 0);
          requestAnimationFrame(draw);
        };
        draw();
        return canvas.captureStream(24);
      };
    },
    { fixture },
  );
  const response = await page.goto(process.argv[2] ?? "http://127.0.0.1:4173");
  if (response.status() !== 200) throw Error("Production index unavailable");
  await page.locator("#start-camera").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#tracking-state")
        .textContent.includes("Face detected"),
    {},
    { timeout: 45000 },
  );
  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#delegate").textContent.includes("worker CPU"),
  );
  await page.getByRole("button", { name: "Calibration", exact: true }).click();
  await page.locator("#start-gaze").click();
  await page
    .locator("#gaze-target")
    .waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(
    () => Number(document.querySelector("#gaze-progress-bar").value) > 0,
    {},
    { timeout: 30000 },
  );
  await page.locator("#cancel-gaze").click();
  console.log(
    "PASS: production subpath assets, MediaPipe worker, real gaze worker and synchronized collection; fixture only, no physical camera.",
  );
} finally {
  await browser.close();
}
