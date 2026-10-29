import { describe, it, expect, vi, afterEach } from "vitest";
import {
  decodeAngle,
  gazeDirection,
  normalizeRGB,
  faceCrop,
} from "../src/gaze/math";
import {
  fitModels,
  GazeCalibration,
  TARGETS,
  type Fixation,
} from "../src/gaze/calibration";
import {
  baseModel,
  savedGazeFit,
  resolveModel,
} from "../src/geometry/coordinate-model";
import { newProfile, DEFAULT_CONDITION } from "../src/storage/profiles";
import { cssPoint, unit, sub, rotate } from "../src/geometry/math";
import { estimate } from "../src/tracking/pose";
import type { Viewport, Observation } from "../src/types";
vi.mock("../src/gaze/provider", () => ({
  GazeProvider: class {
    loadMs = 12;
    initialize = vi.fn(async () => {});
    infer = vi.fn();
    dispose = vi.fn();
  },
}));
afterEach(() => vi.restoreAllMocks());
const viewport: Viewport = {
  screenWidth: 402,
  screenHeight: 874,
  width: 402,
  height: 720,
  dpr: 3,
  scale: 1,
  offsetLeft: 0,
  offsetTop: 0,
  orientation: "portrait-primary",
  originX: 0,
  originY: 0,
};
const profile = newProfile(viewport);
const c = DEFAULT_CONDITION;
const model = baseModel(
  { device: "unknown", card: false, gaze: false },
  profile,
  viewport,
);
function fixture(time: number, x = 0): Observation {
  const landmarks = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }));
  for (const [a, b, l, r] of [
    [159, 145, 33, 133],
    [386, 374, 263, 362],
  ]) {
    landmarks[a].y = 0.48;
    landmarks[b].y = 0.52;
    landmarks[l].x = 0.45;
    landmarks[r].x = 0.55;
  }
  return {
    time,
    source: "camera",
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x / 10, 0, -40, 1],
    landmarks,
    width: 640,
    height: 480,
    inferenceMs: 15,
    intervalMs: 110,
    detected: true,
    quality: null,
  };
}
function rayFor(o: Observation, css: { x: number; y: number }) {
  const e = estimate(o, c, profile)!;
  const origin = {
    x: -e.eyeCamera.x + 3,
    y: -e.eyeCamera.y + model.cameraToScreen.translation.y - 4,
    z: e.eyeCamera.z,
  };
  return rotate(
    unit(sub(cssPoint(css.x, css.y, model.mmPerCss, model.viewport), origin)),
    model.cameraToScreen.rotation,
  );
}
function observations(): Fixation[] {
  return TARGETS.flatMap((t, i) =>
    Array.from({ length: 12 }, (_, j) => {
      const o = fixture(i * 3000 + j * 120, i === 5 ? 20 : 0),
        css = { x: t.x * viewport.width, y: t.y * viewport.height };
      return {
        eye: estimate(o, c, profile)!.eyeCamera,
        direction: rayFor(o, css),
        target: { x: 0, y: 0, z: 0 },
        targetCss: css,
        time: o.time,
        heldOut: i >= 4,
        quality: 1,
        targetId: t.id,
        provenance: "synthetic unit-test only",
        observation: o,
        inferenceMs: 12,
      };
    }),
  );
}
describe("camera-relative gaze decoding", () => {
  it("decodes ordered logits and preserves camera-axis signs", () => {
    const logits = new Float32Array(90).fill(-100);
    logits[50] = 100;
    expect(decodeAngle(logits)).toBeCloseTo((20 * Math.PI) / 180, 10);
    expect(gazeDirection(0, 0)).toEqual({ x: -0, y: -0, z: -1 });
    expect(gazeDirection(0.1, 0).x).toBeLessThan(0);
    expect(gazeDirection(0, -0.1).y).toBeGreaterThan(0);
    expect(() => decodeAngle([NaN])).toThrow();
  });
  it("normalizes unmirrored RGB into NCHW without swapping channels", () => {
    const data = normalizeRGB(
      new Uint8ClampedArray([255, 128, 0, 255, 0, 255, 255, 255]),
    );
    expect(data[0]).toBeCloseTo((1 - 0.485) / 0.229);
    expect(data[2]).toBeCloseTo((128 / 255 - 0.456) / 0.224);
    expect(data[4]).toBeCloseTo(-0.406 / 0.225);
    expect(data[5]).toBeCloseTo((1 - 0.406) / 0.225);
  });
  it("rejects off-frame and small face crops", () => {
    expect(faceCrop([], 640, 480)).toBeNull();
    expect(faceCrop(fixture(0).landmarks, 640, 480)).toBeNull();
  });
});
describe("independent transform fitting", () => {
  it("fits each model separately, binds accepted fit, and rejects changed depth/viewport", () => {
    const p = structuredClone(profile);
    p.gaze = fitModels(observations(), p, viewport, c, {});
    const selection = { device: "unknown" as const, card: false, gaze: true };
    const fit = savedGazeFit(selection, p, viewport, c)!;
    expect(fit.accepted).toBe(true);
    expect(fit.delta.x).toBeCloseTo(3, 1);
    expect(fit.delta.y).toBeCloseTo(-4, 1);
    expect(
      resolveModel(selection, p, viewport, c).cameraToScreen.translation.x,
    ).toBeCloseTo(3, 1);
    expect(
      savedGazeFit(selection, p, viewport, { ...c, faceScale: 1.1 }),
    ).toBeNull();
    expect(
      savedGazeFit(selection, p, { ...viewport, scale: 1.2 }, c),
    ).toBeNull();
  });
  it("withholds both center poses and rejects an independently biased second pose", () => {
    const rays = observations();
    const a = fitModels(rays, profile, viewport, c, {}).fits["unknown:baseline"]
      .fit;
    rays
      .filter((r) => r.targetId === "center-new-pose")
      .forEach(
        (r) =>
          (r.direction = unit({ ...r.direction, x: r.direction.x + 0.14 })),
      );
    const b = fitModels(rays, profile, viewport, c, {}).fits["unknown:baseline"]
      .fit;
    expect(b.delta).toEqual(a.delta);
    expect(b.accepted).toBe(false);
  });
  it("completes collection with synchronized observations, settling and an independent pose", async () => {
    let time = 0,
      index = -1,
      completed: any = null,
      css = { x: 0, y: 0 };
    vi.spyOn(performance, "now").mockImplementation(() => time);
    const errors: string[] = [];
    const run = new GazeCalibration(
      profile,
      c,
      viewport,
      (status) => {
        if (status.ready && status.index !== index) {
          index = status.index;
          css = {
            x: TARGETS[index].x * viewport.width,
            y: TARGETS[index].y * viewport.height,
          };
          run.setTarget(css.x, css.y);
        }
      },
      (error) => errors.push(error),
      (bundle) => (completed = bundle),
    );
    let current = fixture(0);
    vi.mocked(run.provider.infer).mockImplementation(async () => ({
      direction: rayFor(current, css),
      yaw: 0,
      pitch: 0,
      inferenceMs: 12,
      crop: { x: 0, y: 0, width: 100, height: 100 },
    }));
    await run.initialize();
    for (let i = 0; i < 250 && run.running; i++) {
      time += 120;
      current = fixture(time, index === 5 ? 20 : 0);
      await run.sample(current, {} as HTMLCanvasElement);
    }
    expect(errors).toEqual([]);
    expect(completed.fits["unknown:baseline"].fit.accepted).toBe(true);
    expect(new Set(run.observations.map((o) => o.targetId)).size).toBe(6);
    expect(run.provider.dispose).toHaveBeenCalled();
  });
  it("cancellation discards an in-flight result without advancing fixation", async () => {
    let time = 0;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    const run = new GazeCalibration(
      profile,
      c,
      viewport,
      () => {},
      () => {},
      () => {},
    );
    await run.initialize();
    run.setTarget(20, 20);
    time = 1000;
    let resolve!: (value: any) => void;
    vi.mocked(run.provider.infer).mockReturnValue(
      new Promise((r) => (resolve = r)),
    );
    const pending = run.sample(fixture(time), {} as HTMLCanvasElement);
    run.dispose();
    resolve({ direction: { x: 0, y: 0, z: -1 }, inferenceMs: 12 });
    await pending;
    expect(run.observations).toHaveLength(0);
  });
});

it("invalidates a saved gaze fit for a changed delivered camera format", () => {
  const p = structuredClone(profile);
  const bundle = fitModels(observations(), p, viewport, c, {});
  bundle.cameraSignature = "camera640x480";
  p.gaze = bundle;
  const selection = { device: "unknown" as const, card: false, gaze: true };
  expect(
    savedGazeFit(selection, p, viewport, c, "camera640x480"),
  ).not.toBeNull();
  expect(savedGazeFit(selection, p, viewport, c, "camera1280x720")).toBeNull();
});
