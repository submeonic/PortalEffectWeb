import type { Landmark, Vec3 } from "../types";

export const GAZE_PROVENANCE =
  "MobileGaze MobileNetV2 INT8; Arm 7e48ffa8; sha256:7367559b5d95ca3d74d85cb117b38ccd6bb0f0ca5eb0311ecef4129baa9b8fbc; unmirrored RGB face crop; upstream camera-relative gaze_to_3d convention";
export function decodeAngle(logits: ArrayLike<number>) {
  if (logits.length !== 90 || !Array.from(logits).every(Number.isFinite))
    throw Error("Expected 90 finite gaze logits");
  const max = Math.max(...Array.from(logits));
  let sum = 0,
    weighted = 0;
  for (let i = 0; i < 90; i++) {
    const p = Math.exp(logits[i] - max);
    sum += p;
    weighted += i * p;
  }
  return (((weighted / sum) * 4 - 180) * Math.PI) / 180;
}
// Upstream utils/helpers.py gaze_to_3d: image-right X, down Y, forward Z.
// No head rotation is applied: this appearance model predicts camera-frame gaze.
export function gazeDirection(yaw: number, pitch: number): Vec3 {
  return {
    x: -Math.cos(pitch) * Math.sin(yaw),
    y: -Math.sin(pitch),
    z: -Math.cos(pitch) * Math.cos(yaw),
  };
}
export function normalizeRGB(rgba: Uint8ClampedArray) {
  const count = rgba.length / 4;
  const data = new Float32Array(count * 3);
  const mean = [0.485, 0.456, 0.406],
    sd = [0.229, 0.224, 0.225];
  for (let c = 0; c < 3; c++)
    for (let i = 0; i < count; i++)
      data[c * count + i] = (rgba[i * 4 + c] / 255 - mean[c]) / sd[c];
  return data;
}
export function faceCrop(landmarks: Landmark[], width: number, height: number) {
  if (
    landmarks.length < 468 ||
    !landmarks.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  )
    return null;
  const xs = landmarks.slice(0, 468).map((p) => p.x * width);
  const ys = landmarks.slice(0, 468).map((p) => p.y * height);
  const x = Math.floor(Math.min(...xs)),
    y = Math.floor(Math.min(...ys));
  const w = Math.ceil(Math.max(...xs)) - x,
    h = Math.ceil(Math.max(...ys)) - y;
  // Tight face-mesh envelope instead of upstream RetinaFace box; explicit deviation.
  if (
    w < 70 ||
    h < 70 ||
    x < 1 ||
    y < 1 ||
    x + w >= width - 1 ||
    y + h >= height - 1
  )
    return null;
  return { x, y, width: w, height: h };
}
export function eyesOpen(l: Landmark[], width: number, height: number) {
  const distance = (a: number, b: number) =>
    Math.hypot((l[a].x - l[b].x) * width, (l[a].y - l[b].y) * height);
  return (
    l.length >= 468 &&
    distance(159, 145) / distance(33, 133) > 0.14 &&
    distance(386, 374) / distance(263, 362) > 0.14
  );
}
