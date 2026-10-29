import type { Vec3, Transform } from "../types";
import {
  add,
  sub,
  mul,
  unit,
  dot,
  norm,
  rotate,
  transform,
} from "../geometry/math";
export type GazeObservation = {
  eye: Vec3;
  direction: Vec3;
  target: Vec3;
  heldOut: boolean;
  quality: number;
  targetId: string;
  provenance: string;
};
export function residual(o: GazeObservation, t: Transform) {
  const d = unit(rotate(o.direction, t.rotation)),
    v = sub(o.target, transform(o.eye, t));
  return norm(sub(v, mul(d, dot(v, d))));
}
// Only tx,ty are free; rotation,tz,intrinsics,eye scale remain fixed. This
// avoids the depth/gaze-bias/focal-length degeneracy of unrestricted fitting.
export function fitTranslation(
  observations: GazeObservation[],
  baseline: Transform,
  priorSigmaMm = 8,
  boundMm = 15,
) {
  const train = observations.filter((o) => !o.heldOut && o.quality >= 0.5),
    test = observations.filter((o) => o.heldOut && o.quality >= 0.5);
  const result = {
    accepted: false,
    reason: "",
    baseline,
    transform: baseline,
    trainingBefore: null as number | null,
    trainingAfter: null as number | null,
    validationBefore: null as number | null,
    validationAfter: null as number | null,
    conditionNumber: Infinity,
    delta: { x: 0, y: 0 },
    uncertaintyMm: null as number | null,
    priorSigmaMm,
  };
  const fail = (reason: string) => ({ ...result, reason });
  if (priorSigmaMm <= 0 || boundMm <= 0) return fail("Invalid bounds or prior");
  if (
    train.length < 12 ||
    new Set(train.map((o) => o.targetId)).size < 4 ||
    test.length < 3
  )
    return fail(
      "Need four training targets and at least three independent validation samples",
    );
  if (
    observations.some(
      (o) =>
        !Number.isFinite(o.quality) ||
        o.quality < 0 ||
        o.quality > 1 ||
        !Number.isFinite(norm(o.eye)) ||
        !Number.isFinite(norm(o.direction)) ||
        norm(o.direction) < 0.9 ||
        !Number.isFinite(norm(o.target)),
    )
  )
    return fail("Invalid observations");
  const trainingIds = new Set(train.map((o) => o.targetId));
  if (
    test.some(
      (o) =>
        trainingIds.has(o.targetId) ||
        train.some((t) => norm(sub(o.target, t.target)) < 1),
    )
  )
    return fail("Validation target overlaps training targets");
  let dx = 0,
    dy = 0,
    aa = 0,
    ab = 0,
    bb = 0;
  for (let iteration = 0; iteration < 8; iteration++) {
    aa = 0;
    ab = 0;
    bb = 0;
    let ax = 0,
      by = 0;
    for (const o of train) {
      const d = unit(rotate(o.direction, baseline.rotation)),
        v = sub(o.target, transform(o.eye, baseline));
      const pxx = 1 - d.x * d.x,
        pxy = -d.x * d.y,
        pyy = 1 - d.y * d.y;
      const err = residual(o, {
        ...baseline,
        translation: add(baseline.translation, { x: dx, y: dy, z: 0 }),
      });
      const w = o.quality * Math.min(1, 5 / Math.max(err, 1e-9));
      aa += w * pxx;
      ab += w * pxy;
      bb += w * pyy;
      ax += w * (v.x - d.x * dot(d, v));
      by += w * (v.y - d.y * dot(d, v));
    }
    const trace = aa + bb,
      disc = Math.sqrt((aa - bb) ** 2 + 4 * ab * ab),
      lo = (trace - disc) / 2,
      hi = (trace + disc) / 2;
    result.conditionNumber = hi / lo;
    if (lo < 1e-6 || result.conditionNumber > 1000)
      return fail("Ill-conditioned translation geometry");
    const ridge = 1 / priorSigmaMm ** 2;
    const determinant = (aa + ridge) * (bb + ridge) - ab * ab;
    dx = ((bb + ridge) * ax - ab * by) / determinant;
    dy = ((aa + ridge) * by - ab * ax) / determinant;
  }
  result.delta = { x: dx, y: dy };
  if (Math.abs(dx) > boundMm || Math.abs(dy) > boundMm)
    return fail("Fit exceeds physical parameter bounds");
  const candidate = {
    ...baseline,
    translation: add(baseline.translation, { x: dx, y: dy, z: 0 }),
    provenance:
      "fitted: bounded tx/ty from camera-relative gaze observations; rotation and tz fixed",
  };
  if (
    [...train, ...test].some(
      (o) =>
        dot(
          rotate(o.direction, candidate.rotation),
          sub(o.target, transform(o.eye, candidate)),
        ) <= 0,
    )
  )
    return fail("Gaze ray points away from the target plane");
  const rms = (a: GazeObservation[], t: Transform) =>
    Math.sqrt(a.reduce((s, o) => s + residual(o, t) ** 2, 0) / a.length);
  result.trainingBefore = rms(train, baseline);
  result.trainingAfter = rms(train, candidate);
  result.validationBefore = rms(test, baseline);
  result.validationAfter = rms(test, candidate);
  result.uncertaintyMm = result.trainingAfter / Math.sqrt(Math.min(aa, bb));
  if (
    result.validationAfter >= result.validationBefore * 0.95 ||
    result.validationAfter > 10 ||
    result.validationBefore - result.validationAfter < 1
  )
    return fail(
      "Withheld target needs 5% and 1 mm improvement, with residual at most 10 mm",
    );
  return {
    ...result,
    accepted: true,
    reason:
      "Independent residual improved; repeat at a new head position before treating as accurate",
    transform: candidate,
  };
}
