import type { Profile, Transform, Viewport, Vec3 } from "../types";
import { cssRect, defaultTransform, NOMINAL_SCALE, transform } from "./math";

// A generic prior, deliberately independent of the iPhone reference geometry.
// It is a sensitivity baseline, not a measured physical pixel pitch.
export const UNKNOWN_SCALE = 0.18;
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
};

export function savedGazeDelta(
  profile: Profile,
): { x: number; y: number } | null {
  const gaze = profile.gaze as
    | {
        accepted?: boolean;
        delta?: { x?: number; y?: number };
        validationBefore?: number;
        validationAfter?: number;
      }
    | undefined;
  return gaze?.accepted &&
    Number.isFinite(gaze.delta?.x) &&
    Number.isFinite(gaze.delta?.y) &&
    Math.abs(gaze.delta!.x!) <= 15 &&
    Math.abs(gaze.delta!.y!) <= 15 &&
    Number.isFinite(gaze.validationBefore) &&
    Number.isFinite(gaze.validationAfter) &&
    gaze.validationBefore! > 0 &&
    gaze.validationAfter! < gaze.validationBefore! * 0.95 &&
    gaze.validationAfter! <= 10
    ? { x: gaze.delta!.x!, y: gaze.delta!.y! }
    : null;
}

export function resolveModel(
  selection: WindowModel,
  profile: Profile,
  current: Viewport,
): ResolvedModel {
  const mmPerCss =
    selection.card && profile.cards.length
      ? profile.cards.at(-1)!.mmPerCss
      : selection.device === "reference"
        ? NOMINAL_SCALE
        : UNKNOWN_SCALE;
  const viewport = {
    ...current,
    // Placement is an explicit screen-relative assumption. The unknown
    // baseline starts at zero rather than borrowing the reference profile.
    originX: selection.device === "reference" ? profile.viewport.originX : 0,
    originY: selection.device === "reference" ? profile.viewport.originY : 0,
  };
  const base =
    selection.device === "reference"
      ? defaultTransform(current.screenHeight * NOMINAL_SCALE)
      : {
          ...defaultTransform(current.screenHeight * mmPerCss),
          translation: { x: 0, y: (current.screenHeight * mmPerCss) / 2, z: 0 },
          provenance:
            "assumed generic front camera at display top center; zero depth offset",
        };
  // Preserve explicitly entered reference placement, but never transfer it
  // into the unknown baseline.
  const cameraToScreen =
    selection.device === "reference" &&
    profile.transform.provenance.startsWith("user-entered")
      ? structuredClone(profile.transform)
      : base;
  const delta = selection.gaze ? savedGazeDelta(profile) : null;
  if (delta) {
    cameraToScreen.translation.x += delta.x;
    cameraToScreen.translation.y += delta.y;
    cameraToScreen.provenance +=
      "; gaze-fit tx/ty correction (other scale conditions are extrapolations)";
  }
  return {
    mmPerCss,
    scaleSource:
      selection.card && profile.cards.length
        ? "calibrated ID-1 card"
        : selection.device === "reference"
          ? "reference nominal iPhone 16 Pro"
          : "generic 0.18 mm/CSS px assumption",
    cameraToScreen,
    transformSource: cameraToScreen.provenance,
    viewport,
  };
}

export function modelEye(eyeCamera: Vec3, model: ResolvedModel): Vec3 {
  return transform(eyeCamera, model.cameraToScreen);
}

export function modelBounds(
  rect: { left: number; top: number; right: number; bottom: number },
  model: ResolvedModel,
) {
  return cssRect(rect, model.mmPerCss, model.viewport);
}
