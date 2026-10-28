export type Vec3 = { x: number; y: number; z: number };
export type Mat3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type Transform = {
  rotation: Mat3;
  translation: Vec3;
  provenance: string;
};
export type Rect = { left: number; right: number; bottom: number; top: number };
export type Landmark = { x: number; y: number; z: number };
export type Intrinsics = {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
  distortion: number[];
  orientation: "portrait" | "landscape";
  provenance: string;
  uncertainty: string;
  source: "assumed" | "reference";
  configuration?: Record<string, unknown>;
};
export type Viewport = {
  screenWidth: number;
  screenHeight: number;
  width: number;
  height: number;
  dpr: number;
  scale: number;
  offsetLeft: number;
  offsetTop: number;
  orientation: string;
  originX: number;
  originY: number;
};
export type CardTrial = {
  id: string;
  timestamp: string;
  widthCss: number;
  initialWidthCss: number;
  mmPerCss: number;
  durationMs: number;
  viewport: Viewport;
};
export type Profile = {
  version: 1;
  id: string;
  name: string;
  timestamp: string;
  screenMode: "nominal" | "generic" | "card";
  mmPerCss: number;
  viewport: Viewport;
  transform: Transform;
  intrinsics?: Intrinsics;
  cards: CardTrial[];
  gaze?: unknown;
};
export type Condition = {
  display: "nominal" | "generic" | "card";
  depth: "face" | "iris-assumed" | "iris-reference" | "fusion";
  filter: "none" | "euro" | "alpha-beta";
  rendering: "coupled" | "static" | "naive";
  scene: "cube" | "cubes" | "tunnel" | "wireframe";
  irisDiameter: number;
  focalScale: number;
  faceScale: number;
  distortion: boolean;
  predictionMs: number;
};
export type Observation = {
  time: number;
  source: "camera" | "simulated";
  matrix: number[] | null;
  landmarks: Landmark[];
  width: number;
  height: number;
  inferenceMs: number;
  processingMs?: number;
  cameraSettings?: Record<string, unknown>;
  intervalMs: number;
  detected: boolean;
  quality: number | null;
};
export type Estimate = {
  eyeCamera: Vec3;
  eyeScreen: Vec3;
  left: Vec3;
  right: Vec3;
  faceDepth: number;
  irisDepth: number | null;
  rotation: Vec3;
  quality: string;
  provenance: string;
};
export type Sample = {
  observation: Observation;
  raw: Vec3 | null;
  filtered: Vec3 | null;
  faceDepth: number | null;
  irisDepth: number | null;
  referenceDistanceMm: number | null;
  projection: Rect[];
};
export type Trial = {
  version: 1;
  id: string;
  label: string;
  start: string;
  end?: string;
  condition: Condition;
  profile: Profile;
  diagnostics: unknown;
  samples: Sample[];
  renderIntervals: number[];
  ratings?: number[];
  comment?: string;
  referenceProvenance: string;
  durationMs?: number;
  blindCode?: string;
};
