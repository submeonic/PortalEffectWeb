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
