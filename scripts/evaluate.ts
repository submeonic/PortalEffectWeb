import { readFileSync, writeFileSync } from "node:fs";
import { paired, summarize } from "../src/experiments/metrics";
import type { Trial, Condition } from "../src/types";
const input = process.argv[2];
if (!input)
  throw Error("Usage: npm run evaluate -- session.json [report.json]");
const session = JSON.parse(readFileSync(input, "utf8"));
if (session.version !== 1 || !Array.isArray(session.trials))
  throw Error("Expected version 1 session");
const report = session.trials.map((trial: Trial) => ({
  summary: summarize(trial),
  comparisons: trial.samples.every((s) => s.observation.source === "camera")
    ? (
        [
          "iris-assumed",
          ...(trial.profile.intrinsics ? ["iris-reference"] : []),
          "fusion",
        ] as Condition["depth"][]
      ).map((depth) => ({
        depth,
        result: paired(
          trial,
          { ...trial.condition, depth: "face" },
          { ...trial.condition, depth },
        ),
      }))
    : [],
  warning:
    "Frame bootstrap is optimistic with autocorrelation; compare repeated independent trials before ranking methods.",
}));
writeFileSync(
  process.argv[3] ?? "evaluation.json",
  JSON.stringify(report, null, 2),
);
console.log("Evaluated", report.length, "trials");
