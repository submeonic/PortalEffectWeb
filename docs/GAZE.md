# Gaze model investigation and integration boundary

Investigated 2026-10-28 and revisited 2026-10-29. No live gaze model or pretend iris-to-gaze proxy is included. The portal does not depend on ONNX Runtime. Genuine external ray import and translation fitting are implemented. A saved accepted X/Y correction is now optional on either comparison window; it does not overwrite the baseline transform. The fit baseline is Unknown Device with card scale when saved, otherwise its generic scale.

| Candidate | Verified from primary material | Remaining work |
|---|---|---|
| L2CS-Net | Official PyTorch project; MIT code; yaw/pitch architecture with released checkpoint links | Check individual checkpoint and training-data terms; reproduce preprocessing and signs; convert/load a specific artifact in browser; measure device RAM/speed/accuracy |
| MobileGaze / yakhyo gaze-estimation | Official project describes ResNet/MobileNet/MobileOne architectures and ONNX inference | Select exact weights, confirm applicable license and training data, validate camera-relative vector conventions |
| Arm MobileGaze MobileNetV2 INT8 ONNX | Model card declares Apache-2.0 artifact; 2,955,025 bytes; 448×448 RGB NCHW; two 90-bin yaw/pitch logit outputs; opset 20 | The reported smoke test is desktop Python CPU, not Safari. Confirm graph support in ONNX Runtime Web and benchmark the actual iPhone |

Sources: [L2CS-Net official repository](https://github.com/Ahmednull/L2CS-Net), [MobileGaze implementation](https://github.com/yakhyo/gaze-estimation), [Arm artifact card](https://huggingface.co/Arm/mobilegaze-mobilenet-v2-int8-onnx/blob/main/README.md), [ONNX Runtime Web documentation](https://onnxruntime.ai/docs/tutorials/web/).

The Arm artifact looks plausible for a follow-on experiment. Its [configuration](https://huggingface.co/Arm/mobilegaze-mobilenet-v2-int8-onnx/blob/main/config.yaml) specifies a 448×448 RGB face crop, ImageNet normalization, and softmax expectation over 90 yaw/pitch bins. The published validation is only an x86-64 ONNX Runtime interface smoke test, not an iPhone Safari test. The [upstream MobileGaze repository](https://github.com/yakhyo/gaze-estimation) reports 13.07° mean angular error for MobileNet V2 on its Gaze360 evaluation; that is not a measurement of this converted checkpoint or our phone. At 400 mm, a 13° angular miss could correspond to roughly 92 mm of screen displacement, far above our 10 mm held-out gate. That calculation illustrates the risk; it does not predict actual device error.

This is an **unfinished integration**, not evidence that ordinary browsers cannot run gaze inference. ONNX Runtime Web documents browser execution, and the model has a concrete ONNX artifact. The missing gates are a verified unmirrored face crop and yaw/pitch-to-camera-vector convention, artifact and upstream terms review, actual Mobile Safari graph/provider and memory benchmarks, and independent angular/fixation accuracy tests. Without these, enabling a four-corner UI could produce a precise-looking but physically wrong transform. No weights were redistributed and no Safari compatibility, gaze accuracy, or memory measurements are claimed. Alternative research paths are an externally validated 3D ray importer (available now), a dedicated on-device model integration and iPhone validation experiment, or independent physical camera-placement measurement. A 2D screen predictor trained on the same fixation targets would not test the stated transform hypothesis.

## Required next integration experiment

1. Pin a model artifact and checksum, preprocessing recipe, code/weight/data license provenance and model card.
2. Use the actual unmirrored camera pipeline. Validate face crop, channel order, resize, normalization, yaw/pitch ordering, angular-bin conversion and signs against known images.
3. Verify that the output is a camera-relative 3D direction. Record any head-relative-to-camera conversion. Never treat screen-coordinate regression as a metric ray without a justified model.
4. Benchmark model load, inference p50/p95, process/browser memory where measurable, thermal behavior and unloading on the iPhone. Do not present the file's compressed size as runtime RAM.
5. Add a provider behind a separate calibration-only lifecycle. Never initialize it in ordinary portal rendering.
6. Collect four inset physical targets in order UR, LR, LL, UL, then independent center validation. Use explicit settling time and a stable sampling window, quality/blink/head-motion rejection, progress and a cancel path. Do not require an uncalibrated model to prove fixation.
7. Run bounded tx/ty refinement and repeat held-out validation at a new head position. Only after these gates should an accepted profile be promoted to normal use.

The automatic fixation collector is intentionally not exposed as if it were operational without an integrated gaze provider.

## External observation schema

Import a JSON array, or `{ "observations": [...] }`. `target` must use the Unknown Device display frame and scale selected for fitting: the saved card scale when available, otherwise the explicit generic prior. Applying a saved correction under a different scale or the reference condition is an extrapolation, shown in the model provenance. Example illustrates structure only; use a genuinely measured direction:

```json
{
  "eye": {"x": 0, "y": 40, "z": 400},
  "direction": {"x": 0, "y": 0.1, "z": -0.9949874371},
  "target": {"x": 25, "y": 50, "z": 0},
  "heldOut": false,
  "quality": 0.8,
  "targetId": "upper-right",
  "provenance": "REPLACE with model version, calibrated vector convention and recording provenance"
}
```

`eye` uses OpenCV-style metric camera mm, `direction` the same camera basis; `target` uses screen mm. Quality must be finite in [0,1]. At least four training target IDs, 12 accepted training observations and three distinct-target held-out observations are required. A `heldOut` label alone is not proof of independent collection; the researcher must maintain separation and document it. Simulated provenance is rejected by the live profile importer and remains confined to the synthetic bench.

Fitter output includes baseline/candidate transforms, training and validation residuals, displacement, conditioning, a conditional uncertainty approximation and the prior. Accepted application checks that the baseline has not changed since the fit. This fitting system cannot by itself establish that an imported gaze model is accurate.
