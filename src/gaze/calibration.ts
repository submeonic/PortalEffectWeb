import type { Observation, Vec3, Viewport, Condition, Profile } from "../types";
import { estimate } from "../tracking/pose";
import { cssPoint, norm, sub } from "../geometry/math";
import {
  cameraSignature,
  baseModel,
  gazeContext,
  modelKey,
  type SavedGaze,
  type WindowModel,
} from "../geometry/coordinate-model";
import {
  fitTranslation,
  residual,
  type GazeObservation,
} from "../optimization/gaze-fit";
import { GazeProvider } from "./provider";
import { eyesOpen, GAZE_PROVENANCE } from "./math";

export type Fixation = GazeObservation & {
  targetCss: { x: number; y: number };
  time: number;
  inferenceMs: number;
  observation: Observation;
};
export const TARGETS = [
  { id: "upper-right", x: 0.9, y: 0.1 },
  { id: "lower-right", x: 0.9, y: 0.9 },
  { id: "lower-left", x: 0.1, y: 0.9 },
  { id: "upper-left", x: 0.1, y: 0.1 },
  { id: "center", x: 0.5, y: 0.5 },
  { id: "center-new-pose", x: 0.5, y: 0.5 },
];
export type CollectionStatus = {
  index: number;
  count: number;
  message: string;
  ready: boolean;
};
// Target identity is captured BEFORE inference; no late result can migrate to
// the next target. Selection never depends on gaze-to-target residual.
export class GazeCalibration {
  provider = new GazeProvider();
  observations: Fixation[] = [];
  rejected: Record<string, number> = {};
  index = 0;
  running = false;
  ready = false;
  private started = 0;
  private lastSample = 0;
  private previous: { eye: Vec3; time: number } | null = null;
  private firstCenter: Vec3 | null = null;
  private camera = "";
  private targetCss = { x: 0, y: 0 };
  private collectedAt = 0;
  private runStarted = performance.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    readonly profile: Profile,
    readonly condition: Condition,
    readonly viewport: Viewport,
    readonly status: (status: CollectionStatus) => void,
    readonly failed: (message: string) => void,
    readonly complete: (saved: SavedGaze) => void,
  ) {}
  async initialize() {
    this.running = true;
    await this.provider.initialize();
    if (!this.running) return;
    this.ready = true;
    this.status({
      index: 0,
      count: 0,
      message:
        "Look at the dot. Keep your head still while samples accumulate.",
      ready: true,
    });
  }
  setTarget(x: number, y: number) {
    this.targetCss = { x, y };
    this.started = performance.now();
    this.collectedAt = 0;
    this.previous = null;
    if (!this.timer)
      this.timer = setInterval(() => {
        if (this.running && performance.now() - this.started > 30000) {
          this.failed(
            "Not enough stable samples in 30 seconds. Check lighting, keep the whole face visible, and retry.",
          );
          this.dispose();
        }
      }, 500);
  }
  private reject(reason: string) {
    this.rejected[reason] = (this.rejected[reason] ?? 0) + 1;
    this.report(reason);
  }
  private report(message: string) {
    this.status({
      index: this.index,
      count: this.count(),
      message,
      ready: this.ready,
    });
  }
  private count() {
    return this.observations.filter(
      (o) => o.targetId === TARGETS[this.index].id,
    ).length;
  }
  async sample(o: Observation, frame: HTMLCanvasElement) {
    if (
      !this.running ||
      !this.ready ||
      o.time < this.started + 900 ||
      o.time - this.lastSample < 100
    )
      return;
    this.lastSample = o.time;
    const signature = cameraSignature(o.width, o.height, o.cameraSettings);
    if (this.camera && signature !== this.camera) {
      this.failed("Camera format changed during calibration. Retry.");
      this.dispose();
      return;
    }
    this.camera = signature;
    const e = estimate(o, this.condition, this.profile);
    if (!e || !eyesOpen(o.landmarks, o.width, o.height))
      return this.reject("Waiting for a visible face and open eyes");
    if (
      Math.abs(e.rotation.x) > 0.55 ||
      Math.abs(e.rotation.y) > 0.55 ||
      Math.abs(e.rotation.z) > 0.4
    )
      return this.reject("Face the display with a moderate head angle");
    const prior = this.previous;
    this.previous = { eye: e.eyeCamera, time: o.time };
    if (
      prior &&
      norm(sub(e.eyeCamera, prior.eye)) /
        Math.max(0.001, (o.time - prior.time) / 1000) >
        65
    )
      return this.reject("Hold your head steady");
    if (
      this.index === 5 &&
      this.firstCenter &&
      norm(sub(e.eyeCamera, this.firstCenter)) < 15
    )
      return this.reject(
        "Move your head about 2–3 cm sideways, then hold still and look at the center",
      );
    const index = this.index,
      targetCss = { ...this.targetCss };
    const result = await this.provider.infer(frame, o.landmarks);
    if (!this.running || index !== this.index) return;
    if (!result || result.direction.z > -0.35)
      return this.reject("Face crop or forward gaze unavailable");
    this.observations.push({
      eye: e.eyeCamera,
      direction: result.direction,
      target: { x: 0, y: 0, z: 0 },
      targetCss,
      heldOut: index >= 4,
      quality: 1,
      targetId: TARGETS[index].id,
      provenance: GAZE_PROVENANCE,
      time: o.time,
      inferenceMs: result.inferenceMs,
      observation: structuredClone(o),
    });
    if (!this.collectedAt) this.collectedAt = o.time;
    const count = this.count();
    this.report(`Target ${index + 1}/6 · ${count}/12 samples`);
    if (count >= 12 && o.time - this.collectedAt >= 1800) {
      if (index === 4) this.firstCenter = { ...e.eyeCamera };
      if (index === 5) {
        const evidence = {
          observations: this.observations,
          rejected: this.rejected,
          viewport: this.viewport,
          condition: this.condition,
          loadMs: this.provider.loadMs,
          durationMs: performance.now() - this.runStarted,
          model: GAZE_PROVENANCE,
          targets:
            "visible viewport corners then center twice; second center at a different head position",
        };
        const bundle = fitModels(
          this.observations,
          this.profile,
          this.viewport,
          this.condition,
          evidence,
        );
        bundle.cameraSignature = this.camera;
        this.dispose();
        this.complete(bundle);
        return;
      }
      this.index++;
      this.report(
        this.index === 5
          ? "Move your head about 2–3 cm sideways, then look at the center again."
          : "Look at the next dot.",
      );
    }
  }
  dispose() {
    this.running = this.ready = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.provider.dispose();
  }
}
export function fitModels(
  observations: Fixation[],
  p: Profile,
  v: Viewport,
  c: Condition,
  evidence: unknown,
): SavedGaze {
  const fits: SavedGaze["fits"] = {};
  for (const device of ["reference", "unknown"] as const)
    for (const card of [false, true]) {
      if (card && !p.cards.length) continue;
      const selection: WindowModel = { device, card, gaze: false };
      const model = baseModel(selection, p, v);
      const rays = observations.map((o) => ({
        ...o,
        target: cssPoint(
          o.targetCss.x,
          o.targetCss.y,
          model.mmPerCss,
          model.viewport,
        ),
      }));
      let fit = fitTranslation(rays, model.cameraToScreen);
      // Each independently collected center must pass, not just their pooled RMS.
      for (const id of new Set(
        rays.filter((o) => o.heldOut).map((o) => o.targetId),
      )) {
        const subset = rays.filter((o) => o.heldOut && o.targetId === id);
        const rms = (t: typeof fit.transform) =>
          Math.sqrt(
            subset.reduce((s, o) => s + residual(o, t) ** 2, 0) / subset.length,
          );
        const before = rms(fit.baseline),
          after = rms(fit.transform);
        if (
          fit.accepted &&
          (after >= before * 0.95 || before - after < 1 || after > 10)
        )
          fit = {
            ...fit,
            accepted: false,
            reason: `Independent ${id} validation did not meet 5%, 1 mm and ≤10 mm criteria`,
          };
      }
      fits[modelKey(selection)] = { context: gazeContext(model, c), fit };
    }
  return { version: 2, timestamp: new Date().toISOString(), fits, evidence };
}
