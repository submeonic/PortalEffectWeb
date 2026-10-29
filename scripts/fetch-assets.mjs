import { mkdir, cp, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
await mkdir("public/vendor", { recursive: true });
await mkdir("public/models", { recursive: true });
await cp(
  "node_modules/@mediapipe/tasks-vision/wasm",
  "public/vendor/mediapipe",
  { recursive: true },
);
const url =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const response = await fetch(url);
if (!response.ok) throw Error(`Model download: ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (
  sha256 !== "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
)
  throw Error(
    "Official model checksum changed; review before updating the pinned artifact",
  );
await writeFile("public/models/face_landmarker.task", bytes);
await writeFile(
  "public/models/provenance.json",
  JSON.stringify(
    {
      url,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      downloaded: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  `Prepared local WASM and ${bytes.length} byte Face Landmarker model`,
);

await cp(
  "node_modules/@mediapipe/tasks-vision/vision_bundle.cjs",
  "public/vendor/vision_bundle.js",
);

// Calibration-only gaze model. Pin both upstream revision and content digest.
const gazeRevision = "7e48ffa8eaa1e970f98d11204adea4f72b0954a3";
const gazeRoot = `https://huggingface.co/Arm/mobilegaze-mobilenet-v2-int8-onnx/resolve/${gazeRevision}/`;
const gazeFile = "l2cs_mobilegaze_mobilenetv2-a8w8-2-ort-quantized.onnx";
const gazeHash =
  "7367559b5d95ca3d74d85cb117b38ccd6bb0f0ca5eb0311ecef4129baa9b8fbc";
const gazeResponse = await fetch(gazeRoot + gazeFile);
if (!gazeResponse.ok)
  throw Error(`Gaze model download: ${gazeResponse.status}`);
const gazeBytes = new Uint8Array(await gazeResponse.arrayBuffer());
if (createHash("sha256").update(gazeBytes).digest("hex") !== gazeHash)
  throw Error("Gaze model checksum mismatch");
await writeFile("public/models/mobilegaze.onnx", gazeBytes);
for (const name of ["README.md", "config.yaml"]) {
  const response = await fetch(gazeRoot + name);
  if (!response.ok) throw Error(`Gaze provenance download: ${response.status}`);
  await writeFile(`public/models/gaze-${name}`, await response.text());
}
await writeFile(
  "public/models/gaze-provenance.json",
  JSON.stringify(
    {
      model: "Arm MobileGaze MobileNetV2 INT8",
      revision: gazeRevision,
      url: gazeRoot + gazeFile,
      sha256: gazeHash,
      bytes: gazeBytes.length,
      artifactLicense: "Apache-2.0",
      upstreamCodeLicense: "MIT",
      upstream: "https://github.com/yakhyo/gaze-estimation",
      trainingData: "Gaze360",
      runtime: "onnxruntime-web@1.23.2",
      downloaded: new Date().toISOString(),
    },
    null,
    2,
  ),
);
await mkdir("public/vendor/onnx", { recursive: true });
for (const name of [
  "ort.wasm.min.js",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
]) {
  await cp(
    `node_modules/onnxruntime-web/dist/${name}`,
    `public/vendor/onnx/${name}`,
  );
}
console.log(
  `Prepared calibration-only gaze model (${gazeBytes.length} bytes) and ONNX WASM`,
);
await cp(
  "docs/licenses/Apache-2.0.txt",
  "public/models/LICENSE-APACHE-2.0.txt",
);
for (const [file, destination] of [
  ["LICENSE", "LICENSE-MIT.txt"],
  ["ThirdPartyNotices.txt", "ThirdPartyNotices.txt"],
]) {
  const response = await fetch(
    `https://raw.githubusercontent.com/microsoft/onnxruntime/v1.23.2/${file}`,
  );
  if (!response.ok) throw Error(`ONNX license download: ${response.status}`);
  await writeFile(`public/vendor/onnx/${destination}`, await response.text());
}
