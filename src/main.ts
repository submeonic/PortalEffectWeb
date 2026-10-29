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
  NOMINAL_SCALE,
  CARD,
  cardScale,
  displayCompatible,
  cardPlacementCompatible,
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
import {
  modelBounds,
  modelEye,
  resolveModel,
  savedGazeFit,
  cameraSignature,
  cardAvailable,
  baseModel,
  gazeContext,
  modelKey,
  type SavedGaze,
  type WindowModel,
} from "./geometry/coordinate-model";
import { GazeCalibration, TARGETS } from "./gaze/calibration";
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
const windowModels: WindowModel[] = [
  { device: "reference", card: false, gaze: false },
  { device: "unknown", card: false, gaze: false },
  { device: "unknown", card: false, gaze: false },
];
let cameraEye: Vec3 | null = null;
let gazeCalibration: GazeCalibration | null = null;
let pendingGaze: SavedGaze | null = null;
const gazeRuns: SavedGaze[] = [];
let targetIndex = -1;
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
let blindOrder: Condition["rendering"][] = [],
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
  portals.push(
    new Portal($("portal-main")),
    new Portal($("portal-second")),
    new Portal($("portal-inspection")),
  );
  portals[2].setCube(32);
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
function sensorSignature() {
  return live
    ? cameraSignature(
        video.videoWidth,
        video.videoHeight,
        capture.stream?.getVideoTracks()[0]?.getSettings() as Record<
          string,
          unknown
        >,
      )
    : undefined;
}
function view() {
  return viewport(profile.viewport.originX, profile.viewport.originY);
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
  if (gazeCalibration && page !== "calibration") cancelGaze();
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
  if (page === "calibration") syncModels();
}
document
  .querySelectorAll<HTMLButtonElement>("[data-page]")
  .forEach((b) => (b.onclick = () => go(b.dataset.page!)));
function sync() {
  for (const id of ["scene", "rendering", "filter", "depth"] as const)
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
  const savedScale = profile.cards.at(-1)?.mmPerCss;
  $("scale-value").textContent = savedScale?.toFixed(5) ?? "—";
  $("calibration-status").textContent =
    savedScale !== undefined
      ? `Latest card measurement. Difference from iPhone nominal: ${((savedScale / NOMINAL_SCALE - 1) * 100).toFixed(2)}%. This is agreement, not absolute accuracy.`
      : "No physical scale measurement saved. The comparison windows use explicit priors until a card is measured.";
  $("intrinsics-status").textContent = profile.intrinsics
    ? `${profile.intrinsics.width} × ${profile.intrinsics.height} · ${profile.intrinsics.provenance}`
    : "No independent intrinsic reference supplied.";
  const s = stats(profile.cards.map((c) => c.mmPerCss));
  $("card-results").textContent =
    `${s.n} card measurements · mean ${s.mean?.toFixed(5) ?? "—"} mm/px · SD ${s.sd?.toFixed(5) ?? "—"}`;
  if (!pendingGaze && profile.gaze) {
    $("gaze-result").textContent = JSON.stringify(profile.gaze, null, 2);
    $<HTMLButtonElement>("export-gaze").disabled = false;
    $("gaze-status").textContent =
      "Saved refinement available for matching model conditions. Full raw evidence is in your exported calibration session.";
  }
  portals.forEach((p) => p.setScene(condition.scene));
  syncModels();
}
function syncModels() {
  const currentViewport = view();
  const displayChanged = !displayCompatible(profile.viewport, currentViewport);
  $("placement-recovery").hidden = !placementInvalid;
  $("placement-reason").textContent = displayChanged
    ? "The display size, density, orientation, or zoom changed. Repeat the card measurement before using its scale."
    : "The browser content width changed. Check that its physical position is the same, then confirm this layout or edit Content origin below.";
  $<HTMLButtonElement>("confirm-placement").disabled = displayChanged;
  const keys = ["a", "b", "c"];
  windowModels.forEach((selection, i) => {
    const key = keys[i];
    if (i < 2)
      document.querySelectorAll<HTMLElement>(".window-heading span")[
        i
      ].textContent =
        selection.device === "reference" ? "REFERENCE" : "UNKNOWN DEVICE";
    const card = $<HTMLInputElement>("card-" + key);
    const gaze = $<HTMLInputElement>("gaze-" + key);
    card.disabled = !cardAvailable(profile, currentViewport);
    gaze.disabled = !savedGazeFit(
      selection,
      profile,
      currentViewport,
      condition,
      sensorSignature(),
    );
    $("availability-" + key).textContent = [
      card.disabled
        ? "Scale: complete card calibration"
        : selection.card && placementInvalid
          ? displayChanged
            ? "Scale: repeat card measurement"
            : "Scale: review layout in Calibration"
          : "",
      gaze.disabled ? "Gaze: calibrate this condition" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (card.disabled) selection.card = false;
    if (gaze.disabled) selection.gaze = false;
    $<HTMLSelectElement>("device-" + key).value = selection.device;
    card.checked = selection.card;
    gaze.checked = selection.gaze;
    const model = resolveModel(
      selection,
      profile,
      viewport(),
      condition,
      sensorSignature(),
    );
    const displayEye = cameraEye ? modelEye(cameraEye, model) : eye;
    $("model-" + key).textContent = JSON.stringify(
      {
        eyeMm: displayEye,
        mmPerCss: model.mmPerCss,
        scaleSource: model.scaleSource,
        cameraToScreen: model.cameraToScreen,
        contentOriginCss: {
          x: model.viewport.originX,
          y: model.viewport.originY,
        },
        contentOriginSource:
          profile.placement?.provenance ??
          (selection.device === "reference"
            ? "saved reference placement assumption"
            : "generic zero assumption"),
      },
      null,
      2,
    );
  });
}
for (const [i, key] of ["a", "b", "c"].entries()) {
  $<HTMLSelectElement>("device-" + key).onchange = () => {
    windowModels[i].device = $<HTMLSelectElement>("device-" + key)
      .value as WindowModel["device"];
    if (current) finishTrial();
    syncModels();
    diagnostics.event("window-model", { window: key, ...windowModels[i] });
  };
  for (const option of ["card", "gaze"] as const)
    $<HTMLInputElement>(option + "-" + key).onchange = () => {
      windowModels[i][option] = $<HTMLInputElement>(option + "-" + key).checked;
      if (option === "card" && live) {
        const currentViewport = view();
        placementInvalid =
          windowModels.some((m) => m.card) &&
          !cardPlacementCompatible(profile.viewport, currentViewport);
      }
      if (current) finishTrial();
      syncModels();
      diagnostics.event("window-model", { window: key, ...windowModels[i] });
    };
}
function changed() {
  lastEstimate = null;
  if (current) finishTrial();
  filter.reset();
  cameraEye = null;
  portals.forEach((p) => p.recenter());
  sync();
  diagnostics.event("condition", condition);
}
for (const id of ["scene", "rendering", "filter", "depth"] as const)
  $<HTMLSelectElement>(id).onchange = () => {
    const value = $<HTMLSelectElement>(id).value;
    if (id === "depth" && value === "iris-reference" && !profile.intrinsics) {
      notify("Import a compatible intrinsic reference first.");
      sync();
      return;
    }
    (condition as unknown as Record<string, string>)[id] = value;
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
  cancelGaze();
  capture.stop();
  preview.pause();
  preview.srcObject = null;
  video.srcObject = null;
  tracker.stop();
  live = false;
  invalidated = false;
  starting = false;
  filter.reset();
  cameraEye = null;
  $<HTMLButtonElement>("start-camera").disabled = false;
  $("start-camera").hidden = false;
  $("stop-camera").hidden = true;
  $("tracking-state").textContent = "Simulator ready. Camera is off.";
  diagnostics.event("camera-stop");
  if (current) finishTrial();
}
async function startCamera() {
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
}
$("start-camera").onclick = startCamera;
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
    cameraEye = filter.update(
      result.eyeCamera,
      o.time,
      condition.filter,
      condition.predictionMs,
    );
    const primary = resolveModel(
      windowModels[0],
      profile,
      viewport(),
      condition,
      sensorSignature(),
    );
    filtered = modelEye(cameraEye, primary);
    eye = filtered;
  } else {
    diagnostics.event("tracking-loss", {
      detected: o.detected,
      intrinsicInvalid,
    });
  }
  if (current) {
    const modelEyes = windowModels.map((selection) =>
      result
        ? modelEye(
            result.eyeCamera,
            resolveModel(
              selection,
              profile,
              viewport(),
              condition,
              sensorSignature(),
            ),
          )
        : null,
    );
    current.samples.push({
      observation: o,
      raw: modelEyes[0],
      filtered,
      windowEyes: modelEyes,
      windowFilteredEyes: windowModels.map((s) =>
        cameraEye && result
          ? modelEye(
              cameraEye,
              resolveModel(
                s,
                profile,
                viewport(),
                condition,
                sensorSignature(),
              ),
            )
          : null,
      ),
      viewport: viewport(),
      faceDepth: result?.faceDepth ?? null,
      irisDepth: result?.irisDepth ?? null,
      referenceDistanceMm: reference(),
      projection: portals.flatMap((p, i) => {
        const rect = p.renderer.domElement.getBoundingClientRect();
        return rect.width && rect.height
          ? [
              modelBounds(
                rect,
                resolveModel(
                  windowModels[i],
                  profile,
                  viewport(),
                  condition,
                  sensorSignature(),
                ),
              ),
            ]
          : [];
      }),
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
    // One synthetic camera observation, just like one live observation. The
    // controls use display-right/up signs; unmirrored camera X/Y are opposite.
    cameraEye = {
      x: -Number($<HTMLInputElement>("sx").value),
      y: -Number($<HTMLInputElement>("sy").value),
      z: Number($<HTMLInputElement>("sz").value),
    };
    eye = modelEye(
      cameraEye,
      resolveModel(windowModels[0], profile, viewport(), condition),
    );
  } else if (time - lastGood > 800) {
    cameraEye = null;
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
      windowEyes: windowModels.map((s) =>
        modelEye(cameraEye!, resolveModel(s, profile, viewport(), condition)),
      ),
      viewport: viewport(),
      faceDepth: null,
      irisDepth: null,
      referenceDistanceMm: null,
      projection: portals.flatMap((p, i) => {
        const rect = p.renderer.domElement.getBoundingClientRect();
        return rect.width && rect.height
          ? [
              modelBounds(
                rect,
                resolveModel(
                  windowModels[i],
                  profile,
                  viewport(),
                  condition,
                  sensorSignature(),
                ),
              ),
            ]
          : [];
      }),
    });
    if (current.samples.length >= 900) finishTrial();
  }
  let rendered = false;
  if (activePage === "demo" && (!live || !invalidated)) {
    for (const [i, p] of portals.entries()) {
      const r = p.renderer.domElement.getBoundingClientRect();
      const cardSuspended = live && windowModels[i].card && placementInvalid;
      p.element.classList.toggle("suspended", cardSuspended);
      if (cardSuspended) continue;
      if (r.width && r.height && r.bottom > 0 && r.top < innerHeight) {
        const model = resolveModel(
          windowModels[i],
          profile,
          viewport(),
          condition,
          sensorSignature(),
        );
        const windowEye = cameraEye ? modelEye(cameraEye, model) : eye;
        p.render(windowEye, modelBounds(r, model), condition);
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
  if (gazeCalibration)
    cancelGaze(
      "Viewport changed during calibration. Retry with stable browser controls.",
    );
  const v = view();
  const cardActive = windowModels.some((m) => m.card);
  if (live)
    placementInvalid =
      cardActive && !cardPlacementCompatible(profile.viewport, v);
  invalidated =
    v.scale !== 1 ||
    v.orientation.startsWith("landscape") ||
    (windowModels.some((m) => m.device === "reference") &&
      (v.dpr !== profile.viewport.dpr ||
        v.screenWidth !== profile.viewport.screenWidth ||
        v.screenHeight !== profile.viewport.screenHeight));
  if (!live) invalidated = false;
  diagnostics.event("viewport-change", v);
  syncModels();
  if (current && (invalidated || placementInvalid)) finishTrial();
  if (invalidated)
    notify(
      "Rendering suspended: return to portrait and 100% zoom, and check display configuration.",
    );
  else if (placementInvalid)
    notify(
      "Card-scale windows paused after a layout change. Open Calibration to review or repeat the measurement; other windows remain active.",
    );
}
window.addEventListener("resize", geometryChange);
window.visualViewport?.addEventListener("resize", geometryChange);
document.addEventListener("visibilitychange", () => {
  diagnostics.event("visibility", document.visibilityState);
  if (document.hidden && gazeCalibration)
    cancelGaze(
      "Calibration stopped while the page was hidden. Retry when visible.",
    );
});
video.addEventListener("resize", () => {
  if (gazeCalibration) cancelGaze("Camera format changed. Retry calibration.");
  diagnostics.event("camera-format", {
    width: video.videoWidth,
    height: video.videoHeight,
  });
  if (current) finishTrial();
});
function snapshot() {
  return {
    ...diagnostics.snapshot(),
    calibration: profile,
    condition,
    windowModels: windowModels.map((selection) => ({
      ...selection,
      resolved: resolveModel(
        selection,
        profile,
        viewport(),
        condition,
        sensorSignature(),
      ),
    })),
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
      sceneCenter: p.sceneCenter,
      cubeSizeMm: p.cubeSizeMm,
      cubeOffsetMm: p.cubeOffsetMm,
      depthMm: 25.4,
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
    : placementInvalid && windowModels.some((m) => m.card)
      ? "CARD SCALE NEEDS REVIEW"
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
  if (activePage === "demo") syncModels();
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
  if (profile.cards.length && !displayCompatible(profile.viewport, view())) {
    notify(
      "Display geometry changed. Repeat the card measurement before saving placement assumptions.",
    );
    return;
  }
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
  profile.placement = {
    originX: numbers[0],
    originY: numbers[1],
    provenance: "explicit user-entered content-origin measurement/assumption",
  };
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
$("confirm-placement").onclick = () => {
  const currentViewport = view();
  if (
    !profile.cards.length ||
    !displayCompatible(profile.viewport, currentViewport)
  ) {
    notify(
      "Display geometry changed. Repeat the card measurement before using its scale.",
    );
    return;
  }
  if (current) finishTrial();
  profile.viewport = currentViewport;
  placementInvalid = false;
  save();
  syncModels();
  diagnostics.event("placement-confirmed", {
    viewport: currentViewport,
    originSource: "saved assumption, not independently measured",
  });
  notify(
    "Current layout confirmed with the saved content-origin assumption. Card scale is available again.",
  );
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
function showGazeResult(bundle: SavedGaze) {
  pendingGaze = bundle;
  gazeRuns.push(bundle);
  if (gazeRuns.length > 8) gazeRuns.shift();
  const entries = Object.entries(bundle.fits);
  const accepted = entries.filter(([, entry]) => entry.fit.accepted);
  $("gaze-result").textContent = JSON.stringify(bundle.fits, null, 2);
  $("gaze-status").textContent = accepted.length
    ? `${accepted.length} of ${entries.length} coordinate conditions passed held-out checks. Save to enable their toggles.`
    : "No condition passed validation. Baselines are unchanged. Export the evidence to inspect residuals and retry.";
  $<HTMLButtonElement>("apply-gaze").disabled = !accepted.length;
  $<HTMLButtonElement>("export-gaze").disabled = false;
  diagnostics.event("gaze-result", { fits: bundle.fits });
}
function cancelGaze(
  message = "Calibration cancelled. The gaze model has unloaded.",
) {
  if (!gazeCalibration) return;
  const run = gazeCalibration;
  if (run.observations.length)
    showGazeResult({
      version: 2,
      timestamp: new Date().toISOString(),
      fits: {},
      evidence: {
        observations: run.observations,
        rejected: run.rejected,
        viewport: run.viewport,
        condition: run.condition,
        loadMs: run.provider.loadMs,
        reason: message,
        status: "interrupted",
      },
    });
  gazeCalibration.dispose();
  gazeCalibration = null;
  tracker.onFrame = null;
  $<HTMLDialogElement>("gaze-dialog").close();
  $<HTMLButtonElement>("start-gaze").disabled = false;
  $("gaze-status").textContent = message;
  diagnostics.event("gaze-stopped", message);
}
$("cancel-gaze").onclick = () => cancelGaze();
$("gaze-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelGaze();
});
$("start-gaze").onclick = async () => {
  if (current) finishTrial();
  if (view().scale !== 1 || view().orientation.startsWith("landscape")) {
    notify("Use portrait orientation and 100% zoom for calibration.");
    return;
  }
  $<HTMLButtonElement>("start-gaze").disabled = true;
  if (!live) await startCamera();
  if (!live) {
    $<HTMLButtonElement>("start-gaze").disabled = false;
    return;
  }
  go("calibration");
  targetIndex = -1;
  const dialog = $<HTMLDialogElement>("gaze-dialog");
  $("gaze-target").hidden = true;
  $("gaze-step").textContent = "Loading 3D gaze model…";
  $("gaze-progress").textContent =
    "Processing stays on this device. Keep your face visible.";
  dialog.showModal();
  const run = new GazeCalibration(
    structuredClone(profile),
    structuredClone(condition),
    viewport(),
    (status) => {
      $("gaze-step").textContent =
        status.index === 5
          ? "Independent center check"
          : `Fixation ${status.index + 1} of 6`;
      $("gaze-progress").textContent = status.message;
      $<HTMLProgressElement>("gaze-progress-bar").value = Math.min(
        status.count,
        12,
      );
      if (status.ready && targetIndex !== status.index) {
        targetIndex = status.index;
        const target = $("gaze-target"),
          position = TARGETS[status.index];
        target.hidden = false;
        target.style.left = `${position.x * 100}%`;
        target.style.top = `${position.y * 100}%`;
        const r = target.getBoundingClientRect();
        run.setTarget(r.left + r.width / 2, r.top + r.height / 2);
      }
    },
    (message) => cancelGaze(message),
    (bundle) => {
      tracker.onFrame = null;
      gazeCalibration = null;
      dialog.close();
      $<HTMLButtonElement>("start-gaze").disabled = false;
      showGazeResult(bundle);
    },
  );
  gazeCalibration = run;
  try {
    await run.initialize();
    if (gazeCalibration !== run) return;
    tracker.onFrame = async (observation, frame) => {
      try {
        await run.sample(observation, frame);
      } catch (e) {
        if (gazeCalibration === run)
          cancelGaze("Gaze inference failed: " + String(e));
      }
    };
    diagnostics.event("gaze-start", { loadMs: run.provider.loadMs });
  } catch (e) {
    if (gazeCalibration === run)
      cancelGaze("Could not load gaze model: " + String(e));
  }
};
importFile("import-gaze", (data) => {
  const observations = (data.observations ?? data) as GazeObservation[];
  if (
    !Array.isArray(observations) ||
    observations.some((o) => !o?.provenance || /simulated/i.test(o.provenance))
  )
    throw Error(
      "Supply genuine gaze observations with provenance, not simulated rays",
    );
  const selection: WindowModel = {
    device: "unknown",
    card: cardAvailable(profile, viewport()),
    gaze: false,
  };
  const model = baseModel(selection, profile, viewport());
  const fit = fitTranslation(observations, model.cameraToScreen);
  showGazeResult({
    version: 2,
    timestamp: new Date().toISOString(),
    fits: {
      [modelKey(selection)]: { context: gazeContext(model, condition), fit },
    },
    cameraSignature: sensorSignature(),
    evidence: {
      observations,
      source: "external; independent collection is operator responsibility",
    },
  });
});
$("apply-gaze").onclick = () => {
  if (!pendingGaze) return;
  if (
    live &&
    pendingGaze.cameraSignature &&
    pendingGaze.cameraSignature !== sensorSignature()
  ) {
    notify("Camera format changed. Repeat gaze calibration.");
    return;
  }
  const fits: SavedGaze["fits"] = {};
  for (const [key, entry] of Object.entries(pendingGaze.fits)) {
    const [device, scale] = key.split(":");
    const selection: WindowModel = {
      device: device as WindowModel["device"],
      card: scale === "card",
      gaze: false,
    };
    if (
      entry.fit.accepted &&
      entry.context ===
        gazeContext(baseModel(selection, profile, viewport()), condition)
    )
      fits[key] = entry;
  }
  if (!Object.keys(fits).length) {
    notify("No accepted fit matches the current model. Repeat calibration.");
    return;
  }
  if (current) finishTrial();
  const evidence = pendingGaze.evidence as Record<string, unknown>;
  // Persist the compact transform/provenance. Full numerical observations stay
  // in session exports, avoiding localStorage quota failures on mobile.
  profile.gaze = {
    ...pendingGaze,
    fits,
    evidence: {
      ...evidence,
      observations: undefined,
      observationCount: Array.isArray(evidence.observations)
        ? evidence.observations.length
        : 0,
    },
  };
  save();
  changed();
  $<HTMLButtonElement>("apply-gaze").disabled = true;
  notify(
    "Accepted refinements saved. Enable them independently above each portal.",
  );
};
$("export-gaze").onclick = () =>
  download(
    "portal-gaze-evidence.json",
    JSON.stringify(pendingGaze ?? profile.gaze, null, 2),
  );
$("expand-inspection").onclick = () => {
  const expanded = $("inspection").classList.toggle("expanded");
  document.body.classList.toggle("inspecting", expanded);
  $("expand-inspection").textContent = expanded
    ? "Exit full screen ×"
    : "Fill screen ↗";
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("inspection").classList.contains("expanded"))
    $("expand-inspection").click();
});
$<HTMLInputElement>("cube-z").oninput = () => {
  const z = $<HTMLInputElement>("cube-z").valueAsNumber;
  portals[2]?.setCube(32, z);
  $("cube-z-value").textContent =
    z === 0
      ? "0 mm · half outside"
      : `${z > 0 ? "+" : ""}${z} mm · ${z > 0 ? "toward viewer" : "behind screen"}`;
};
$("reset-cube").onclick = () => {
  $<HTMLInputElement>("cube-z").value = "0";
  $("cube-z").dispatchEvent(new Event("input"));
};
const guides: Record<string, string> = {
  A: "Record 15 seconds stationary, then a separate 15-second lateral movement trial. Use nominal display and face-matrix depth.",
  B: "Complete at least five randomized card alignments. Export the calibration profile to compare scale variance and nominal agreement.",
  C: "Use an independent ruler at 250, 400 and 600 mm. Record stationary trials, then repeat with yaw and pitch. Replay face versus iris on identical observations.",
  D: "Capture with the exact reference stream. Compare iris-assumed and iris-reference in paired replay. Mark unavailable if no reference exists.",
  E: "Run live gaze calibration under Calibration. Four corner targets train bounded translation; center targets at two head positions validate it. Export rejected runs as well as accepted ones.",
  F: "Three rendering variants are shuffled. Record and rate each before revealing labels. Keep scene, scale and movement instruction fixed.",
  G: "Camera startup and card durations are logged. Compare calibration effort against independent improvements; gaze load, inference, rejection counts and collection durations are included in gaze evidence.",
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
  const primaryModel = resolveModel(
    windowModels[0],
    profile,
    viewport(),
    condition,
    sensorSignature(),
  );
  const primaryMode = windowModels[0].card
    ? "card"
    : windowModels[0].device === "reference"
      ? "nominal"
      : "generic";
  current = {
    version: 1,
    id: crypto.randomUUID(),
    label: label ?? $<HTMLInputElement>("trial-label").value,
    start: new Date().toISOString(),
    condition: structuredClone({ ...condition, display: primaryMode }),
    windowModels: structuredClone(windowModels),
    resolvedModels: windowModels.map((s) =>
      resolveModel(s, profile, viewport(), condition, sensorSignature()),
    ),
    profile: structuredClone({
      ...profile,
      name: `Window A · ${windowModels[0].device === "reference" ? "iPhone 16 Pro reference" : "Unknown Device"}`,
      screenMode: primaryMode,
      mmPerCss: primaryModel.mmPerCss,
      transform: primaryModel.cameraToScreen,
      viewport: primaryModel.viewport,
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
    windowModels,
    gazeRuns,
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
  localStorage.setItem(
    "portal.condition.v1",
    JSON.stringify({ condition, windowModels }),
  );
  notify("Condition saved.");
};
$("load-condition").onclick = () => {
  const stored = localStorage.getItem("portal.condition.v1");
  if (stored) {
    try {
      const saved = JSON.parse(stored);
      const nextCondition = validateCondition(saved.condition ?? saved);
      if (saved.windowModels) {
        if (
          !Array.isArray(saved.windowModels) ||
          saved.windowModels.length !== 3 ||
          saved.windowModels.some(
            (m: WindowModel) =>
              !m ||
              !["reference", "unknown"].includes(m.device) ||
              typeof m.card !== "boolean" ||
              typeof m.gaze !== "boolean",
          )
        )
          throw Error("Invalid saved window selections");
        windowModels.splice(0, 3, ...saved.windowModels);
      }
      condition = nextCondition;
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
