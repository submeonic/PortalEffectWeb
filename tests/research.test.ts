import { describe, it, expect } from "vitest";
import { syntheticGaze, syntheticReport } from "../src/simulation/synthetic";
import { fitTranslation } from "../src/optimization/gaze-fit";
import { defaultTransform } from "../src/geometry/math";
import { PoseFilter } from "../src/filtering/filters";
import { irisDepth } from "../src/tracking/pose";
import { assumedIntrinsics } from "../src/geometry/intrinsics";
import {
  stats,
  bootstrap,
  summarize,
  paired,
} from "../src/experiments/metrics";
import { validateProfile, DEFAULT_CONDITION } from "../src/storage/profiles";
import type { Landmark, Trial } from "../src/types";
describe("gaze refinement safeguards", () => {
  it("recovers ideal synthetic tx/ty within 1e-9 mm", () => {
    const fit = fitTranslation(syntheticGaze(), defaultTransform(), 1e6);
    expect(fit.accepted).toBe(true);
    expect(fit.delta.x).toBeCloseTo(3, 9);
    expect(fit.delta.y).toBeCloseTo(-4, 9);
  });
  it("withholds validation target from fitting", () => {
    const o = syntheticGaze(),
      a = fitTranslation(o, defaultTransform());
    o.filter((x) => x.heldOut).forEach((x) => (x.target.x += 40));
    const b = fitTranslation(o, defaultTransform());
    expect(b.delta).toEqual(a.delta);
    expect(b.accepted).toBe(false);
    expect(b.transform).toEqual(b.baseline);
  });
  it("rejects unconstrained identical grazing rays before prior masks degeneracy", () => {
    const o = syntheticGaze().map((x) => ({
      ...x,
      direction: { x: 1, y: 0, z: 0 },
    }));
    expect(fitTranslation(o, defaultTransform()).reason).toContain(
      "Ill-conditioned",
    );
  });
  it("rejects insufficient evidence and bounded violations", () => {
    expect(
      fitTranslation(
        syntheticGaze().filter((x) => !x.heldOut),
        defaultTransform(),
      ).accepted,
    ).toBe(false);
    expect(
      fitTranslation(syntheticGaze(), defaultTransform(), 8, 1).accepted,
    ).toBe(false);
  });
  it("reports systematic bias independently from training", () => {
    const r = syntheticReport();
    expect(r.biasedFit.accepted).toBe(false);
    expect(r.provenance).toContain("simulated");
  });
});
describe("filter and iris", () => {
  it("resets on method switch and long loss, leaving raw unchanged", () => {
    const f = new PoseFilter(),
      p = { x: 50, y: 0, z: 400 };
    f.update({ x: 0, y: 0, z: 400 }, 0, "euro");
    expect(f.update(p, 33, "euro").x).toBeLessThan(50);
    expect(p.x).toBe(50);
    expect(f.update(p, 66, "none")).toEqual(p);
    expect(f.update(p, 1000, "euro")).toEqual(p);
  });
  it("rejects missing, blink and inconsistent iris estimates", () => {
    expect(irisDepth([], assumedIntrinsics(640, 480))).toBeNull();
    expect(
      irisDepth(
        Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 })),
        assumedIntrinsics(640, 480),
      ),
    ).toBeNull();
  });
  it("recovers pinhole depth from ideal circular irises", () => {
    const i = assumedIntrinsics(640, 480),
      l: Landmark[] = Array.from({ length: 478 }, () => ({
        x: 0.5,
        y: 0.5,
        z: 0,
      }));
    for (const [upper, lower, outer, inner] of [
      [159, 145, 33, 133],
      [386, 374, 263, 362],
    ]) {
      l[upper] = { x: 0.5, y: 0.48, z: 0 };
      l[lower] = { x: 0.5, y: 0.52, z: 0 };
      l[outer] = { x: 0.46, y: 0.5, z: 0 };
      l[inner] = { x: 0.54, y: 0.5, z: 0 };
    }
    const radius = 11.7 / 400 / 2;
    for (const start of [469, 474])
      for (let j = 0; j < 4; j++)
        l[start + j] = {
          x: 0.5 + (Math.cos((j * Math.PI) / 2) * radius * i.fx) / i.width,
          y: 0.5 + (Math.sin((j * Math.PI) / 2) * radius * i.fy) / i.height,
          z: 0,
        };
    expect(irisDepth(l, i)).toBeCloseTo(400, 9);
  });
});
describe("experimental integrity", () => {
  it("missing metrics remain null", () => {
    expect(stats([]).median).toBeNull();
    expect(bootstrap([])).toBeNull();
  });
  it("bootstrap deterministic and centered", () => {
    expect(bootstrap([1, 1, 1, 1, 1])).toEqual([1, 1]);
  });
  it("rejects nonrigid or reflected profile transforms", () => {
    const p = {
      version: 1,
      id: "x",
      viewport: {
        screenWidth: 402,
        screenHeight: 874,
        width: 402,
        height: 700,
        dpr: 3,
        scale: 1,
        offsetLeft: 0,
        offsetTop: 0,
        originX: 0,
        originY: 0,
        orientation: "portrait-primary",
      },
      cards: [],
      mmPerCss: 0.18,
      screenMode: "card",
      transform: defaultTransform(),
    };
    p.transform.rotation[0] = 1;
    expect(() => validateProfile(p)).toThrow("handedness");
  });
  it("does not substitute simulated ground truth into independent error", () => {
    const t = {
      id: "test",
      condition: DEFAULT_CONDITION,
      samples: [
        {
          observation: {
            source: "simulated",
            time: 0,
            inferenceMs: 0,
            intervalMs: 0,
          },
          raw: { x: 0, y: 0, z: 400 },
          referenceDistanceMm: null,
        },
      ],
      renderIntervals: [],
    } as unknown as Trial;
    expect(summarize(t).depthAbsoluteErrorMm.median).toBeNull();
    expect(() => paired(t, DEFAULT_CONDITION, DEFAULT_CONDITION)).toThrow(
      "camera",
    );
  });
});

describe("additional validation gates", () => {
  it("rejects rays pointing away from the screen", () => {
    const o = syntheticGaze().map((o) => ({
      ...o,
      direction: { x: -o.direction.x, y: -o.direction.y, z: -o.direction.z },
    }));
    expect(fitTranslation(o, defaultTransform()).accepted).toBe(false);
    expect(fitTranslation(o, defaultTransform()).reason).toContain("away");
  });
  it("rejects validation samples relabeled from a training target", () => {
    const o = syntheticGaze();
    o.filter((o) => o.heldOut).forEach((o) => (o.targetId = "0"));
    expect(fitTranslation(o, defaultTransform()).reason).toContain("overlaps");
  });
});
