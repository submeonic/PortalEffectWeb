import type { Condition, Trial, Vec3 } from "../types";
import { validateProfile } from "./profiles";
const vector = (p: Vec3 | null) =>
  p === null || (p && [p.x, p.y, p.z].every(Number.isFinite));
export function validateCondition(value: unknown): Condition {
  const c = value as Condition;
  if (
    !c ||
    !["nominal", "generic", "card"].includes(c.display) ||
    !["face", "iris-assumed", "iris-reference", "fusion"].includes(c.depth) ||
    !["none", "euro", "alpha-beta"].includes(c.filter) ||
    !["coupled", "static", "naive"].includes(c.rendering) ||
    !["cube", "cubes", "tunnel", "wireframe"].includes(c.scene) ||
    !Number.isFinite(c.irisDiameter) ||
    c.irisDiameter < 9 ||
    c.irisDiameter > 14 ||
    !Number.isFinite(c.focalScale) ||
    c.focalScale < 0.5 ||
    c.focalScale > 2 ||
    !Number.isFinite(c.faceScale) ||
    c.faceScale < 0.5 ||
    c.faceScale > 2 ||
    typeof c.distortion !== "boolean" ||
    !Number.isFinite(c.predictionMs) ||
    c.predictionMs < 0 ||
    c.predictionMs > 40
  )
    throw Error("Invalid experimental condition");
  return c;
}
export function validateTrials(value: unknown): Trial[] {
  if (!Array.isArray(value)) throw Error("Expected trial array");
  for (const t of value as Trial[]) {
    if (
      !t ||
      t.version !== 1 ||
      typeof t.id !== "string" ||
      typeof t.label !== "string" ||
      !Array.isArray(t.samples) ||
      !Array.isArray(t.renderIntervals) ||
      !t.renderIntervals.every((v) => Number.isFinite(v) && v >= 0)
    )
      throw Error("Invalid trial");
    validateProfile(t.profile);
    validateCondition(t.condition);
    if (
      t.windowModels &&
      (!Array.isArray(t.windowModels) ||
        ![2, 3].includes(t.windowModels.length) ||
        t.windowModels.some(
          (m) =>
            !["reference", "unknown"].includes(m.device) ||
            typeof m.card !== "boolean" ||
            typeof m.gaze !== "boolean",
        ))
    )
      throw Error("Invalid comparison window configuration");
    if (t.resolvedModels) {
      if (
        !Array.isArray(t.resolvedModels) ||
        ![2, 3].includes(t.resolvedModels.length)
      )
        throw Error("Invalid resolved models");
      for (const model of t.resolvedModels)
        validateProfile({
          ...t.profile,
          transform: model.cameraToScreen,
          mmPerCss: model.mmPerCss,
          viewport: model.viewport,
        });
    }
    for (const s of t.samples) {
      const o = s.observation;
      if (
        !o ||
        !["camera", "simulated"].includes(o.source) ||
        ![o.time, o.width, o.height, o.inferenceMs, o.intervalMs].every(
          Number.isFinite,
        ) ||
        !Array.isArray(o.landmarks) ||
        !o.landmarks.every(vector) ||
        !(
          o.matrix === null ||
          (Array.isArray(o.matrix) &&
            o.matrix.length === 16 &&
            o.matrix.every(Number.isFinite))
        ) ||
        !vector(s.raw) ||
        !vector(s.filtered) ||
        (s.windowFilteredEyes !== undefined &&
          (!Array.isArray(s.windowFilteredEyes) ||
            ![2, 3].includes(s.windowFilteredEyes.length) ||
            !s.windowFilteredEyes.every(vector))) ||
        (s.windowEyes !== undefined &&
          (!Array.isArray(s.windowEyes) ||
            ![2, 3].includes(s.windowEyes.length) ||
            !s.windowEyes.every(vector))) ||
        !(
          s.referenceDistanceMm === null ||
          (Number.isFinite(s.referenceDistanceMm) && s.referenceDistanceMm > 0)
        ) ||
        !Array.isArray(s.projection)
      )
        throw Error("Invalid numerical observation");
      if (o.source === "simulated" && s.referenceDistanceMm !== null)
        throw Error(
          "Simulator cannot provide an independent physical reference",
        );
    }
  }
  return value as Trial[];
}
