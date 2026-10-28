import { describe, it, expect } from "vitest";
import { Matrix4, Vector3 } from "three";
import {
  cssPoint,
  cssRect,
  cardScale,
  CARD,
  NOMINAL_SCALE,
  defaultTransform,
  transform,
  frustum,
  screenIntersection,
  displayCompatible,
} from "../src/geometry/math";
import { matrixPoint } from "../src/tracking/pose";
import {
  distort,
  ray,
  assumedIntrinsics,
  compatible,
  validateIntrinsics,
} from "../src/geometry/intrinsics";
import type { Viewport } from "../src/types";
const v: Viewport = {
  screenWidth: 402,
  screenHeight: 874,
  width: 402,
  height: 700,
  dpr: 3,
  scale: 1,
  offsetLeft: 0,
  offsetTop: 0,
  orientation: "portrait-primary",
  originX: 0,
  originY: 70,
};
describe("physical geometry", () => {
  it("uses rotated ID-1 dimensions without nominal correction", () => {
    expect(CARD).toEqual({ width: 53.98, height: 85.6 });
    expect(cardScale(300)).toBeCloseTo(0.179933333333, 10);
    expect(((300 * CARD.height) / CARD.width) * cardScale(300)).toBeCloseTo(
      85.6,
      12,
    );
    expect(() => cardScale(0)).toThrow();
  });
  it("maps display center with content origin", () =>
    expect(cssPoint(201, 367, 0.2, v)).toEqual({ x: 0, y: 0, z: 0 }));
  it("applies visual viewport offsets and scale once", () =>
    expect(
      cssPoint(211, 387, 0.2, { ...v, offsetLeft: 10, offsetTop: 20 }),
    ).toEqual({ x: 0, y: 0, z: 0 }));
  it("converts scrolled DOM rectangle without adding document scroll twice", () => {
    const r = cssRect({ left: 101, top: 267, right: 301, bottom: 467 }, 0.2, v);
    expect(r).toEqual({ left: -20, right: 20, top: 20, bottom: -20 });
  });
  it("nominal scale comes from display ppi, not body size", () =>
    expect(NOMINAL_SCALE * 402).toBeCloseTo(66.592173913, 5));
  it("maps unmirrored camera movement to screen, independent of preview CSS", () =>
    expect(transform({ x: -20, y: 5, z: 400 }, defaultTransform())).toEqual({
      x: 20,
      y: 59.400000000000006,
      z: 400,
    }));
  it("uses column-major MP matrix and cm-to-mm conversion", () => {
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, -40, 1];
    expect(matrixPoint(m, { x: 1, y: 2, z: 3 })).toEqual({
      x: 30,
      y: -50,
      z: 370,
    });
  });
  it("tests rotated canonical pose signs", () => {
    const m = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, -40, 1];
    expect(matrixPoint(m, { x: 1, y: 2, z: 3 })).toEqual({
      x: -20,
      y: -10,
      z: 370,
    });
  });
  it("invalidates display zoom/orientation/DPR but allows browser height updates", () => {
    expect(displayCompatible(v, { ...v, height: 720 })).toBe(true);
    expect(displayCompatible(v, { ...v, dpr: 2 })).toBe(false);
    expect(displayCompatible(v, { ...v, scale: 1.1 })).toBe(false);
  });
});
describe("off-axis projection", () => {
  for (const eye of [
    { x: 0, y: 0, z: 400 },
    { x: 40, y: -25, z: 250 },
    { x: -90, y: 30, z: 800 },
  ])
    for (const bounds of [
      { left: -30, right: 30, bottom: -20, top: 20 },
      { left: 12, right: 40, bottom: -70, top: -30 },
    ])
      it(`anchors portal corners for ${JSON.stringify(eye)} ${bounds.left}`, () => {
        const f = frustum(eye, bounds, 1, 4000);
        const projection = new Matrix4().makePerspective(
          f.left,
          f.right,
          f.top,
          f.bottom,
          f.near,
          f.far,
        );
        for (const [x, y, nx, ny] of [
          [bounds.left, bounds.top, -1, 1],
          [bounds.right, bounds.bottom, 1, -1],
        ]) {
          const p = new Vector3(x - eye.x, y - eye.y, -eye.z).applyMatrix4(
            projection,
          );
          expect(p.x).toBeCloseTo(nx, 12);
          expect(p.y).toBeCloseTo(ny, 12);
        }
      });
  it("produces expected parallax behind the screen", () => {
    const p = { x: 0, y: 0, z: -50 };
    expect(screenIntersection(p, { x: 40, y: 0, z: 400 }).x).toBeCloseTo(
      (40 * 50) / 450,
      12,
    );
  });
  it("rejects invalid distance and bounds", () => {
    expect(() =>
      frustum({ x: 0, y: 0, z: 0 }, { left: -1, right: 1, top: 1, bottom: -1 }),
    ).toThrow();
  });
  it("screen-plane near clipping preserves screen but rejects foreground", () => {
    const e = { x: 0, y: 0, z: 400 },
      b = { left: -30, right: 30, top: 30, bottom: -30 },
      f = frustum(e, b, 399.9, 4000),
      m = new Matrix4().makePerspective(
        f.left,
        f.right,
        f.top,
        f.bottom,
        f.near,
        f.far,
      );
    expect(new Vector3(0, 0, -400).applyMatrix4(m).z).toBeGreaterThan(-1);
    expect(new Vector3(0, 0, -390).applyMatrix4(m).z).toBeLessThan(-1);
  });
});
describe("intrinsics", () => {
  it("inverts moderate Brown-Conrady distortion", () => {
    const i = assumedIntrinsics(640, 480);
    i.distortion = [0.1, -0.02, 0.001, -0.002, 0.001];
    const d = distort(0.2, -0.15, i.distortion),
      r = ray(d.x * i.fx + i.cx, d.y * i.fy + i.cy, i);
    expect(r.x).toBeCloseTo(0.2, 10);
    expect(r.y).toBeCloseTo(-0.15, 10);
  });
  it("does not reuse reference across crop/resolution/configuration changes", () => {
    const i = assumedIntrinsics(640, 480);
    i.configuration = { facingMode: "user" };
    expect(compatible(i, 480, 640)).toBe(false);
    expect(compatible(i, 640, 480, { facingMode: "environment" })).toBe(false);
  });
  it("requires uncertainty and provenance", () => {
    expect(() => validateIntrinsics({ fx: 500 })).toThrow();
  });
});

it("never promotes an assumed camera profile into a reference", () =>
  expect(() => validateIntrinsics(assumedIntrinsics(640, 480))).toThrow(
    "source must be reference",
  ));
