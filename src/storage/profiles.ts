import type { Profile, Viewport, Condition } from "../types";
import { defaultTransform, NOMINAL_SCALE } from "../geometry/math";
import { validateIntrinsics } from "../geometry/intrinsics";
export const DEFAULT_CONDITION: Condition = {
  display: "nominal",
  depth: "face",
  filter: "euro",
  rendering: "coupled",
  scene: "cube",
  irisDiameter: 11.7,
  focalScale: 1,
  faceScale: 1,
  distortion: true,
  predictionMs: 0,
};
export function newProfile(v: Viewport): Profile {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: "iPhone 16 Pro · nominal",
    timestamp: new Date().toISOString(),
    screenMode: "nominal",
    mmPerCss: NOMINAL_SCALE,
    viewport: v,
    transform: defaultTransform(),
    cards: [],
  };
}
export function validateProfile(value: unknown): Profile {
  const p = value as Profile;
  if (
    !p ||
    p.version !== 1 ||
    !p.id ||
    !p.viewport ||
    !Array.isArray(p.cards) ||
    !Number.isFinite(p.mmPerCss) ||
    p.mmPerCss < 0.03 ||
    p.mmPerCss > 2 ||
    !["nominal", "generic", "card"].includes(p.screenMode)
  )
    throw Error("Invalid version 1 calibration profile");
  const t = p.transform;
  if (
    !t ||
    t.rotation.length !== 9 ||
    !t.rotation.every(Number.isFinite) ||
    !Object.values(t.translation).every(Number.isFinite) ||
    !t.provenance
  )
    throw Error("Invalid camera-to-screen transform");
  const r = t.rotation;
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++) {
      let d = 0;
      for (let k = 0; k < 3; k++) d += r[a * 3 + k] * r[b * 3 + k];
      if (Math.abs(d - (a === b ? 1 : 0)) > 0.001)
        throw Error("Transform must have orthonormal rotation");
    }
  const det =
    r[0] * (r[4] * r[8] - r[5] * r[7]) -
    r[1] * (r[3] * r[8] - r[5] * r[6]) +
    r[2] * (r[3] * r[7] - r[4] * r[6]);
  if (Math.abs(det - 1) > 0.001)
    throw Error("Rotation must preserve handedness");
  if (p.intrinsics) p.intrinsics = validateIntrinsics(p.intrinsics);
  return p;
}
export function saveProfile(p: Profile) {
  localStorage.setItem("portal.profile.v1", JSON.stringify(p));
}
export function loadProfile(): Profile | null {
  try {
    const s = localStorage.getItem("portal.profile.v1");
    return s ? validateProfile(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}
export function download(
  name: string,
  data: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
