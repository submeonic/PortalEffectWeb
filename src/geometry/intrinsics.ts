import type { Intrinsics, Vec3 } from "../types";
export function assumedIntrinsics(
  width: number,
  height: number,
  focalScale = 1,
): Intrinsics {
  const f = Math.max(width, height) * 0.9 * focalScale;
  return {
    fx: f,
    fy: f,
    cx: width / 2,
    cy: height / 2,
    width,
    height,
    distortion: [0, 0, 0, 0, 0],
    orientation: width > height ? "landscape" : "portrait",
    provenance:
      "assumed focal length = 0.9 × max delivered dimension; not camera metadata",
    uncertainty: "unknown",
    source: "assumed",
  };
}
export function compatible(
  i: Intrinsics,
  w: number,
  h: number,
  settings?: Record<string, unknown>,
) {
  return (
    i.width === w &&
    i.height === h &&
    i.orientation === (w > h ? "landscape" : "portrait") &&
    (!settings ||
      !i.configuration ||
      Object.entries(i.configuration).every(([k, v]) => settings[k] === v))
  );
}
export function distort(x: number, y: number, d: number[]) {
  const [k1 = 0, k2 = 0, p1 = 0, p2 = 0, k3 = 0] = d,
    r2 = x * x + y * y,
    k = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
  return {
    x: x * k + 2 * p1 * x * y + p2 * (r2 + 2 * x * x),
    y: y * k + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y,
  };
}
export function ray(u: number, v: number, i: Intrinsics, correct = true): Vec3 {
  const xd = (u - i.cx) / i.fx,
    yd = (v - i.cy) / i.fy;
  let x = xd,
    y = yd;
  if (correct)
    for (let n = 0; n < 12; n++) {
      const d = distort(x, y, i.distortion);
      x += xd - d.x;
      y += yd - d.y;
    }
  return { x, y, z: 1 };
}
export function validateIntrinsics(value: unknown): Intrinsics {
  const i = value as Intrinsics;
  if (
    !i ||
    i.source !== "reference" ||
    ![i.fx, i.fy, i.width, i.height].every(
      (v) => Number.isFinite(v) && v > 0,
    ) ||
    ![i.cx, i.cy].every(Number.isFinite) ||
    !Array.isArray(i.distortion) ||
    ![0, 4, 5].includes(i.distortion.length) ||
    !i.distortion.every(Number.isFinite) ||
    !["portrait", "landscape"].includes(i.orientation) ||
    !i.provenance ||
    !i.uncertainty
  )
    throw Error(
      "Invalid intrinsic reference: source must be reference (never assumed); finite fx, fy, cx, cy, dimensions, 0/4/5 distortion coefficients, orientation, provenance and uncertainty required",
    );
  return { ...i, source: "reference" };
}
