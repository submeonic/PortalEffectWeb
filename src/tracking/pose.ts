import type {
  Vec3,
  Observation,
  Condition,
  Profile,
  Estimate,
  Landmark,
  Intrinsics,
} from "../types";
import { add, mul, finite, transform } from "../geometry/math";
import { assumedIntrinsics, compatible, ray } from "../geometry/intrinsics";
// Canonical eye surface proxies, cm, mean of canonical contours (33,133,159,145) / (362,263,386,374).
// Not eyeball centers or subject-specific anatomy. Scale remains experimental.
export const CANONICAL_EYES: Vec3[] = [
  { x: -3.16416575, y: 2.62690925, z: 3.64600075 },
  { x: 3.16416575, y: 2.62690925, z: 3.64600075 },
];
export function matrixPoint(m: number[], p: Vec3, scale = 1): Vec3 {
  if (m.length !== 16 || !m.every(Number.isFinite))
    throw Error("Invalid face matrix");
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
  return { x: x * 10 * scale, y: -y * 10 * scale, z: -z * 10 * scale };
}
function eyeOpen(
  l: Landmark[],
  upper: number,
  lower: number,
  outer: number,
  inner: number,
) {
  if (!l[upper] || !l[inner]) return false;
  return (
    Math.hypot(l[upper].x - l[lower].x, l[upper].y - l[lower].y) /
      Math.hypot(l[outer].x - l[inner].x, l[outer].y - l[inner].y) >
    0.12
  );
}
export function irisDepth(
  l: Landmark[],
  i: Intrinsics,
  diameter = 11.7,
  correct = true,
): number | null {
  if (
    l.length < 478 ||
    !eyeOpen(l, 159, 145, 33, 133) ||
    !eyeOpen(l, 386, 374, 263, 362)
  )
    return null;
  const depths = [469, 474].map((start) => {
    const points = l
      .slice(start, start + 4)
      .map((p) => ray(p.x * i.width, p.y * i.height, i, correct));
    const a = Math.hypot(points[0].x - points[2].x, points[0].y - points[2].y),
      b = Math.hypot(points[1].x - points[3].x, points[1].y - points[3].y);
    if (Math.min(a, b) / Math.max(a, b) < 0.65) return NaN;
    return diameter / Math.max(a, b);
  });
  if (
    depths.some((d) => !Number.isFinite(d) || d < 120 || d > 1500) ||
    Math.abs(depths[0] - depths[1]) / Math.max(...depths) > 0.25
  )
    return null;
  return (depths[0] + depths[1]) / 2;
}
export function estimate(
  o: Observation,
  c: Condition,
  p: Profile,
): Estimate | null {
  if (!o.detected || !o.matrix) return null;
  const left = matrixPoint(o.matrix, CANONICAL_EYES[0], c.faceScale),
    right = matrixPoint(o.matrix, CANONICAL_EYES[1], c.faceScale),
    face = mul(add(left, right), 0.5);
  if (!finite(face) || face.z < 100 || face.z > 1800) return null;
  const reference = c.depth === "iris-reference";
  const i = reference
    ? p.intrinsics
    : assumedIntrinsics(o.width, o.height, c.focalScale);
  const iris =
    i && compatible(i, o.width, o.height, o.cameraSettings)
      ? irisDepth(o.landmarks, i, c.irisDiameter, c.distortion)
      : null;
  let eye = { ...face };
  if (c.depth !== "face") {
    if (iris === null) return null;
    const depth = c.depth === "fusion" ? 0.5 * face.z + 0.5 * iris : iris;
    const centers = [o.landmarks[468], o.landmarks[473]];
    if (centers.some((x) => !x) || !i) return null;
    const u = ((centers[0].x + centers[1].x) / 2) * o.width,
      v = ((centers[0].y + centers[1].y) / 2) * o.height;
    eye = mul(ray(u, v, i, c.distortion), depth);
  }
  const m = o.matrix;
  const rotation = {
    x: Math.atan2(m[6], m[10]),
    y: Math.atan2(-m[2], Math.hypot(m[0], m[1])),
    z: Math.atan2(m[1], m[0]),
  };
  if (
    c.depth !== "face" &&
    (Math.abs(rotation.x) > 0.6 || Math.abs(rotation.y) > 0.6)
  )
    return null;
  const eyeScreen = transform(eye, p.transform);
  if (
    !finite(eyeScreen) ||
    eye.z < 80 ||
    Math.abs(eye.x) > 600 ||
    Math.abs(eye.y) > 700
  )
    return null;
  return {
    eyeCamera: eye,
    eyeScreen,
    left,
    right,
    faceDepth: face.z,
    irisDepth: iris,
    rotation,
    quality: "detected; confidence unavailable in task result",
    provenance:
      c.depth === "face"
        ? "estimated canonical-face metric scale"
        : `estimated iris depth; ${i?.source} intrinsics`,
  };
}
