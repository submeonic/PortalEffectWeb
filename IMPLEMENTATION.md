# Implementation plan and research risks

1. Establish typed coordinate models, off-axis renderer, synthetic eye controls and numerical tests.
2. Integrate one-face MediaPipe capture, real numerical observations, smoothing and safe tracking loss.
3. Add nominal/generic/card display scales, repeatable card trials and versioned reference import.
4. Add conditions, recorded paired evaluation, diagnostics and JSON/CSV export.
5. Add iris depth, distortion correction and reference-camera tools.
6. Evaluate gaze model feasibility; implement limited, independently validated fitting without making gaze a baseline dependency.
7. Run numerical and browser checks, document hardware acceptance and honest milestone status.

Risks: camera metric scale is not ground truth; delivered crops can invalidate intrinsics; viewport top position relative to the physical panel is not fully exposed by Safari; gaze bias can be indistinguishable from camera placement; physical device testing requires a real iPhone. Label all estimates and preserve raw numeric input. No push or deployment in this iteration. No raw frames retained by default.
