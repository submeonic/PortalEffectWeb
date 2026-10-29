# Live gaze-ray calibration

Updated 2026-10-29. **Real inference and the fixation workflow are implemented.** Desktop Chromium executes the pinned model in a worker, produces a finite 3D ray from the portrait fixture, collects synchronized samples through the normal camera pipeline, and returns to head tracking after cancellation. These are execution checks, not iPhone accuracy or performance measurements.

## What was missing

The baseline at `e057ab5` had the bounded translation fitter, synthetic tests and an external-ray importer. It did not have a gaze provider, model artifact, timed target collector, synchronization path or calibration-only lifecycle. The `prev-rev` attempt likewise deferred live integration. Its documentation treated unverified Safari performance and model conventions as gates before implementation; no demonstrated browser incompatibility was recorded. This iteration makes the experiment runnable and leaves physical validation as an empirical question.

## Chosen model and reproducibility

| Item | Value |
|---|---|
| Model | Arm MobileGaze MobileNetV2 INT8, derived from MobileGaze / L2CS |
| Repository revision | `7e48ffa8eaa1e970f98d11204adea4f72b0954a3` |
| Artifact | `l2cs_mobilegaze_mobilenetv2-a8w8-2-ort-quantized.onnx` |
| SHA-256 | `7367559b5d95ca3d74d85cb117b38ccd6bb0f0ca5eb0311ecef4129baa9b8fbc` |
| Download size | 2,955,025 bytes; **not** runtime RAM |
| Runtime | `onnxruntime-web@1.23.2`, single-thread WASM in a temporary classic worker |
| Input | `x0`, float32 `[1,3,448,448]`, unmirrored RGB, NCHW |
| Outputs | `linear`: yaw logits; `linear_1`: pitch logits; 90 bins each |
| Preparation | RGB/255, mean `[.485,.456,.406]`, SD `[.229,.224,.225]` |
| Decode | stable softmax expectation, `4 × E[bin] − 180` degrees, then radians |
| Provenance | Converted artifact declares Apache-2.0; upstream MobileGaze code MIT; training data Gaze360 |

`npm run assets` downloads the pinned model, checks its digest, copies the matching ONNX WASM/JS and saves its model card, recipe and provenance alongside the model. The worker checks the model digest again before execution. All assets are local to the static site; no camera frame or tensor is uploaded. ONNX and model files are requested only when calibration starts. `terminate()` destroys the gaze worker and its WASM heap at completion, cancellation, load/inference failure, camera stop, navigation away, page hiding, viewport change or camera-format change. MediaPipe continues on its existing path.

Primary implementation sources: [Arm model card and recipe](https://huggingface.co/Arm/mobilegaze-mobilenet-v2-int8-onnx/tree/7e48ffa8eaa1e970f98d11204adea4f72b0954a3), [MobileGaze ONNX inference](https://github.com/yakhyo/gaze-estimation/blob/main/onnx_inference.py), [MobileGaze vector conversion](https://github.com/yakhyo/gaze-estimation/blob/main/utils/helpers.py), [ONNX Runtime Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html). Upstream training/data terms remain distinct from the converted artifact's declared license; this is a research integration, not a certification of the weights or their accuracy.

## Camera-relative direction and synchronized eye origin

The upstream `gaze_to_3d` convention gives, for yaw `a` and pitch `b`:

```
d = (−cos(b) sin(a), −sin(b), −cos(b) cos(a))
```

The basis is image-right X, image-down Y, camera-forward Z. At zero angles the ray points toward the camera (`−Z`). This is already camera-relative: applying MediaPipe's head rotation again would rotate it twice. CSS mirroring is used only on the preview. Numerical tests check channel order, angle bins, normalization and signs. The fixture output is approximately yaw −7.30°, pitch +2.81°, direction `(0.12686, −0.04900, −0.99071)`; the fixture has **no known fixation label** and cannot verify angular accuracy.

During calibration only, `Tracker` freezes one unmirrored video frame in a canvas. MediaPipe consumes that frame; its numerical observation and the same frozen canvas are passed to the gaze provider before another frame is captured. Eye origin comes from the selected existing face/iris estimator; no previous-frame eye estimate or filtered pose is paired with a new gaze direction. The worker receives a normalized face crop, not a screenshot of the page. Images are released, not recorded. Full numeric observations, target CSS coordinates, timestamps, directions and model provenance remain exportable.

**Deliberate crop deviation:** the provider uses MediaPipe's tight 468-landmark face envelope rather than adding a second RetinaFace detector. It rejects crops smaller than 70 px or clipped by the image. Canvas bilinear resizing can differ slightly from the source Python image libraries. Crop bias and unmirrored live direction signs need physical validation; these are documented assumptions, not reasons to omit the experiment.

## Interaction and fitting

1. Optionally measure the ID-1 card first and explicitly enter the physical browser content origin when known. Start gaze calibration separately from Portal. Camera startup is automatic if needed.
2. A screen-filling dialog shows upper-right, lower-right, lower-left and upper-left targets at 10% inset. These are corners of the **visible browser viewport**, not inaccessible display pixels behind Safari chrome. The actual DOM center of each target is converted through each physical model.
3. Each target settles for 900 ms. Collect at least 12 accepted samples spanning at least 1.8 seconds; requests are separated by at least 100 ms. Slow inference naturally extends collection. A target times out after 30 seconds.
4. Reject missing/closed eyes, small/clipped faces, strong head angles, rapid motion, invalid estimates or backward-facing rays. No sample is accepted/rejected based on how close its gaze is to the target. `quality=1` means these binary gates passed, **not** a calibrated model confidence.
5. Collect the center target without fitting it. Then move the head about 2–3 cm sideways and collect the center again. The second center requires at least 15 mm estimated displacement from the first. This is an extra check beyond the five-target request; neither center enters training.
6. Reuse the existing robust, regularized tx/ty fitter. Rotation, tz, intrinsics, face scale and gaze bias stay fixed. Prior σ=8 mm; displacement bound ±15 mm; conditioning checked before regularization. Acceptance needs >5% **and at least 1 mm** held-out RMS reduction and residual ≤10 mm. Each center pose must pass individually as well as in aggregate. These are conservative engineering thresholds, not validated perceptual criteria.
7. Fit each available reference/unknown × baseline/card model separately using the same captured rays and its own target coordinate conversion. An accepted delta never transfers silently to another baseline. Save accepted fits, then toggle them independently in A, B or Inspection.
8. Bind fits to scale, camera transform, physical origin, display dimensions/DPR/orientation/zoom, depth estimator settings, imported reference intrinsics when relevant, and observed camera-format signature. Changed conditions disable stale refinements. Browser chrome can change the **unobserved** physical content origin; the browser cannot automatically verify that assumption.

At most the latest eight gaze runs (including interrupted runs with samples) remain in the session export. `Export gaze evidence` downloads the latest run; session JSON contains all retained runs. Compact fits and provenance persist in the calibration profile; full numeric evidence remains in memory until exported. Rejected fits and their reasons remain reviewable and cannot change the baseline. Old v1 external fits have no compatibility context and must be recollected/refitted.

## External observation path

The existing importer remains available under Results and external observations. Import an array or `{ "observations": [...] }` using the Unknown Device frame and the current card scale when available:

```json
{
  "eye": {"x": 0, "y": 40, "z": 400},
  "direction": {"x": 0, "y": 0.1, "z": -0.9949874371},
  "target": {"x": 25, "y": 50, "z": 0},
  "heldOut": false,
  "quality": 0.8,
  "targetId": "upper-right",
  "provenance": "REPLACE with actual model/version/convention/collection provenance"
}
```

Origins/directions use the metric camera basis, targets physical screen millimeters. Four training target IDs, ≥12 training observations and ≥3 held-out samples at a non-training location are required. Simulated provenance is rejected by this importer. External independence remains the researcher's responsibility; the live collector enforces the second head pose, the legacy external schema does not.

## What this cannot establish yet

L2CS and ETH-XGaze motivate appearance-based 3D gaze estimation, not guaranteed accuracy on this phone or this crop. Gaze360 model error may overwhelm the few degrees spanned by a phone at arm's length. Constant gaze bias can still resemble camera translation even with two center poses. Card scale cannot establish eye depth or camera optical center, and MediaPipe's canonical facial scale is not ground truth. Fitting only translation deliberately leaves these ambiguities visible.

Still to measure: iPhone Safari runtime support, load/inference distributions, thermal behavior and RAM; live gaze signs and angular error using independent references; rejection rates, time/effort, held-out performance across distances and subjects; improvement in physical and perceptual portal accuracy. Failures are useful H3 results. Do not loosen acceptance thresholds merely to obtain an enabled toggle.
