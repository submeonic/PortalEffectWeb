import type { Vec3 } from "../types";
import {
  screenIntersection,
  defaultTransform,
  sub,
  unit,
  transform,
} from "../geometry/math";
import { fitTranslation, type GazeObservation } from "../optimization/gaze-fit";
export function syntheticGaze(
  biasDegrees = 0,
  noise = 0,
  seed = 123,
): GazeObservation[] {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
  const baseline = defaultTransform(),
    truth = {
      ...baseline,
      translation: { x: 3, y: baseline.translation.y - 4, z: 0 },
    };
  const targets = [
    { x: 25, y: 50, z: 0 },
    { x: 25, y: -50, z: 0 },
    { x: -25, y: -50, z: 0 },
    { x: -25, y: 50, z: 0 },
    { x: 0, y: 0, z: 0 },
  ];
  return targets.flatMap((target, k) =>
    Array.from({ length: 12 }, (_, j) => {
      const eye = { x: ((j % 3) - 1) * 30, y: 45, z: 330 + (j % 4) * 40 },
        v = unit(sub(target, transform(eye, truth)));
      const b = (biasDegrees * Math.PI) / 180;
      const screen = {
        x: v.x * Math.cos(b) + v.z * Math.sin(b) + random() * noise,
        y: v.y + random() * noise,
        z: -v.x * Math.sin(b) + v.z * Math.cos(b),
      };
      return {
        eye,
        direction: unit({ x: -screen.x, y: -screen.y, z: screen.z }),
        target,
        heldOut: k === 4,
        quality: 1,
        targetId: String(k),
        provenance: "simulated known geometry",
      };
    }),
  );
}
export function perturbationSweep() {
  const eye = { x: 25, y: 0, z: 400 },
    point = { x: 0, y: 0, z: -60 };
  const truth = screenIntersection(point, eye);
  return [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2].map((delta) => {
    const depth = screenIntersection(point, { ...eye, z: eye.z * (1 + delta) });
    const lateral = screenIntersection(point, {
      ...eye,
      x: eye.x + delta * 50,
    });
    const scale = screenIntersection(point, eye);
    return {
      perturbation: delta,
      depthProjectionErrorMm: Math.hypot(depth.x - truth.x, depth.y - truth.y),
      lateralProjectionErrorMm: Math.hypot(
        lateral.x - truth.x,
        lateral.y - truth.y,
      ),
      displayScaleErrorPercent: delta * 100,
      displayScaleProjectionErrorMm: Math.abs(scale.x * delta),
      irisDepthErrorFromFocalPercent: delta * 100,
      irisDepthErrorFromDiameterPercent: delta * 100,
      principalPointShiftPx: delta * 100,
      principalPointEyeErrorMm: Math.abs((delta * 100 * 400) / 600),
    };
  });
}
export function syntheticReport() {
  return {
    provenance: "simulated; no hardware measurements",
    seed: 123,
    units: "mm unless named otherwise",
    sweep: perturbationSweep(),
    idealFit: fitTranslation(syntheticGaze(), defaultTransform(), 1e6),
    biasedFit: fitTranslation(syntheticGaze(3), defaultTransform()),
    noisyFit: fitTranslation(syntheticGaze(0, 0.01), defaultTransform()),
  };
}
