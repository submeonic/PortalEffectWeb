# Verification and iPhone acceptance protocol

## Automated checks

```bash
npm ci
npm run assets
npm test
npx playwright install chromium
npm run test:e2e
npm run simulate
PORTAL_BASE_PATH=/PortalEffectWeb/ npm run build
# In a separate terminal (same base is required for accurate Pages emulation):
# PORTAL_BASE_PATH=/PortalEffectWeb/ npm run preview -- --port 4174
node scripts/smoke-production.mjs http://127.0.0.1:4174/PortalEffectWeb/
```

Unit tests cover rotated card dimensions; content origin/viewport offsets; CSS-to-mm conversion; camera/display signs; column-major face pose; valid clipping; screen-plane registration for multiple eye and portal positions; parallax direction; distortion inversion; reference-stream compatibility; filtering resets; iris validity and ideal depth; constrained fitting, degeneracy and held-out rejection; missing-reference semantics and deterministic bootstrap.

Browser tests cover desktop/mobile rendering, uniform room materials and square columns, scroll attachment, foreground clipping, full-screen inspection, independent model selection, slider control, card persistence, aspect ratio, recording/export, permission denial, diagnostics, synthetic results, real MediaPipe image inference and the complete worker-driven tracker using a portrait canvas stream, real ONNX 3D gaze inference, lazy model loading, same-frame live collection and cancellation with head tracking still running. Unit tests also drive the complete six-target state machine with explicitly synthetic rays, including successful fitting, held-out failure and cancellation during inference. The latter is **fixture-driven model execution**, not a real camera or human subject measurement. Software-rendered Chromium speed is not representative of the iPhone GPU/CPU. Desktop viewport emulation cannot establish Safari compatibility.

The model package references a missing source-map filename during Vite development. This diagnostic does not affect model inference or the production bundle. Keep it separate from actual runtime exceptions.

## Hardware setup — every item awaiting physical verification

Record date, iPhone model, iOS/Safari versions, display zoom/text size, page zoom, browser chrome state, brightness, ambient lighting, glasses, participant code and whether Low Power Mode is enabled. Do not put participant names in shared exports. Use portrait, 100% page zoom and the secure-origin instructions in README.

1. Open Portal. Verify two visible compartment windows and a foreground cube without granting camera permission.
2. Move simulator X from −50 to +50, Y from −50 to +50 and Z from 250 to 600 mm. The cube straddles the screen plane: front and back geometry should move oppositely relative to the screen-plane witness marks. The screen-plane border must not rotate with the head.
3. Enable head tracking. Verify no full-screen video takeover. Record startup duration and actual stream dimensions in Diagnostics. Confirm the backend field; note any fallback reason.
4. Move physically right while facing the screen. The reported screen X should increase. Move up: screen Y should increase. Move closer: Z should decrease. Preview should behave like a mirror but toggling preview styling must not invert geometry.
5. Temporarily obscure the face. Raw observations must become missing, rendering should ease safely, and reacquisition must not jump to non-finite geometry.
6. Scroll with the camera active. Portal bounds must follow the DOM location, not document-origin coordinates. Compare A/B using the same tracking observations but independent models. The contents must travel with their aperture while perspective updates. Scroll down to Inspection, select the reference condition, choose Fill screen, and assess the 32 mm cube at center 0 and +12 mm.
7. Capture an initial diagnostic JSON and note any errors before beginning measurements.

## Stage A: baseline

Use nominal iPhone geometry, face matrix, One Euro, coupled rendering, fixed cube. Enter an independent distance only if measured. Record three 15-second stationary trials and three lateral trials (approximately ±30 mm at a comfortable pace). Use a physical head support only if safe and convenient; never force head position. Visit Portal during recording to collect visible-render intervals. Return to Experiments and Finish trial. Export after each set.

Measure median/p95 inference duration, tracking intervals, actual render intervals, loss fraction, raw stationary depth SD and visual stability. The targets are 15–30 tracking updates/sec and ≥30 rendered frames/sec; failure to meet them is a result, not a reason to rename a target as achieved. Script durations do not measure camera-to-photon latency. If latency matters, use an independently filmed moving reference and external high-speed recording, with an explicit method and uncertainty.

## Stage B: repeated card calibration

Use an ordinary ID-1 card with true 53.98×85.60 mm edges, in portrait. Avoid card sleeves, warped cards and perspective viewing when aligning. Align the outer CSS outline to outer card edges. The rounded-corner fit is less reliable than the long straight edges. Run at least five randomized starts without viewing prior results while adjusting. Export the calibration profile.

Report individual mm/CSS px values, mean, sample SD, coefficient of variation, completion times and percent differences from nominal. Distinguish repeatability from independent accuracy. If an independently measured display width is available, record the method and its uncertainty before computing absolute error. Recalibrate after display zoom or DPR changes.

## Stage C: depth

Use a ruler or measured positioning reference for eye-midpoint-to-screen distances near 250, 400 and 600 mm. The approximate location of the eye midpoint itself introduces reference uncertainty: record it. Never call an estimated distance an independent reference. Enter the distance and its method before recording. Keep baseline and iris comparisons paired by replaying the **same** numeric camera observations.

For each distance: three stationary trials facing forward, then mild yaw and pitch trials. Compare face matrix, assumed-intrinsic iris and fixed fusion. Test iris diameter assumptions (e.g. 11.2, 11.7, 12.2 mm) and focal multipliers (0.9, 1.0, 1.1). Report validity rate as well as error so rejection cannot masquerade as accuracy. No valid iris samples must yield unavailable iris results, not zero error.

## Stage D: optional independent intrinsics

The schema example in docs is deliberately marked **assumed**, so the reference importer rejects it. It is documentation, not a calibration profile.

1. Use a flat, dimensionally measured checkerboard with known inner corner counts and square size. Disable printer scaling. Measure several squares physically.
2. Use the website's front-camera pipeline. Explicitly opt in and download individual PNG frames from Diagnostics. Do not substitute rear-camera images, Camera-app photographs or screenshots of the mirrored preview.
3. Collect at least 12–25 sharp views: near, medium and far; varied pitch/roll/yaw; target coverage across the full image. Avoid glare, clipped corners and motion blur. A set of nearly identical frontal images is poorly conditioned even if numerous.
4. Keep actual dimensions, crop, orientation, focus and stabilization configuration fixed. Export camera diagnostics. If autofocus changes cannot be controlled, note that limitation and validate across focus states.
5. On desktop:

   ```bash
   python -m venv .venv
   .venv/bin/pip install opencv-python numpy
   .venv/bin/python scripts/calibrate_camera.py frames/*.png \
     --columns 9 --rows 6 --square-mm 20 \
     --provenance 'Safari front-camera PNGs; date; device; target measurement method' \
     --output camera-reference.json
   ```

6. Inspect global and per-view reprojection RMS, parameter standard deviations and spatial residual patterns. Hold out additional images; fitted reprojection RMS is not independent ground truth. The utility is syntax-checked but has not been run on a physical checkerboard dataset in this session.
7. Import the measured reference **before recording** the comparison session. Add a `configuration` map with relevant known track settings when appropriate. Any declared fields must match exactly. Recalibrate rather than silently rescale an unknown crop.
8. Compare assumed/reference iris depth on matched recorded observations using the Replay baseline selector. Also compare zero correction versus supplied distortion. Changing this reference does not recalibrate MediaPipe's internal face-matrix model.

## Stage E: live gaze experiment

1. In Calibration, measure card scale first when available. Record the physical content origin and its uncertainty. Keep portrait orientation, 100% zoom and stable Safari chrome.
2. Start gaze calibration. Confirm model load succeeds and the UI remains responsive. Look at the four corner dots without moving the phone. Each waits 900 ms, then collects ≥12 samples over ≥1.8 seconds.
3. Look at the center. For the final center, move your head 2–3 cm sideways and settle. The collector checks ≥15 mm estimated displacement; neither center is used in fitting.
4. Inspect all model conditions in Results. Acceptance needs >5% and ≥1 mm held-out RMS reduction with residual ≤10 mm; each center pose must pass individually. Failed, reversed-ray, ill-conditioned or out-of-bounds fits must leave baselines intact.
5. Save accepted refinements. Return to Portal and compare unknown, unknown+scale, unknown+gaze and unknown+both against reference using A/B and the large inspection window. An unaccepted condition must stay disabled; success on one model does not authorize another.
6. Export gaze evidence and session JSON before closing. Report rejected counts, reasons, load time, inference median/p95 from the recorded samples, collection time and failure rate. Repeat at new distances/head positions, then use independent physical measurements before asserting improved alignment.
7. Cancel while loading, while a model frame is in flight, and during fixation. Change orientation/viewport, background the page and stop the camera. The model must unload and ordinary tracking must recover or offer a clear restart. Reopen calibration to verify recovery.

See [GAZE.md](docs/GAZE.md) for pinned assets, preprocessing/sign conventions, the face-crop deviation and external-ray schema. Validate live left/right/up/down gaze direction with an independent protocol; the desktop portrait is not an angular ground truth fixture. No target-error gate should select samples. A constant model bias may still pass center checks, so report ray consistency separately from independent physical accuracy.

## Stage F: perceptual study

Keep scene, size, lighting and motion instructions fixed. Start randomized blind comparison. Each 15-second trial hides method controls and advances after recording ratings. Complete all three: coupled, static and naive rotation. The labels are revealed only after all ratings. Record presence, stability, perspective response, visible jitter/lag (7 means more), comfort and comments. Repeat with new randomized orders; use counterbalanced orders across participants for a larger study. These UI blinding controls reduce obvious cues but do not conceal the visual effect itself or the export data from an analyst.

## Stage G: calibration cost and recommendation

Extract camera startup events, card duration and repeated measurement effort. Extract gaze load/fixation duration, per-sample inference time, rejection counts and failed/interrupted runs from the gaze evidence. Compare benefit and cost using RESULTS.md. Do not claim one method wins from one subjective trial or a frame-level bootstrap with autocorrelated data.

## Failure matrix

| Test | Expected behavior / record |
|---|---|
| Deny camera permission; retry | Clear message, working simulator, enabled retry button |
| Offline after asset preparation | Local model/WASM available; fonts may fall back |
| Rotate phone | Live calibrated rendering suspends; return to portrait and recheck placement |
| Pinch/page zoom; display zoom | Suspension or profile incompatibility; repeat scale calibration |
| Collapse/expand Safari bars or open keyboard | Record viewport change; scale survives height-only changes, but physical content origin must be rechecked |
| Dynamic Island and safe areas | Controls remain usable; diagnostic inset data recorded; no claims that safe-area CSS gives camera optical center |
| Camera format/crop changes | Format event and trial boundary; incompatible reference rejected |
| Unobserved focus/stabilization changes | Known limitation; compare reference validity independently |
| Poor lighting, partial face, glasses, blink | Detection/iris rejection recorded; no unbounded eye jumps |
| Rapid motion, large yaw/pitch | Track jitter/loss; iris rejection at large pose; no raw-Z metric substitution |
| Face-scale bias | Depth errors persist despite stable tracking; compare independent distances |
| Systematic gaze bias | Test synthetic biased rays and live withheld head positions; baseline preserved on failed fit |
| Slow inference | One frame in flight; worker preserves UI; fallback may block; record backend and actual timing |
| 10–20 minute thermal run | Export periodic trials and diagnostics; report rate changes and crashes, if any |
| Background and return | Camera state resets safely; retry required if the stream ended |
| Multiple portal positions / scroll | Shared camera observations, independently transformed eyes and updated aperture/scene positions |
| Export and reload | Profile persists; exported trials reimport; memory-only unexported trials are not recoverable |

No row in this hardware matrix is marked passed until someone performs it on the physical iPhone.
