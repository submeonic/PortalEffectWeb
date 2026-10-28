# Results and recommendation template

**Current evidence:** synthetic numerical checks and desktop fixture/UI execution only. No real iPhone trials, independent metric accuracy measurements, human perceptual scores or gaze-model benchmark results exist yet. Do not replace blank fields with zeros.

## Session provenance

| Field | Value |
|---|---|
| Date / operator / participant code | Awaiting measurement |
| Commit / model asset SHA-256 | Copy from local Git and public/models/provenance.json |
| Device / iOS / Safari / display zoom | Awaiting measurement |
| Delivered camera format / relevant track settings | Export diagnostics |
| Content origin measurement / uncertainty | Awaiting measurement |
| Lighting / glasses / head position / thermal state | Awaiting measurement |
| Independent distance/position reference and uncertainty | Awaiting measurement |
| Number of independent trials | Awaiting measurement |

## Quantitative results

| Condition | Valid frames % | Depth absolute error median / p95 (mm) | Stationary Z SD (mm) | Raw / filtered displacement | Inference median / p95 (ms) | Render median / p95 (ms) | Calibration time |
|---|---|---|---|---|---|---|---|
| Nominal + face matrix + One Euro | — | — | — | — | — | — | — |
| Card + face matrix + One Euro | — | — | — | — | — | — | — |
| Assumed iris + One Euro | — | — | — | — | — | — | — |
| Reference iris + One Euro | — | — | — | — | — | — | — |
| Fixed 50/50 fusion | — | — | — | — | — | — | — |
| Accepted external gaze tx/ty | — | — | — | — | — | — | — |

For every comparison report matched-frame count, rejected-frame count, independent trial count, reference uncertainty, mean/median paired difference, interval method and effect size. Frame bootstrap is exploratory because adjacent samples are correlated. Report failures and missing measurements as unavailable.

## Screen scale

Record all repeated card values and their initial widths. Report mean, sample SD, coefficient of variation and timing. Compare with nominal scale as **agreement**. Compute absolute physical error only if a separate measurement with stated uncertainty exists. Investigate correlation between initial rectangle size and final adjustment.

## Perceptual outcomes

Report randomized order, scene, exposure time and five 1–7 ratings. Jitter/lag is reverse-valenced: high means worse. Summarize repeated within-participant differences before aggregating participants; include comments and discomfort. A single positive impression does not establish superiority.

## Minimum useful calibration decision

Pre-register a practically meaningful improvement before collecting data (example research choices: >5 mm median depth-error reduction, lower stationary jitter without visible lag, or a consistent ≥1-point perceived-stability improvement across repeated trials). Choose thresholds appropriate to the application; these examples are not clinical or perceptual standards.

| Added step | Independently demonstrated benefit? | Time / failure cost | Performance cost | Keep / drop / retest and reason |
|---|---|---|---|---|
| Card scale | Unknown | Unknown | Negligible runtime arithmetic | Retest |
| Measured viewport placement | Unknown | Unknown | Negligible runtime arithmetic | Retest |
| Camera reference intrinsics | Unknown | Advanced capture effort | Small ray-correction overhead | Retest |
| Iris depth | Unknown | No additional user action | Small numerical overhead | Retest |
| Gaze refinement | Unknown | Model/fixation cost unmeasured | Calibration-only model cost | Deferred |

Starting condition for the first study: nominal profile + face matrix + One Euro. This is a low-effort baseline, **not a proven winner**. Prefer the simplest condition whose independently measured benefit is reproducible, stable across head positions and meaningful relative to reference uncertainty. If improvements are within measurement noise, preserve the simpler baseline.

## Milestone interpretation

The ideal synthetic translation fit recovers its known (3,−4) mm displacement within 1e−9 mm under fixed parameters. A biased gaze case is rejected. This establishes implementation behavior only. Desktop portrait inference produces 478 landmarks and a finite matrix but has no true distance label. Consult docs/synthetic-results.json for the seeded numerical report and MILESTONES.md for test counts.
