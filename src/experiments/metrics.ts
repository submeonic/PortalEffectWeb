import type { Trial, Condition, Vec3 } from "../types";
import { estimate } from "../tracking/pose";
import { PoseFilter } from "../filtering/filters";
import { modelEye } from "../geometry/coordinate-model";
import { norm, sub, transform } from "../geometry/math";
export function percentile(values: number[], p: number): number | null {
  const a = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!a.length) return null;
  const i = (a.length - 1) * p,
    lo = Math.floor(i);
  return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo);
}
export function stats(a: number[]) {
  const v = a.filter(Number.isFinite),
    mean = v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
  return {
    n: v.length,
    median: percentile(v, 0.5),
    p05: percentile(v, 0.05),
    p95: percentile(v, 0.95),
    mean,
    sd:
      mean !== null && v.length > 1
        ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1))
        : null,
  };
}
export function summarize(t: Trial) {
  const valid = t.samples.filter((s) => s.raw !== null),
    depthError = valid
      .filter((s) => s.referenceDistanceMm !== null)
      .map((s) => s.raw!.z - s.referenceDistanceMm!);
  const jitter: number[] = [];
  const filteredJitter: number[] = [];
  let lossEvents = 0;
  for (let i = 0; i < t.samples.length; i++) {
    if (!t.samples[i].raw && (i === 0 || t.samples[i - 1].raw)) lossEvents++;
    const a = t.samples[i - 1]?.filtered,
      b = t.samples[i].filtered;
    if (a && b) filteredJitter.push(norm(sub(a, b)));
  }
  for (let i = 1; i < t.samples.length; i++) {
    const a = t.samples[i - 1].raw,
      b = t.samples[i].raw;
    if (a && b) jitter.push(norm(sub(a, b)));
  }
  return {
    id: t.id,
    source: [...new Set(t.samples.map((s) => s.observation.source))],
    samples: t.samples.length,
    lossFraction: t.samples.length
      ? (t.samples.length - valid.length) / t.samples.length
      : null,
    inferenceMs: stats(
      t.samples
        .filter((s) => s.observation.source === "camera")
        .map((s) => s.observation.inferenceMs),
    ),
    trackingIntervalMs: stats(
      t.samples.map((s) => s.observation.intervalMs).filter((v) => v > 0),
    ),
    renderIntervalMs: stats(t.renderIntervals),
    estimatedRenderFps: t.renderIntervals.length
      ? 1000 / stats(t.renderIntervals).mean!
      : null,
    depthMm: stats(valid.map((s) => s.raw!.z)),
    depthSignedErrorMm: stats(depthError),
    depthAbsoluteErrorMm: stats(depthError.map(Math.abs)),
    relativeDepthError: stats(
      valid
        .filter((s) => s.referenceDistanceMm !== null)
        .map(
          (s) => (s.raw!.z - s.referenceDistanceMm!) / s.referenceDistanceMm!,
        ),
    ),
    rawStepMm: stats(jitter),
    filteredStepMm: stats(filteredJitter),
    stationarySpreadMm: {
      x: stats(valid.map((s) => s.raw!.x)),
      y: stats(valid.map((s) => s.raw!.y)),
      z: stats(valid.map((s) => s.raw!.z)),
    },
    lossEvents,
    processingMs: stats(
      t.samples.map((s) => s.observation.processingMs ?? NaN),
    ),
    note: "Step displacement includes intentional motion; only interpret as jitter during stationary trials. JS timings are not camera-to-photon latency.",
  };
}
export function replay(t: Trial, condition: Condition) {
  const filter = new PoseFilter();
  return {
    ...t,
    condition,
    samples: t.samples.map((s) => {
      if (s.observation.source !== "camera") return { ...s };
      const e = estimate(s.observation, condition, t.profile);
      const filteredCamera = e
        ? filter.update(
            e.eyeCamera,
            s.observation.time,
            condition.filter,
            condition.predictionMs,
          )
        : null;
      return {
        ...s,
        raw: e?.eyeScreen ?? null,
        filtered: filteredCamera
          ? transform(filteredCamera, t.profile.transform)
          : null,
        windowEyes: t.resolvedModels?.map((m) =>
          e ? modelEye(e.eyeCamera, m) : null,
        ),
        windowFilteredEyes: t.resolvedModels?.map((m) =>
          filteredCamera ? modelEye(filteredCamera, m) : null,
        ),
        faceDepth: e?.faceDepth ?? null,
        irisDepth: e?.irisDepth ?? null,
      };
    }),
  };
}
export function paired(t: Trial, a: Condition, b: Condition) {
  if (t.samples.some((s) => s.observation.source !== "camera"))
    throw Error("Paired depth replay requires recorded camera observations");
  const aa = replay(t, a),
    bb = replay(t, b),
    differences: number[] = [];
  for (let i = 0; i < t.samples.length; i++) {
    const ref = t.samples[i].referenceDistanceMm,
      x = aa.samples[i].raw,
      y = bb.samples[i].raw;
    if (ref !== null && x && y)
      differences.push(Math.abs(y.z - ref) - Math.abs(x.z - ref));
  }
  return {
    configurations: { a, b },
    windowAgreement: modelAgreement(t),
    profileId: t.profile.id,
    a: summarize(aa),
    b: summarize(bb),
    matchedIndependentErrors: differences.length,
    deltaAbsoluteDepthMm: stats(differences),
    bootstrap95: bootstrap(differences),
    interpretation:
      "B minus A absolute error. Negative favors B. Frame bootstrap assumes independent samples; temporal autocorrelation makes this optimistic. Prefer independent trial-level replications.",
  };
}
export function modelAgreement(t: Trial) {
  return [1, 2].flatMap((i) => {
    if (!t.windowModels?.[i]) return [];
    const deltas = t.samples.flatMap((s) =>
      s.windowEyes?.[0] && s.windowEyes[i]
        ? [sub(s.windowEyes[i]!, s.windowEyes[0]!)]
        : [],
    );
    return [
      {
        window: i === 1 ? "B" : "Inspection",
        reference: "A",
        matchedSamples: deltas.length,
        xMm: stats(deltas.map((d) => d.x)),
        yMm: stats(deltas.map((d) => d.y)),
        zMm: stats(deltas.map((d) => d.z)),
        displacementMm: stats(deltas.map(norm)),
        note: "Model agreement on identical observations; not independent physical accuracy.",
      },
    ];
  });
}
export function bootstrap(values: number[], seed = 1234) {
  if (values.length < 5) return null;
  let s = seed;
  const random = () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const means = Array.from(
    { length: 600 },
    () =>
      values.reduce(
        (sum) => sum + values[Math.floor(random() * values.length)],
        0,
      ) / values.length,
  );
  return [percentile(means, 0.025), percentile(means, 0.975)];
}
export function csv(trials: Trial[]) {
  const rows = [
    [
      "trial",
      "time_ms",
      "source",
      "display",
      "window_a_device",
      "window_b_device",
      "inspection_device",
      "window_a_card",
      "window_b_card",
      "window_a_gaze",
      "window_b_gaze",
      "inspection_card",
      "inspection_gaze",
      "depth",
      "filter",
      "x_mm",
      "y_mm",
      "z_mm",
      "filtered_x",
      "filtered_y",
      "filtered_z",
      "window_b_x",
      "window_b_y",
      "window_b_z",
      "inspection_x",
      "inspection_y",
      "inspection_z",
      "face_depth",
      "iris_depth",
      "reference_mm",
      "inference_ms",
      "detected",
    ],
  ];
  for (const t of trials)
    for (const s of t.samples)
      rows.push([
        t.id,
        String(s.observation.time),
        s.observation.source,
        t.profile.screenMode,
        t.windowModels?.[0]?.device ?? "",
        t.windowModels?.[1]?.device ?? "",
        t.windowModels?.[2]?.device ?? "",
        String(t.windowModels?.[0]?.card ?? ""),
        String(t.windowModels?.[1]?.card ?? ""),
        String(t.windowModels?.[0]?.gaze ?? ""),
        String(t.windowModels?.[1]?.gaze ?? ""),
        String(t.windowModels?.[2]?.card ?? ""),
        String(t.windowModels?.[2]?.gaze ?? ""),
        t.condition.depth,
        t.condition.filter,
        ...(["x", "y", "z"] as (keyof Vec3)[]).map((k) =>
          String(s.raw?.[k] ?? ""),
        ),
        ...(["x", "y", "z"] as (keyof Vec3)[]).map((k) =>
          String(s.filtered?.[k] ?? ""),
        ),
        ...(["x", "y", "z"] as (keyof Vec3)[]).map((k) =>
          String(s.windowEyes?.[1]?.[k] ?? ""),
        ),
        ...(["x", "y", "z"] as (keyof Vec3)[]).map((k) =>
          String(s.windowEyes?.[2]?.[k] ?? ""),
        ),
        String(s.faceDepth ?? ""),
        String(s.irisDepth ?? ""),
        String(s.referenceDistanceMm ?? ""),
        String(s.observation.inferenceMs),
        String(s.observation.detected),
      ]);
  return rows
    .map((r) => r.map((v) => '"' + v.replaceAll('"', '""') + '"').join(","))
    .join("\n");
}
