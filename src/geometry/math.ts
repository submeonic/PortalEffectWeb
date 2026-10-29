import type { Vec3, Transform, Rect, Viewport } from "../types";
export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
export const mul = (a: Vec3, s: number): Vec3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const norm = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const unit = (a: Vec3) => mul(a, 1 / norm(a));
export const finite = (a: Vec3) => [a.x, a.y, a.z].every(Number.isFinite);
export function rotate(v: Vec3, r: Transform["rotation"]): Vec3 {
  return {
    x: r[0] * v.x + r[1] * v.y + r[2] * v.z,
    y: r[3] * v.x + r[4] * v.y + r[5] * v.z,
    z: r[6] * v.x + r[7] * v.y + r[8] * v.z,
  };
}
export const transform = (v: Vec3, t: Transform) =>
  add(rotate(v, t.rotation), t.translation);
// OpenCV-style metric camera is right-handed: +X image-right, +Y down,
// +Z into the captured scene (toward the viewer of the front camera).
// Image-right is physical screen-left. R=diag(-1,-1,+1) is a proper
// 180-degree Z rotation between this basis and the physical display basis.
export function defaultTransform(screenHeightMm = 144.8): Transform {
  return {
    rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1],
    translation: { x: 0, y: screenHeightMm / 2 - 8, z: 0 },
    provenance:
      "assumed: camera centered, 8 mm below display top, zero depth offset",
  };
}
export function cssPoint(
  x: number,
  y: number,
  scale: number,
  v: Viewport,
): Vec3 {
  return {
    x: ((x - v.offsetLeft) * v.scale + v.originX - v.screenWidth / 2) * scale,
    y: (v.screenHeight / 2 - ((y - v.offsetTop) * v.scale + v.originY)) * scale,
    z: 0,
  };
}
export function cssRect(
  rect: { left: number; top: number; right: number; bottom: number },
  scale: number,
  v: Viewport,
): Rect {
  const a = cssPoint(rect.left, rect.top, scale, v),
    b = cssPoint(rect.right, rect.bottom, scale, v);
  return { left: a.x, right: b.x, top: a.y, bottom: b.y };
}
export function frustum(eye: Vec3, p: Rect, near = 1, far = 4000) {
  if (
    !finite(eye) ||
    eye.z <= near ||
    near <= 0 ||
    far <= eye.z ||
    p.right <= p.left ||
    p.top <= p.bottom
  )
    throw Error("Invalid physical frustum");
  return {
    left: ((p.left - eye.x) * near) / eye.z,
    right: ((p.right - eye.x) * near) / eye.z,
    bottom: ((p.bottom - eye.y) * near) / eye.z,
    top: ((p.top - eye.y) * near) / eye.z,
    near,
    far,
  };
}
export function screenIntersection(point: Vec3, eye: Vec3): Vec3 {
  const t = eye.z / (eye.z - point.z);
  return add(eye, mul(sub(point, eye), t));
}
export const NOMINAL_SCALE = (25.4 / 460) * 3;
export const CARD = { width: 53.98, height: 85.6 };
export const cardScale = (widthCss: number) => {
  if (!Number.isFinite(widthCss) || widthCss <= 0)
    throw Error("Invalid card width");
  return CARD.width / widthCss;
};
export function displayCompatible(a: Viewport, b: Viewport) {
  return (
    a.screenWidth === b.screenWidth &&
    a.screenHeight === b.screenHeight &&
    a.dpr === b.dpr &&
    Math.abs(b.scale - 1) < 0.01 &&
    a.orientation === b.orientation
  );
}
// Browser chrome often changes innerHeight without changing physical pixel
// pitch or the horizontal layout. That alone must not invalidate card scale.
export function cardPlacementCompatible(a: Viewport, b: Viewport) {
  return displayCompatible(a, b) && a.width === b.width;
}
