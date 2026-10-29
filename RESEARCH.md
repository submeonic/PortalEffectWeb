# Research methods and geometry

## Objective and hypotheses

Investigate the simplest calibration procedure that makes an ordinary HTML rectangle behave like a stable physical window. Geometric consistency, perceived stability, latency and calibration effort are separate outcomes. This implementation supplies instruments; it does not contain physical participant results.

- RQ1: card alignment may improve CSS scale, but repeated precision and agreement with nominal size do not establish absolute accuracy.
- RQ2: independent intrinsics may reduce iris depth bias compared with an assumed focal length.
- RQ3: canonical face scale may be stable enough for an illusion while retaining person-dependent metric bias. Iris depth may help or degrade stability.
- RQ4: genuine camera-relative gaze rays may constrain a small camera-placement correction. Systematic gaze bias can imitate translation and survive a single center holdout.
- RQ5: physically correct projection should preserve screen-plane registration and yield consistent parallax; a good synthetic projection is not proof of accurate sensing.
- RQ6: retain calibration only if repeated independent benefits justify time, failure rate and performance costs.

## Coordinates, units and transformation chain

| Space | Convention | Conversion / limitations |
|---|---|---|
| Camera pixels | Origin top-left; u right, v down; actual delivered width/height | Preview mirroring is CSS only. Original video is supplied to inference. |
| Normalized landmarks | x/y normalized to frame; relative z | Never interpret normalized z as millimeters. |
| Canonical face / MediaPipe metric | Right-handed, X right, Y up, visible points toward negative Z; canonical unit cm | Column-major 4×4 transformation matrix; runtime scale is an estimator assumption. |
| Metric camera | Right-handed, X image-right, Y image-down, Z forward into the captured scene | `(x,y,z)_camera = 10 × (x,-y,-z)_MP`. |
| Physical display | Origin center of active rectangular panel; X device-right, Y up, Z toward viewer; mm | `eyeScreen = R eyeCamera + t`; reference prior `R=diag(-1,-1,1)`, `t=(0,H/2−8,0)` mm; unknown prior uses `t=(0,H/2,0)` with generically estimated H. |
| Browser layout viewport | CSS pixels, top-left origin, Y down | Use actual element `getBoundingClientRect`, visual viewport offsets/scale and explicit physical content origin. Do not add scrollY a second time. |
| Portal | Metric rectangle on display Z=0 | Canvas content rectangle excludes the decorative border. Each portal gets its own bounds and independently transformed eye from the same camera observation. |
| Three.js | Same display-space mm; camera local forward −Z | Translate the camera to the eye, keep its quaternion identity, and supply asymmetric projection. Never `lookAt` the cube. |

MediaPipe describes a canonical model in centimeters and its geometry pipeline; the task's scale is not a calibrated reconstruction using this application's imported intrinsics. The default proxies are averages of canonical contour vertices `(33,133,159,145)` and `(362,263,386,374)`: approximately `(±3.16416575, 2.62690925, 3.64600075)` cm. They represent eye surface locations, not individualized optical centers. Sources: [canonical model](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj), [face geometry description](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/face_mesh.md), [matrix serialization layout](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/framework/formats/matrix_data.proto), [web result extraction](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/face_landmarker/face_landmarker.ts).

The two sign changes in camera-to-display rotation preserve handedness. A viewer moving physically right appears left in the unmirrored front-camera image; preview flipping must not also flip the estimate. Tests exercise translation, rotation, matrix ordering and this sign convention. Hardware confirmation is still necessary.

### Display conversion

For CSS position `(x,y)`, visual viewport offset `(vx,vy)`, pinch scale `s`, unzoomed physical-content origin `(ox,oy)` in display CSS units, screen dimensions `(W,H)` and measured millimeters per CSS pixel `m`:

```
X = ((x − vx)s + ox − W/2)m
Y = (H/2 − ((y − vy)s + oy))m
Z = 0
```

Live calibrated use requires 100% zoom. Safari chrome, keyboards and content positioning complicate `ox,oy`; they are explicit user assumptions. Browser metadata cannot reliably determine them. Display/DPR/orientation/zoom changes invalidate card scale. Width changes pause active card windows for review; ordinary browser-height changes preserve scale but may change the unobserved physical origin. Recheck explicit placement when browser chrome moves. The mathematical conversion supports offsets; it does not claim that Safari supplied those physical offsets.

Nominal iPhone scale is `25.4/460 × 3 = 0.16565217 mm/CSS px`, assuming 402×874 logical points and default scaling. Active rectangle is about 66.592×144.780 mm. This uses display resolution/density, not the body's 71.5×149.6 mm. Manufacturer density is nominal and rounded; corners and Dynamic Island are excluded from the ideal rectangle. [Apple technical specifications](https://support.apple.com/en-us/121031).

Card scale is `53.98 / measuredPortraitWidthCss`. Height stays locked at `widthCss × 85.60/53.98`. Trial initialization is randomized without snapping to nominal. Results retain starting width, final width, time and viewport. The displayed difference from nominal is **agreement**, not a ground-truth error. Repeated measurement SD uses sample variance.

### Off-axis projection

For physical portal edges `L,R,B,T`, eye `(ex,ey,ez)` and near distance `n`:

```
l = (L − ex)n/ez       r = (R − ex)n/ez
b = (B − ey)n/ez       t = (T − ey)n/ez
```

Use these in the perspective matrix; near = **1 mm from the eye**, far = 4000 mm. The former `ez−0.1 mm` near plane clipped away protruding geometry. The screen is the projection reference plane, not the clipping plane. Camera orientation stays parallel to the physical display. Tests independently project screen-plane corners into NDC ±1 for multiple eye and portal locations. The relevant Three.js APIs are [Matrix4.makePerspective](https://threejs.org/docs/pages/Matrix4.html) and [Camera projection matrices](https://threejs.org/docs/pages/Camera.html).

Scene geometry is local to the HTML aperture. Every rendered frame translates the room, objects and lights to the current physical aperture center, while the eye stays in the display frame. This fixes the previous one-time placement bug: scrolling moves both the aperture and its contents, while their off-axis relationship to the physical eye changes naturally. The rear wall stays parallel to the screen at local Z=−25.4 mm. A/B cubes are identically 22 mm, centered on Z=0. Inspection uses a 32 mm cube with an explicit −2…+14 mm center offset. Positive Z is toward the viewer in this existing coordinate system (the opposite sign from some Unity setups). A rotated cube centered at zero has half its volume on either side of the plane.

All five walls and the square-section depth columns share one material. Point lights in front of the opening use physical-distance falloff; one casts shadows. The screen-plane cross and square provide occlusion/parallax references. Aperture width/height follow the selected CSS-to-mm model; fixed object/depth dimensions do not scale cosmetically. The rendering remains monocular, and foreground geometry is clipped at the canvas perimeter. Physical protrusion perception must be tested, not inferred from a screenshot.

## Estimation, filtering and reference calibration

The baseline transforms canonical eyes with the MediaPipe matrix, converts cm to mm and applies the camera placement prior. A face-scale sensitivity factor is explicit. Impossible or non-finite estimates are rejected. Detection confidence thresholds are configured, but the task result does not provide a calibrated scalar pose confidence; exported quality is null rather than an invented probability.

The iris estimator uses opposite iris landmarks to measure two diameters in undistorted normalized camera coordinates. It uses the larger diameter, rejects ellipse aspect ratio below 0.65, rejects closed-eye geometry, strong estimated pitch/yaw (>~34°), implausible depth outside 120–1500 mm and left/right disagreement above 25%. This is a conservative major-axis heuristic, not a full eye-orientation solution. Independent validation is required under rotation and eyeglasses. Pinhole depth is `D = f_px × d_mm / diameter_px`. The default `d=11.7 mm` is an assumption. Assumed `fx=fy=0.9×max(videoWidth,videoHeight)` is exposed for sensitivity analysis and never inferred from browser metadata. Fusion is a fixed 50/50 face/iris depth average, not a validated optimal estimator.

Reference import requires positive finite focal lengths, principal point, exact dimensions, orientation, 0/4/5 Brown–Conrady distortion parameters, declared source=reference, provenance and uncertainty. It does not relabel an imported assumed profile as measured. Format and provided track-configuration fields must match. Missing independent information is not filled with manufacturer specifications. Numerical undistortion uses fixed-point inversion; very large or nonconvergent distortion must be rejected by downstream validity checks. Imported intrinsics affect iris/ray estimation, **not MediaPipe's internal face-matrix camera model**.

One Euro and alpha-beta filters operate on the shared camera-relative raw eye estimate before independent display transforms. Switching resets state; unfiltered data remain unchanged. Prediction is bounded at 40 ms and defaults to zero. Loss holds briefly then gradually returns toward a centered 400 mm view. Reacquisition after a long gap resets the filter. Do not interpret fallback poses as observed data: recorded raw/filtered fields are null on failed inference/depth frames.

MediaPipe Web's inference call is synchronous; the implementation places it in a classic worker when transferable bitmaps and OffscreenCanvas work. Frames are bounded to one in flight. A pinned CommonJS export shim supports the runtime's classic-worker WASM loader. If initialization fails, the main thread tries GPU then CPU. Main-thread fallback can still block rendering. Scheduling lowers the requested rate from 24 toward 10 Hz for expensive inference; it does not guarantee the device reaches that rate. [MediaPipe web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js).

## Gaze refinement model

Only tx and ty are free. Rotation, tz, camera intrinsics, iris diameter and eye scale remain fixed. For gaze origin `o`, unit camera direction `d`, target `p`, transform `(R,t)`, residual is `||(I − ddᵀ)(p − Ro − t)||` after rotating d. Huber-like IRLS weights use a 5 mm transition, quality is bounded, parameter displacement is bounded to ±15 mm and a zero-centered 8 mm prior regularizes changes. Conditioning is checked on the unregularized normal matrix; a prior must not hide degeneracy. Rays must point toward the target.

Require four distinct training targets, at least 12 training observations and at least three held-out observations at a separate target. The held-out data never enter normal equations. Accept only if held-out RMS improves by >5% and at least 1 mm, and is at most 10 mm. The live collector requires both a withheld center and a second center at a different head position to pass individually. These are engineering thresholds, not validated accuracy gates. Approximate uncertainty is residual / information-scale, conditional on independent errors and fixed parameters; it is not a rigorous calibrated posterior. Preserve baseline on every rejected fit. Repeat from a different head position before trusting improvements. Systematic gaze bias remains an unresolved confound even after a center holdout.

The live appearance-model provider, synchronization, target collector, condition-bound saved fits and explicit limitations are described in [GAZE.md](docs/GAZE.md). A lower validation residual is evidence about ray consistency, not independent proof that the camera moved to its fitted physical location.

## Unknown Device and the hypotheses

There are exactly two device conditions, no device-profile catalog or model auto-detection. The reference uses nominal iPhone 16 Pro display scale and a declared camera inset; it is an evaluation prior. Unknown Device uses **25.4/96 mm per CSS pixel** as an explicit generic prior (the CSS reference pixel is not a measured physical pixel), a generic top-center front camera, the same proper axis rotation, zero camera depth offset and zero content-origin assumption. This replaces the unexplained 0.18 mm/px generic prior. It is intentionally allowed to be wrong. It uses no iPhone dimensions, pixel density, camera inset or reference placement override.

A card measurement supplies independent physical scale for either condition and updates both unknown aperture dimensions and the unknown top-center camera prior. An explicit user content-origin measurement applies to both; legacy reference-only origin fields do not leak into Unknown Device. Card scale alone cannot recover browser chrome offset, camera placement or metric eye depth. Gaze fits are stored separately for each model/scale condition rather than adding an unknown-device delta to the reference camera.

- **H1:** repeated card alignment can recover scale sufficiently well that known device geometry adds little perceptual benefit. Compare repeatability, reference agreement and independent measurements separately.
- **H2:** canonical MediaPipe depth may suffice perceptually; iris depth and independent intrinsics may help or hurt metric accuracy. Keep the existing paired depth replay and reference-camera tooling.
- **H3:** calibration-only 3D rays may improve camera-to-display alignment. Measure held-out residuals, independent physical accuracy and perceptual benefit; retain rejected runs and calibration cost.

The target comparison is reference; unknown; unknown+scale; unknown+gaze; unknown+both. Every A/B trial records identical input observations, per-window raw/filtered eyes, selected and resolved models, viewport/apertures, ratings and diagnostics. Paired replay freezes the recorded transforms and recomputes depth/filter variants for all recorded models. Model-agreement statistics are not independent accuracy.

## Experimental design

Independent factors: display source, assumed/reference intrinsics, distortion correction, face/iris/fusion depth, placement transform, filter and rendering method. Keep scene geometry, lighting, distance reference and prescribed motion fixed within paired comparisons. Begin with focused one-factor ablations rather than a full factorial explosion.

Dependent variables: nominal scale agreement, repeated scale SD, independently referenced signed/absolute/relative depth error, stationary eye-position spread, frame-to-frame displacement, tracking loss, inference and actual visible render intervals (median/p05/p95), subjective ratings and calibration duration. Without an independent reference, depth error is null. Step displacement measures jitter only during stationary trials; motion trials mix signal with noise.

Recorded matrix and 478 numeric landmarks allow matched replay. Replay holds the recorded device profile fixed and recomputes depth/filter variants; it does not rerun MediaPipe with different camera intrinsics. Filtered performance should be judged jointly with lag. CSV intentionally omits full landmarks; use JSON for reproduction. Frame-level bootstrap uses a seeded resampling procedure and is explicitly optimistic under temporal autocorrelation. Prefer confidence intervals over differences between repeated independent trial summaries.

Potential confounds: participant face/iris size, gaze bias, unmeasured camera placement, browser chrome, display zoom, model delegate, delivered crop, effective focal length changes, focus, stabilization, lighting, glasses, thermal throttling, adaptation, trial order and incomplete fixation. Record what is known. Never manufacture missing reference positions or gaze labels.

## Synthetic versus physical evidence

The seeded bench creates known eye/target geometry, simulated gaze directions, noise and systematic yaw bias; it compares projection sensitivity to scale, focal length, principal-point and depth perturbations. Noiseless recovery at floating-point precision validates algebra only. A portrait fixture validates real model execution but supplies no metric reference or phone performance evidence.

Use the report template in RESULTS.md to compare useful improvement against user effort. Until hardware trials exist, the recommended **starting condition**, not a proven winner, is nominal iPhone geometry, face matrix and One Euro filtering; collect card and iris ablations next. Do not require optional gaze calibration for the baseline experience.

## Research references checked for this iteration

- Kooima, *Generalized Perspective Projection* (2009): [original link](https://csc.lsu.edu/~kooima/pdfs/gen-perspective.pdf). This URL was inaccessible during this session; the screen-aligned equations supplied in the specification were checked independently against projection of corners, foreground/background points and moving apertures in actual Three.js matrices.
- [Kartynnik et al., monocular facial surface geometry](https://arxiv.org/abs/1907.06724), [Grishchenko et al., Attention Mesh](https://arxiv.org/abs/2006.10962), and [Face Landmarker Web](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js): preserve the existing facial pose estimator; no individualized metric-accuracy claim.
- [MediaPipe Iris depth](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/) and [Zhang camera calibration](https://www.microsoft.com/en-us/research/publication/a-flexible-new-technique-for-camera-calibration/): retain iris/intrinsic experiments and their independent-reference requirements.
- [L2CS-Net](https://arxiv.org/abs/2203.03339) and [ETH-XGaze](https://arxiv.org/abs/2007.15837): methodological basis for camera-relative appearance gaze. The implemented weights are the separately documented MobileGaze derivative, not ETH-XGaze weights. Published dataset accuracy is not our measured accuracy.
- [Casiez et al., 1€ filter and author implementation](https://gery.casiez.net/1euro/): preserve jitter/lag evaluation and raw observations. The existing vector-speed cutoff implementation is retained, not re-tuned from unmeasured phone performance.
