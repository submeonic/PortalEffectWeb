import "./style.css";
import { validateCondition, validateTrials } from "./storage/validation";
import { template } from "./ui/template";
import { Portal } from "./rendering/portal";
import { Capture } from "./camera/capture";
import { Tracker } from "./tracking/tracker";
import { Diagnostics, viewport } from "./camera/diagnostics";
import { estimate } from "./tracking/pose";
import { PoseFilter } from "./filtering/filters";
import {
  cssRect,
  NOMINAL_SCALE,
  CARD,
  cardScale,
  displayCompatible,
} from "./geometry/math";
import { validateIntrinsics, compatible } from "./geometry/intrinsics";
import {
  newProfile,
  loadProfile,
  saveProfile,
  validateProfile,
  download,
  DEFAULT_CONDITION,
} from "./storage/profiles";
import { stats, summarize, paired, csv } from "./experiments/metrics";
import { syntheticReport } from "./simulation/synthetic";
import { fitTranslation, type GazeObservation } from "./optimization/gaze-fit";
import type {
  Vec3,
  Condition,
  Trial,
  Observation,
  Estimate,
  Profile,
} from "./types";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
$("app").innerHTML = template;
let profile = loadProfile() ?? newProfile(viewport());
let condition: Condition = {
  ...DEFAULT_CONDITION,
  display: profile.screenMode,
};
const diagnostics = new Diagnostics(),
  capture = new Capture(),
  tracker = new Tracker(),
  filter = new PoseFilter();
let live = false,
  starting = false,
  lastGood = 0,
  lastEstimate: Estimate | null = null,
  eye: Vec3 = { x: 0, y: 0, z: 400 },
  current: Trial | null = null,
  trials: Trial[] = [],
  lastRender = 0,
  lastSynthetic = 0;
let renderIntervals: number[] = [],
  inferences: number[] = [],
  activePage = "demo",
  invalidated = false,
  placementInvalid = false,
  cardStarted = 0,
  initialWidth = 290,
  trialStarted = 0;
let gazeFit: ReturnType<typeof fitTranslation> | null = null,
  blindOrder: Condition["rendering"][] = [],
  blindIndex = 0,
  blindOriginal: Condition | null = null;
const preview = $<HTMLVideoElement>("camera-preview");
// Keep the capture element outside display:none research panels. The visible
// mirrored preview is a separate consumer of the same stream.
const video = document.createElement("video");
video.autoplay = true;
video.muted = true;
video.playsInline = true;
video.className = "capture-video";
video.setAttribute("aria-hidden", "true");
document.body.append(video);
const portals: Portal[] = [];
try {
  portals.push(new Portal($("portal-main")), new Portal($("portal-second")));
} catch (e) {
  notify("WebGL unavailable: " + String(e));
  $("tracking-state").textContent =
    "WebGL unavailable. Calibration and numerical experiments remain usable.";
}
function notify(message: string) {
  $("toast").textContent = message;
  $("toast").classList.add("visible");
  window.setTimeout(() => $("toast").classList.remove("visible"), 6000);
  diagnostics.event("notice", message);
}
function view() {
  return viewport(profile.viewport.originX, profile.viewport.originY);
}
function scale() {
  return condition.display === "nominal"
    ? NOMINAL_SCALE
    : condition.display === "generic"
      ? 0.18
      : profile.mmPerCss;
}
function save() {
  try {
    saveProfile(profile);
  } catch {
    notify(
      "Browser storage unavailable. Export your calibration before closing.",
    );
  }
}
function go(page: string) {
  if (page === "diagnostics" && capture.stream) {
    preview.srcObject = capture.stream;
    void preview
      .play()
      .catch((e) => diagnostics.event("preview-error", String(e)));
  } else preview.pause();
  activePage = page;
  document
    .querySelectorAll(".page")
    .forEach((el) => el.classList.toggle("active", el.id === "page-" + page));
  document
    .querySelectorAll<HTMLButtonElement>("[data-page]")
    .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  if (page === "demo") portals.forEach((p) => p.recenter());
}
document
  .querySelectorAll<HTMLButtonElement>("[data-page]")
  .forEach((b) => (b.onclick = () => go(b.dataset.page!)));
function sync() {
  for (const id of [
    "scene",
    "rendering",
    "filter",
    "depth",
    "display",
  ] as const)
    $<HTMLSelectElement>(id).value = condition[id];
  $<HTMLInputElement>("iris-diameter").value = String(condition.irisDiameter);
  $<HTMLInputElement>("face-scale").value = String(condition.faceScale);
  $<HTMLInputElement>("focal-scale").value = String(condition.focalScale);
  $<HTMLInputElement>("distortion").checked = condition.distortion;
  for (const k of ["x", "y", "z"] as const)
    $<HTMLInputElement>("camera-" + k).value = String(
      profile.transform.translation[k],
    );
  $<HTMLInputElement>("origin-x").value = String(profile.viewport.originX);
  $<HTMLInputElement>("origin-y").value = String(profile.viewport.originY);
  $("scale-value").textContent = scale().toFixed(5);
  $("calibration-status").textContent =
    condition.display === "card"
      ? `Measured ${profile.timestamp}. Difference from nominal: ${((scale() / NOMINAL_SCALE - 1) * 100).toFixed(2)}%. This is agreement, not absolute accuracy.`
      : "Nominal or generic geometry is an assumption, not a measurement.";
  $("intrinsics-status").textContent = profile.intrinsics
    ? `${profile.intrinsics.width} × ${profile.intrinsics.height} · ${profile.intrinsics.provenance}`
    : "No independent intrinsic reference supplied.";
  const s = stats(profile.cards.map((c) => c.mmPerCss));
  $("card-results").textContent =
    `${s.n} card measurements · mean ${s.mean?.toFixed(5) ?? "—"} mm/px · SD ${s.sd?.toFixed(5) ?? "—"}`;
  portals.forEach((p) => p.setScene(condition.scene));
}
function changed() {
  lastEstimate = null;
  if (current) finishTrial();
  filter.reset();
  portals.forEach((p) => p.recenter());
  sync();
  diagnostics.event("condition", condition);
}
for (const id of ["scene", "rendering", "filter", "depth", "display"] as const)
  $<HTMLSelectElement>(id).onchange = () => {
    const value = $<HTMLSelectElement>(id).value;
    if (id === "display" && value === "card" && !profile.cards.length) {
      notify("Take a card measurement first.");
      sync();
      return;
    }
    if (id === "depth" && value === "iris-reference" && !profile.intrinsics) {
      notify("Import a compatible intrinsic reference first.");
      sync();
      return;
    }
    (condition as unknown as Record<string, string>)[id] = value;
    if (id === "display") {
      profile.screenMode = condition.display;
      save();
    }
    changed();
  };
for (const [id, key] of [
  ["iris-diameter", "irisDiameter"],
  ["focal-scale", "focalScale"],
  ["face-scale", "faceScale"],
] as const)
  $<HTMLInputElement>(id).onchange = () => {
    const el = $<HTMLInputElement>(id);
    if (!el.checkValidity() || !Number.isFinite(el.valueAsNumber)) {
      sync();
      return;
    }
    condition[key] = el.valueAsNumber;
    changed();
  };
$<HTMLInputElement>("distortion").onchange = () => {
  condition.distortion = $<HTMLInputElement>("distortion").checked;
  changed();
};
for (const axis of ["x", "y", "z"])
  $<HTMLInputElement>("s" + axis).oninput = () => {
    $("s" + axis + "-value").textContent =
      $<HTMLInputElement>("s" + axis).value + " mm";
  };
function stopCamera() {
  capture.stop();
  preview.pause();
  preview.srcObject = null;
  video.srcObject = null;
  tracker.stop();
  live = false;
  invalidated = false;
  starting = false;
  filter.reset();
  $<HTMLButtonElement>("start-camera").disabled = false;
  $("start-camera").hidden = false;
  $("stop-camera").hidden = true;
  $("tracking-state").textContent = "Simulator ready. Camera is off.";
  diagnostics.event("camera-stop");
  if (current) finishTrial();
}
$("start-camera").onclick = async () => {
  if (starting || live) return;
  starting = true;
  $<HTMLButtonElement>("start-camera").disabled = true;
  $("tracking-state").textContent = "Requesting front camera…";
  const start = performance.now();
  try {
    const track = await capture.start(video);
    track.onended = () => {
      notify("Camera stream ended. Returning to the simulator.");
      stopCamera();
    };
    track.onmute = () => diagnostics.event("camera-muted");
    track.onunmute = () => diagnostics.event("camera-unmuted");
    $("tracking-state").textContent = "Loading local Face Landmarker…";
    await tracker.initialize();
    live = true;
    geometryChange();
    starting = false;
    lastGood = 0;
    $("start-camera").hidden = true;
    $("stop-camera").hidden = false;
    diagnostics.event("camera-ready", {
      durationMs: performance.now() - start,
      settings: capture.settings,
      capabilities: capture.capabilities,
    });
    tracker.start(video, observe, (e) => {
      notify("Tracking stopped: " + String(e));
      stopCamera();
    });
  } catch (e) {
    stopCamera();
    notify("Could not start tracking: " + String(e));
  }
};
$("stop-camera").onclick = stopCamera;
function observe(o: Observation) {
  o.cameraSettings = capture.stream
    ?.getVideoTracks()[0]
    .getSettings() as Record<string, unknown>;
  inferences.push(o.inferenceMs);
  if (inferences.length > 600) inferences.shift();
  const intrinsicInvalid =
    condition.depth === "iris-reference" &&
    (!profile.intrinsics ||
      !compatible(
        profile.intrinsics,
        o.width,
        o.height,
        capture.stream?.getVideoTracks()[0].getSettings() as Record<
          string,
          unknown
        >,
      ));
  const result = intrinsicInvalid ? null : estimate(o, condition, profile);
  lastEstimate = result;
  let filtered: Vec3 | null = null;
  if (result) {
    if (o.time - lastGood > 500) filter.reset();
    lastGood = o.time;
    filtered = filter.update(
      result.eyeScreen,
      o.time,
      condition.filter,
      condition.predictionMs,
    );
    eye = filtered;
  } else {
    diagnostics.event("tracking-loss", {
      detected: o.detected,
      intrinsicInvalid,
    });
  }
  if (current) {
    current.samples.push({
      observation: o,
      raw: result?.eyeScreen ?? null,
      filtered,
      faceDepth: result?.faceDepth ?? null,
      irisDepth: result?.irisDepth ?? null,
      referenceDistanceMm: reference(),
      projection: portals.flatMap((p) => (p.bounds ? [p.bounds] : [])),
    });
    if (current.samples.length >= 900) {
      finishTrial();
      notify(
        "Trial reached 900 observations and was saved. Start another trial to continue.",
      );
    }
  }
  $("tracking-state").textContent = intrinsicInvalid
    ? "Reference profile does not match delivered camera configuration."
    : result
      ? "Face detected · approximate metric eye position"
      : "Face or selected depth unavailable · holding last view";
}
function reference() {
  const input = $<HTMLInputElement>("reference-distance");
  return input.value !== "" && input.checkValidity()
    ? input.valueAsNumber
    : null;
}
function animate(time: number) {
  requestAnimationFrame(animate);
  if (document.hidden) {
    lastRender = 0;
    return;
  }
  if (!live) {
    eye = {
      x: Number($<HTMLInputElement>("sx").value),
      y: Number($<HTMLInputElement>("sy").value),
      z: Number($<HTMLInputElement>("sz").value),
    };
  } else if (time - lastGood > 800) {
    eye = {
      ...eye,
      x: eye.x * 0.97,
      y: eye.y * 0.97,
      z: eye.z + (400 - eye.z) * 0.03,
    };
  }
  if (!live && current && time - lastSynthetic > 66) {
    lastSynthetic = time;
    const o: Observation = {
      time,
      source: "simulated",
      matrix: null,
      landmarks: [],
      width: 0,
      height: 0,
      inferenceMs: 0,
      intervalMs: 66,
      detected: true,
      quality: null,
    };
    current.samples.push({
      observation: o,
      raw: { ...eye },
      filtered: { ...eye },
      faceDepth: null,
      irisDepth: null,
      referenceDistanceMm: null,
      projection: portals.flatMap((p) => (p.bounds ? [p.bounds] : [])),
    });
    if (current.samples.length >= 900) finishTrial();
  }
  let rendered = false;
  if (activePage === "demo" && (!live || !invalidated)) {
    for (const p of portals) {
      const r = p.renderer.domElement.getBoundingClientRect();
      if (r.width && r.height && r.bottom > 0 && r.top < innerHeight) {
        p.render(eye, cssRect(r, scale(), view()), condition);
        rendered = true;
      }
    }
  }
  if (rendered) {
    if (lastRender) {
      const dt = time - lastRender;
      renderIntervals.push(dt);
      if (renderIntervals.length > 600) renderIntervals.shift();
      if (current && current.renderIntervals.length < 18000)
        current.renderIntervals.push(dt);
    }
    lastRender = time;
  } else {
    lastRender = 0;
  }
  $("eye-readout").textContent =
    `X ${eye.x.toFixed(0)} · Y ${eye.y.toFixed(0)} · Z ${eye.z.toFixed(0)} mm`;
}
requestAnimationFrame(animate);
function geometryChange() {
  const v = view();
  if (
    live &&
    condition.display === "card" &&
    (v.height !== profile.viewport.height || v.width !== profile.viewport.width)
  )
    placementInvalid = true;
  invalidated =
    !displayCompatible(profile.viewport, v) ||
    v.orientation.startsWith("landscape");
  if (condition.display !== "card")
    invalidated = v.scale !== 1 || v.orientation.startsWith("landscape");
  if (condition.display === "card" && placementInvalid) invalidated = true;
  if (!live) invalidated = false;
  diagnostics.event("viewport-change", v);
  if (current) finishTrial();
  if (invalidated)
    notify(
      "Calibrated rendering suspended: return to portrait and 100% zoom, or confirm content placement in Calibration after display changes.",
    );
  else if (live) {
    notify(
      "Viewport changed. Recheck content origin if Safari browser controls moved.",
    );
  }
}
window.addEventListener("resize", geometryChange);
window.visualViewport?.addEventListener("resize", geometryChange);
document.addEventListener("visibilitychange", () =>
  diagnostics.event("visibility", document.visibilityState),
);
video.addEventListener("resize", () => {
  diagnostics.event("camera-format", {
    width: video.videoWidth,
    height: video.videoHeight,
  });
  if (current) finishTrial();
});
$("second-toggle").addEventListener("toggle", () => portals[1]?.recenter());
function snapshot() {
  return {
    ...diagnostics.snapshot(),
    calibration: profile,
    condition,
    camera: {
      requested: capture.requested,
      settings:
        capture.stream?.getVideoTracks()[0].getSettings() ?? capture.settings,
      capabilities: capture.capabilities,
      width: video.videoWidth,
      height: video.videoHeight,
    },
    eye,
    estimate: lastEstimate,
    invalidated,
    portals: portals.map((p) => ({
      rect: p.renderer.domElement.getBoundingClientRect().toJSON(),
      metric: p.bounds,
      frustum: p.lastFrustum,
    })),
    performance: {
      renderIntervalMs: stats(renderIntervals),
      inferenceMs: stats(inferences),
      targetTrackingHz: tracker.targetHz,
      backend: tracker.delegate,
      fallbackReason: tracker.fallbackReason,
    },
    limitations: [
      "Viewport physical origin requires explicit measurement.",
      "MediaPipe canonical scale is estimated, not independent metric ground truth.",
      "JS duration is not camera-to-photon latency.",
    ],
  };
}
setInterval(() => {
  $("mode-label").textContent = invalidated
    ? "GEOMETRY SUSPENDED"
    : live
      ? "LIVE / APPROXIMATE GEOMETRY"
      : "SIMULATED VIEW";
  $("fps").textContent = renderIntervals.length
    ? (1000 / stats(renderIntervals).mean!).toFixed(1)
    : "—";
  const s = stats(inferences);
  $("inference").textContent = s.n
    ? `${s.median!.toFixed(1)} / ${s.p95!.toFixed(1)}`
    : "—";
  $("diag-state").textContent = live
    ? performance.now() - lastGood < 500
      ? "TRACKING"
      : "LOST"
    : "SIMULATED";
  $("delegate").textContent = live
    ? `${tracker.delegate} · target ${tracker.targetHz.toFixed(0)} Hz`
    : "Camera is off";
  if (activePage === "diagnostics")
    $("diagnostic-data").textContent = JSON.stringify(snapshot(), null, 2);
}, 700);
function cardUpdate() {
  const width = Number($<HTMLInputElement>("card-width").value);
  $("card-outline").style.width = width + "px";
  $("card-width-value").textContent = width.toFixed(1) + " CSS px";
}
function randomizeCard() {
  const max = Math.min(innerWidth - 48, 380);
  $<HTMLInputElement>("card-width").max = String(max);
  initialWidth = Math.min(max, 210 + Math.random() * 110);
  $<HTMLInputElement>("card-width").value = initialWidth.toFixed(1);
  cardStarted = performance.now();
  cardUpdate();
}
$("open-card").onclick = () => {
  if (current) finishTrial();
  if (view().scale !== 1) {
    notify("Return browser zoom to 100% before card calibration.");
    return;
  }
  randomizeCard();
  $<HTMLDialogElement>("card-dialog").showModal();
};
$("close-card").onclick = () => $<HTMLDialogElement>("card-dialog").close();
$("card-reset").onclick = randomizeCard;
$<HTMLInputElement>("card-width").oninput = cardUpdate;
for (const [id, d] of [
  ["card-minus", -0.5],
  ["card-plus", 0.5],
] as const)
  $(id).onclick = () => {
    $<HTMLInputElement>("card-width").value = String(
      Number($<HTMLInputElement>("card-width").value) + d,
    );
    cardUpdate();
  };
$("save-card").onclick = () => {
  const v = view();
  if (v.scale !== 1 || v.orientation.startsWith("landscape")) {
    notify("Card calibration requires portrait and 100% zoom.");
    return;
  }
  const width = $("card-outline").getBoundingClientRect().width,
    s = cardScale(width),
    timestamp = new Date().toISOString();
  profile.cards.push({
    id: crypto.randomUUID(),
    timestamp,
    widthCss: width,
    initialWidthCss: initialWidth,
    mmPerCss: s,
    durationMs: performance.now() - cardStarted,
    viewport: v,
  });
  profile = {
    ...profile,
    screenMode: "card",
    mmPerCss: s,
    timestamp,
    viewport: v,
  };
  condition.display = "card";
  invalidated = false;
  placementInvalid = false;
  save();
  changed();
  $<HTMLDialogElement>("card-dialog").close();
  notify("Card measurement saved. Repeat to assess consistency.");
};
$("save-placement").onclick = () => {
  const numbers = [
    "origin-x",
    "origin-y",
    "camera-x",
    "camera-y",
    "camera-z",
  ].map((id) => $<HTMLInputElement>(id).valueAsNumber);
  if (!numbers.every(Number.isFinite)) {
    notify("Placement values must be finite.");
    return;
  }
  if (current) finishTrial();
  profile.viewport = { ...view(), originX: numbers[0], originY: numbers[1] };
  profile.transform.translation = {
    x: numbers[2],
    y: numbers[3],
    z: numbers[4],
  };
  profile.transform.provenance =
    "user-entered placement; independent accuracy not established";
  invalidated = false;
  placementInvalid = false;
  save();
  changed();
  notify("Placement saved. Record the measurement method in your trial notes.");
};
$("export-profile").onclick = () =>
  download("portal-calibration.json", JSON.stringify(profile, null, 2));
function importFile(id: string, handler: (value: any) => void) {
  $<HTMLInputElement>(id).onchange = async () => {
    const input = $<HTMLInputElement>(id),
      file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 250_000_000) throw Error("File exceeds 250 MB");
      handler(JSON.parse(await file.text()));
    } catch (e) {
      notify("Import failed: " + String(e));
    }
    input.value = "";
  };
}
importFile("import-profile", (data) => {
  const validated = validateProfile(data);
  if (current) finishTrial();
  profile = validated;
  condition.display = profile.screenMode;
  save();
  changed();
  geometryChange();
  notify("Calibration profile imported.");
});
importFile("import-intrinsics", (data) => {
  const intrinsics = validateIntrinsics(data.intrinsics ?? data);
  if (current) finishTrial();
  profile.intrinsics = intrinsics;
  save();
  sync();
  notify(
    "Intrinsic reference imported. Exact delivered format will be checked.",
  );
});
importFile("import-gaze", (data) => {
  const observations = (data.observations ?? data) as GazeObservation[];
  if (
    !Array.isArray(observations) ||
    observations.some(
      (o) => !o.provenance || o.provenance.includes("simulated"),
    )
  )
    throw Error(
      "Supply genuine gaze observations with provenance, not simulated rays",
    );
  gazeFit = fitTranslation(observations, profile.transform);
  $("gaze-result").textContent = JSON.stringify(gazeFit, null, 2);
  $<HTMLButtonElement>("apply-gaze").disabled = !gazeFit.accepted;
});
$("apply-gaze").onclick = () => {
  if (!gazeFit?.accepted) return;
  if (current) finishTrial();
  if (JSON.stringify(profile.transform) !== JSON.stringify(gazeFit.baseline)) {
    notify("Baseline changed. Refit the gaze observations first.");
    return;
  }
  profile.gaze = gazeFit;
  profile.transform = gazeFit.transform;
  save();
  changed();
  $<HTMLButtonElement>("apply-gaze").disabled = true;
  notify(
    "Validated translation applied. Repeat with independent head positions.",
  );
};
const guides: Record<string, string> = {
  A: "Record 15 seconds stationary, then a separate 15-second lateral movement trial. Use nominal display and face-matrix depth.",
  B: "Complete at least five randomized card alignments. Export the calibration profile to compare scale variance and nominal agreement.",
  C: "Use an independent ruler at 250, 400 and 600 mm. Record stationary trials, then repeat with yaw and pitch. Replay face versus iris on identical observations.",
  D: "Capture with the exact reference stream. Compare iris-assumed and iris-reference in paired replay. Mark unavailable if no reference exists.",
  E: "Live gaze model not integrated. Import externally validated gaze rays under Calibration, reserve center samples, and repeat at new head positions.",
  F: "Three rendering variants are shuffled. Record and rate each before revealing labels. Keep scene, scale and movement instruction fixed.",
  G: "Camera startup and card durations are logged. Compare calibration effort against independent improvements; gaze timing is unavailable.",
};
$<HTMLSelectElement>("stage").onchange = () => {
  $("stage-guide").textContent = guides[$<HTMLSelectElement>("stage").value];
};
$("stage-guide").textContent = guides.A;
function startTrial(label?: string) {
  if (current) return;
  if (
    $<HTMLInputElement>("reference-distance").value &&
    !$<HTMLInputElement>("reference-distance").checkValidity()
  ) {
    notify("Reference distance must be 100–2000 mm, or blank.");
    return;
  }
  if (
    reference() !== null &&
    !$<HTMLInputElement>("reference-provenance").value.trim()
  ) {
    notify("Describe the independent reference measurement before recording.");
    return;
  }
  trialStarted = performance.now();
  current = {
    version: 1,
    id: crypto.randomUUID(),
    label: label ?? $<HTMLInputElement>("trial-label").value,
    start: new Date().toISOString(),
    condition: structuredClone(condition),
    profile: structuredClone({
      ...profile,
      screenMode: condition.display,
      mmPerCss: scale(),
    }),
    diagnostics: structuredClone(snapshot()),
    samples: [],
    renderIntervals: [],
    referenceProvenance:
      $<HTMLInputElement>("reference-provenance").value || "unavailable",
    blindCode: blindOrder.length ? `Variant ${blindIndex + 1}` : undefined,
  };
  $<HTMLButtonElement>("start-trial").disabled = true;
  $<HTMLButtonElement>("stop-trial").disabled = false;
  for (const id of ["reference-distance", "reference-provenance"])
    $<HTMLInputElement>(id).disabled = true;
  $("trial-status").textContent =
    `Recording ${live ? "camera observations" : "SIMULATED observations"} · ${current.label}`;
  diagnostics.event("trial-start", current.id);
}
function finishTrial() {
  if (!current) return;
  current.end = new Date().toISOString();
  current.durationMs = performance.now() - trialStarted;
  trials.push(current);
  current = null;
  $<HTMLButtonElement>("start-trial").disabled = false;
  $<HTMLButtonElement>("stop-trial").disabled = true;
  for (const id of ["reference-distance", "reference-provenance"])
    $<HTMLInputElement>(id).disabled = false;
  $("trial-status").textContent =
    "Trial saved in this session. Export JSON before closing.";
  document.body.classList.remove("blind");
  go("experiments");
  renderTrials();
}
function renderTrials() {
  const list = $("trial-list");
  list.replaceChildren();
  for (const t of trials) {
    const s = summarize(t),
      div = document.createElement("div");
    div.className = "trial-entry";
    const strong = document.createElement("strong");
    strong.textContent = t.blindCode ?? t.label;
    const small = document.createElement("small");
    small.textContent = `${s.samples} observations · ${s.source.join("/")} · depth ${s.depthMm.median?.toFixed(1) ?? "—"} mm · absolute error ${s.depthAbsoluteErrorMm.median?.toFixed(1) ?? "unavailable"} mm`;
    div.append(strong, small);
    list.append(div);
  }
}
$("start-trial").onclick = () => startTrial();
$("stop-trial").onclick = finishTrial;
$("save-ratings").onclick = () => {
  const t = trials.at(-1);
  if (!t) {
    notify("Finish a trial first.");
    return;
  }
  t.ratings = Array.from(
    document.querySelectorAll<HTMLInputElement>(".rating"),
  ).map((i) => Number(i.value));
  t.comment = $<HTMLTextAreaElement>("trial-comment").value;
  notify("Ratings saved to the last completed trial.");
  if (blindOrder.length) {
    blindIndex++;
    if (blindIndex < blindOrder.length) {
      condition.rendering = blindOrder[blindIndex];
      sync();
      $("blind-status").textContent =
        `Next: variant ${blindIndex + 1}. Select Start randomized blind comparison to continue.`;
    } else {
      $("blind-status").textContent =
        "Completed order: " +
        blindOrder.join(" → ") +
        ". Repeat before drawing conclusions.";
      condition = blindOriginal!;
      blindOriginal = null;
      blindOrder = [];
      sync();
    }
  }
};
document.querySelectorAll<HTMLInputElement>(".rating").forEach(
  (input) =>
    (input.oninput = () => {
      input.nextElementSibling!.textContent = input.value + " / 7";
    }),
);
$("blind-trial").onclick = () => {
  if (current) {
    notify("Finish the active trial first.");
    return;
  }
  if (!blindOrder.length) {
    blindOriginal = { ...condition };
    blindOrder = ["coupled", "static", "naive"];
    for (let i = blindOrder.length - 1; i > 0; i--) {
      const n = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [blindOrder[i], blindOrder[n]] = [blindOrder[n], blindOrder[i]];
    }
    blindIndex = 0;
  }
  condition.rendering = blindOrder[blindIndex];
  sync();
  startTrial("Blind perceptual comparison");
  if (!current) return;
  go("demo");
  document.body.classList.add("blind");
  notify(
    "Move gently side-to-side for 15 seconds. The trial will finish automatically.",
  );
  setTimeout(() => {
    if (current?.blindCode) finishTrial();
  }, 15000);
};
function session() {
  return {
    version: 1,
    exported: new Date().toISOString(),
    provenance: {
      camera: "observed numeric input, estimated metric output",
      simulator: "simulated",
      reference: "independently measured only when entered",
      nominal: "manufacturer-derived nominal scale",
    },
    profile,
    condition,
    trials,
    summary: trials.map(summarize),
    diagnostics: structuredClone(snapshot()),
  };
}
$("export-json").onclick = () => {
  if (current) finishTrial();
  download("portal-session.json", JSON.stringify(session(), null, 2));
};
$("export-csv").onclick = () => {
  if (current) finishTrial();
  download("portal-observations.csv", csv(trials), "text/csv");
};
importFile("import-session", (data) => {
  if (data.version !== 1) throw Error("Unsupported session version");
  const imported = validateTrials(data.trials);
  trials.push(...imported);
  renderTrials();
  notify("Session imported.");
});
$("run-paired").onclick = () => {
  const t = trials.at(-1);
  if (!t) {
    notify("Record a camera trial first.");
    return;
  }
  try {
    $("paired-results").textContent = JSON.stringify(
      paired(
        t,
        {
          ...t.condition,
          depth: $<HTMLSelectElement>("paired-baseline")
            .value as Condition["depth"],
        },
        { ...t.condition, ...condition },
      ),
      null,
      2,
    );
  } catch (e) {
    notify(String(e));
  }
};
$("save-condition").onclick = () => {
  localStorage.setItem("portal.condition.v1", JSON.stringify(condition));
  notify("Condition saved.");
};
$("load-condition").onclick = () => {
  const stored = localStorage.getItem("portal.condition.v1");
  if (stored) {
    try {
      condition = validateCondition(JSON.parse(stored));
    } catch (e) {
      notify(String(e));
      return;
    }
    changed();
    notify("Condition restored.");
  }
};
$("run-synthetic").onclick = () => {
  const report = syntheticReport();
  $("synthetic-table").innerHTML =
    "<table><thead><tr><th>Perturbation</th><th>Depth projection error</th><th>Lateral error</th></tr></thead><tbody>" +
    report.sweep
      .map(
        (r) =>
          `<tr><td>${r.perturbation * 100}%</td><td>${r.depthProjectionErrorMm.toFixed(3)} mm</td><td>${r.lateralProjectionErrorMm.toFixed(3)} mm</td></tr>`,
      )
      .join("") +
    '</tbody></table><p class="micro">Simulated geometry. Ideal fit: ' +
    report.idealFit.reason +
    "</p>";
  $("export-synthetic").hidden = false;
};
$("export-synthetic").onclick = () =>
  download(
    "synthetic-geometry.json",
    JSON.stringify(syntheticReport(), null, 2),
  );
$("export-diagnostics").onclick = () =>
  download("portal-diagnostics.json", JSON.stringify(snapshot(), null, 2));
$("capture-frame").onclick = () => {
  if (!live || !$<HTMLInputElement>("frame-consent").checked) {
    notify("Start the camera and opt in to saving a reference frame first.");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")!.drawImage(video, 0, 0);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `reference-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  });
};
window.addEventListener("pagehide", () => {
  stopCamera();
});
sync();
diagnostics.event("app-ready", { profile: profile.id });
