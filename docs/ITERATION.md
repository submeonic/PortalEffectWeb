# Physical portal / gaze iteration review

2026-10-29. Based on master `e057ab5`, with inspected comparison scaffolding reused from `prev-rev`. Work is local on `codex/physical-portal-gaze`; nothing has been pushed or deployed.

## Corrections

- **Scrolling:** the old renderer set scene position only on first render. Each frame now moves room, objects and lights to the current physical DOM-aperture center. The camera stays in display coordinates with an identity orientation and an asymmetric frustum.
- **Foreground clipping:** the old near plane was effectively the screen. It is now 1 mm from the eye, so the protruding half is actually rendered. Existing convention is +Z toward the viewer, −Z into the device. This is documented rather than silently changing signs to match another engine.
- **Visualization:** fixed 25.4 mm rear wall, identical wall/column material, square-section depth columns, front point lights with distance falloff, real shadow casting and screen-plane witness geometry. No cylinder rods or differently colored back wall.
- **Comparisons:** stacked A/B, compact independent device/scale/gaze controls, expandable model provenance. A/B have the same 22 mm cube. Both live and simulated observations pass through independent physical transforms.
- **Inspection:** a third large portal below A/B, its own condition switches, 32 mm cube, adjustable center depth and a viewport-filling mode that works without requiring Safari's Fullscreen API.
- **Unknown Device:** explicit generic CSS reference-pixel prior and top-center camera assumption; no iPhone dimensions/inset/placement override. Card scale changes physical bounds and the unknown camera prior. Explicit user content-origin measurements can apply to either condition.
- **Live gaze:** pinned MobileGaze INT8 ONNX inference in a temporary worker; exact same frozen frame as MediaPipe; four corners, withheld center, second center at a changed head position; bounded tx/ty fit and condition-specific persistence. More than 5% and at least 1 mm independent residual reduction, residual ≤10 mm, with both centers passing. Rejection is a valid experiment outcome.
- **Research infrastructure:** capture/depth/filter methods, independent references, assessments, diagnostics, blind rendering comparison, CLI evaluation and JSON/CSV remain. New records include all three selections/resolved transforms, per-window eyes and model-agreement statistics. Gaze runs retain numeric evidence; raw images are not recorded. Legacy trial imports remain supported.

The previous gaze work was a fitter plus an importer, not a live workflow. No actual browser incompatibility had been demonstrated. The model is now executed and exercised in the browser, while unmeasured hardware accuracy remains explicitly unverified. See [GAZE.md](GAZE.md) for exact weights, decoding, crop deviation, lifecycle, thresholds and uncertainty.

## Verification

- 49 Vitest tests: coordinates, clipping/parallax, independent device models, saved-fit compatibility, gaze preprocessing/signs, full synthetic target sequence, held-out rejection/cancellation, original filtering/iris/statistics.
- 13 Chromium integration tests: original research flows, scroll attachment, both real models, synchronized live collection/cancel, no default gaze requests, matching raw observations, uniform materials/quad columns, inspection controls and desktop/mobile layout.
- TypeScript + Vite production build under `/PortalEffectWeb/`.
- Production subpath smoke: local MediaPipe assets and worker, local ONNX assets and worker, nonzero synchronized gaze samples, clean cancellation. The preview must be launched with the same `PORTAL_BASE_PATH` as the build.
- Seeded simulation and `git diff --check`.
- Visual review of comparison and large inspection layouts. Automated portrait emulation is not physical Safari testing.

The actual model fixture provides a finite normalized direction, not a known gaze label. Synthetic successful fits test implementation behavior, not sensor accuracy. No quantitative iPhone result is asserted here. The user's observation that the original head-coupled effect worked on their iPhone remains qualitative prior evidence.

## On the iPhone

1. Check scrolling with tracking active, especially while Safari bars expand/collapse. Content-origin placement remains a browser limitation.
2. Open the large inspection window, select reference, center the cube at 0, then try +12 mm and lateral head motion. Evaluate foreground parallax, depth cues and clipping at the HTML aperture edges.
3. Repeat card measurement, then compare reference / unknown / unknown+scale using the same capture.
4. Run gaze calibration, inspect acceptance/rejection for each condition and export evidence. Validate gaze direction signs and repeat across distances; do not equate lower residual with independently measured physical accuracy.
5. Compare load/inference time, rejection rates, sustained performance, thermal behavior and perceptual benefit. Record failure and effort as outcomes of H3.

Full hardware protocol: [TESTING.md](../TESTING.md). Mathematical assumptions and research references: [RESEARCH.md](../RESEARCH.md).
