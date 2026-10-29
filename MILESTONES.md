# Implementation and evidence ledger

Updated: 2026-10-29. No physical iPhone was connected during development. All hardware acceptance items remain pending. The application is local; no remote push or deployment was performed.

| Milestone | Implemented | Verification / outcome | Evidence type | Remaining uncertainty / next experiment |
|---|---|---|---|---|
| 1 · Geometry and visual proof | Typed coordinate chain, screen conversion, off-axis frustum, shallow 25.4 mm compartment, four scene variants, two scrolling portals, simulated eye control | Synthetic corner/clipping/parallax tests pass; desktop and portrait layouts visually inspected | Deterministic numerical ground truth and browser rendering | Verify physical motion signs and aperture registration on phone |
| 2 · Browser tracking | Real Face Landmarker, one face, canonical eye proxies, rotation, worker inference, fallback, adaptive scheduling, loss handling, filters | Real fixture gives one face / 478 landmarks / column-major matrix; complete worker capture pipeline and replay pass | Actual model execution on a portrait fixture in Chromium; input camera stream mocked | iPhone Safari model/runtime/camera and thermal performance unverified |
| 3 · Physical screen | independent iPhone reference and Unknown Device conditions, per-window saved calibration toggles, portrait ID-1 outline, randomized repeated trials, persistence, origin/placement controls, import/export | Card aspect ratio, reload persistence and physical-model toggle pass; unknown-prior isolation and zoom/config incompatibility tested | Synthetic CSS measurements and desktop mobile emulation | Physical card accuracy, browser chrome offset and display zoom need repeated phone measurements |
| 4 · Measurement | Raw observations, immutable trial configs, bounded capture, timings, ratings, blind order, JSON/CSV, paired replay and CLI evaluator | Recording/export and missing-reference behavior pass; deterministic statistics tested | Simulated/fixture data clearly separated from physical results | Obtain independent ruler distances and trial-level replications |
| 5 · Depth/intrinsics | Iris depth, rejection gates, assumed/reference models, distortion inversion, fixed fusion, per-frame camera config checks, reference PNG opt-in and OpenCV utility | Ideal iris and distortion tests pass; reference mismatches and assumed import rejected; Python syntax compiles | Synthetic numerical reference only | No independent camera dataset or iPhone depth-error results; run checkerboard and distance studies |
| 6 · Gaze refinement | Model research, genuine external-ray importer, independently toggled saved correction, bounded tx/ty fitter, robust weights, conditioning, withheld validation and baseline preservation | Ideal known fit recovered to <1e−9 mm; biased/degenerate/invalid fits rejected | Synthetic gaze observations only | Live model and automatic fixation sequence not integrated; need license/convention audit and actual Safari benchmark |
| 7 · Recommendation | Guided stages, blind ratings, reproducible reports, limitations and minimum-calibration decision template | Report distinguishes accuracy from internal consistency and calibration costs | Framework, no empirical recommendation yet | Populate RESULTS.md from real trials before ranking methods |

## Automated validation

- Vitest: **38 passing tests** across geometry and research integrity suites.
- Playwright Chromium: **9 passing integration tests**, including scroll attachment, saved scale toggle, real model execution and a worker-backed portrait-fixture stream.
- TypeScript + Vite production build: **passed**.
- Built static-site smoke test: **passed**, including local model/WASM and worker inference on the portrait fixture.
- Seeded simulation: **passed**, saved in `docs/synthetic-results.json`.
- Python checkerboard utility: **syntax checked**, no physical-image run yet.
- Dependency audit after upgrading Vitest: **0 reported vulnerabilities** at installation.

Tests initially caught an incorrect hand-calculated nominal-width expectation and a portrait emulation setup that retained a landscape physical screen; both were corrected without removing assertions. Visual inspection caught a real simulator suspension problem in landscape desktop windows; the simulator now runs independently of live portrait constraints. No physical failure was reclassified as a pass.

## Explicitly unfinished or unverified

- Live gaze-direction inference, model loading/unloading benchmark, automatic timed fixation collection, gaze angular accuracy and iPhone RAM measurements.
- Independent absolute display dimensions, optical camera placement, camera intrinsics and true eye position.
- Physical Safari permission/lifecycle behavior, video delivery, worker support, viewport placement and perceptual effect.
- Empirically justified fusion weights or a final recommendation that one calibration method is best.
- Camera-to-photon latency: not measurable from this app's JavaScript timing alone.

## Recommended next session

Start with README's HTTPS setup and TESTING stages A–C. Establish correct physical head-motion signs and export 15-second stationary trials at 250, 400 and 600 mm before investing in gaze. Compare face versus iris on matched observations, including rejection rates. Then decide whether independent intrinsics or more precise display placement addresses the dominant error.
