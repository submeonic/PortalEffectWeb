import { syntheticReport } from "../src/simulation/synthetic";
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("docs", { recursive: true });
writeFileSync(
  "docs/synthetic-results.json",
  JSON.stringify(syntheticReport(), null, 2),
);
console.log(
  "Saved deterministic simulated results to docs/synthetic-results.json",
);
