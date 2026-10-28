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
  console.log(
    "PASS: production static assets, model and worker inference; portrait fixture only, no physical camera.",
  );
} finally {
  await browser.close();
}
