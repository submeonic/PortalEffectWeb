import type { Profile, Transform, Viewport, Vec3, Condition } from "../types";
import {
  cssRect,
  defaultTransform,
  NOMINAL_SCALE,
  transform,
  displayCompatible,
} from "./math";
import type { fitTranslation } from "../optimization/gaze-fit";

// CSS reference pixel is a generic prior, NOT a browser measurement of pitch.
// No manufacturer measurements or device detection enter this branch.
export const UNKNOWN_SCALE = 25.4 / 96;
export type WindowModel = {
  device: "reference" | "unknown";
  card: boolean;
  gaze: boolean;
};
export type ResolvedModel = {
  mmPerCss: number;
  scaleSource: string;
  cameraToScreen: Transform;
  transformSource: string;
  viewport: Viewport;
  gazeApplied: boolean;
  intrinsicReference?: Profile["intrinsics"];
};
export type GazeFit = ReturnType<typeof fitTranslation>;
export type SavedGaze = {
  version: 2;
  timestamp: string;
  fits: Record<string, { context: string; fit: GazeFit }>;
  evidence: unknown;
  cameraSignature?: string;
};
export const modelKey = (s: WindowModel) =>
  `${s.device}:${s.card ? "card" : "baseline"}`;
export function cardAvailable(p: Profile, v: Viewport) {
  const card = p.cards.at(-1);
  return !!card && displayCompatible(card.viewport, v);
}
export function baseModel(
  s: WindowModel,
  p: Profile,
  v: Viewport,
): ResolvedModel {
  const calibrated = s.card && cardAvailable(p, v);
  const mmPerCss = calibrated
    ? p.cards.at(-1)!.mmPerCss
    : s.device === "reference"
      ? NOMINAL_SCALE
      : UNKNOWN_SCALE;
  const placement = p.placement;
  const viewport = {
    ...v,
    originX:
      placement?.originX ?? (s.device === "reference" ? p.viewport.originX : 0),
    originY:
      placement?.originY ?? (s.device === "reference" ? p.viewport.originY : 0),
  };
  const cameraToScreen: Transform =
    s.device === "reference"
      ? p.transform.provenance.startsWith("user-entered")
        ? structuredClone(p.transform)
        : defaultTransform(v.screenHeight * NOMINAL_SCALE)
      : {
          rotation: [-1, 0, 0, 0, -1, 0, 0, 0, 1],
          translation: { x: 0, y: (v.screenHeight * mmPerCss) / 2, z: 0 },
          provenance:
            "assumed generic front camera at display top center; zero depth offset",
        };
  return {
    mmPerCss,
    cameraToScreen,
    viewport,
    gazeApplied: false,
    scaleSource: calibrated
      ? "calibrated ID-1 card"
      : s.device === "reference"
        ? "reference nominal iPhone 16 Pro (460 ppi, 3 device px/CSS px)"
        : "assumed CSS reference pixel: 25.4/96 mm; actual physical pitch unknown",
    transformSource: cameraToScreen.provenance,
    intrinsicReference: p.intrinsics,
  };
}
export function gazeContext(model: ResolvedModel, c?: Condition) {
  const v = model.viewport;
  return JSON.stringify({
    mmPerCss: model.mmPerCss,
    transform: model.cameraToScreen,
    screen: [v.screenWidth, v.screenHeight, v.dpr, v.orientation, v.scale],
    origin: [v.originX, v.originY],
    depth: c
      ? [
          c.depth,
          c.faceScale,
          c.irisDiameter,
          c.focalScale,
          c.distortion,
          c.depth === "iris-reference" ? model.intrinsicReference : null,
        ]
      : null,
  });
}
export function savedGazeFit(
  s: WindowModel,
  p: Profile,
  v: Viewport,
  c?: Condition,
  camera?: string,
): GazeFit | null {
  const saved = p.gaze as SavedGaze | undefined;
  if (camera && saved?.cameraSignature && camera !== saved.cameraSignature)
    return null;
  const entry = saved?.version === 2 ? saved.fits?.[modelKey(s)] : null;
  if (!entry || entry.context !== gazeContext(baseModel(s, p, v), c))
    return null;
  const f = entry.fit;
  return f?.accepted &&
    Number.isFinite(f.delta?.x) &&
    Number.isFinite(f.delta?.y) &&
    Math.abs(f.delta.x) <= 15 &&
    Math.abs(f.delta.y) <= 15 &&
    f.validationBefore !== null &&
    f.validationAfter !== null &&
    Number.isFinite(f.validationBefore) &&
    Number.isFinite(f.validationAfter) &&
    f.validationAfter < f.validationBefore * 0.95 &&
    f.validationAfter <= 10 &&
    f.validationBefore - f.validationAfter >= 1
    ? f
    : null;
}
export function resolveModel(
  s: WindowModel,
  p: Profile,
  v: Viewport,
  c?: Condition,
  camera?: string,
): ResolvedModel {
  const model = baseModel(s, p, v);
  const fit = s.gaze ? savedGazeFit(s, p, v, c, camera) : null;
  if (fit) {
    model.cameraToScreen.translation.x += fit.delta.x;
    model.cameraToScreen.translation.y += fit.delta.y;
    model.cameraToScreen.provenance +=
      "; calibrated bounded gaze-ray tx/ty (held-out residual validated, metric accuracy unverified)";
    model.transformSource = model.cameraToScreen.provenance;
    model.gazeApplied = true;
  }
  return model;
}
export const modelEye = (eyeCamera: Vec3, model: ResolvedModel) =>
  transform(eyeCamera, model.cameraToScreen);
export const modelBounds = (
  rect: { left: number; top: number; right: number; bottom: number },
  model: ResolvedModel,
) => cssRect(rect, model.mmPerCss, model.viewport);

export function cameraSignature(
  width: number,
  height: number,
  settings: Record<string, unknown> = {},
) {
  return JSON.stringify({
    width,
    height,
    deviceId: settings.deviceId ?? null,
    facingMode: settings.facingMode ?? null,
    resizeMode: settings.resizeMode ?? null,
    aspectRatio: settings.aspectRatio ?? null,
  });
}
