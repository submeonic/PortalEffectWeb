import type { Vec3, Condition } from "../types";
import { add, mul, sub, norm } from "../geometry/math";
export class PoseFilter {
  private x: Vec3 | null = null;
  private raw: Vec3 | null = null;
  private velocity: Vec3 = { x: 0, y: 0, z: 0 };
  private time = 0;
  private method = "";
  reset() {
    this.x = null;
    this.raw = null;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.time = 0;
  }
  update(
    p: Vec3,
    time: number,
    method: Condition["filter"],
    predictionMs = 0,
  ): Vec3 {
    if (method !== this.method) {
      this.reset();
      this.method = method;
    }
    const dt = (time - this.time) / 1000;
    this.time = time;
    if (!this.x || !this.raw || dt <= 0 || dt > 0.5) {
      this.x = { ...p };
      this.raw = { ...p };
      return { ...p };
    }
    const previous = this.x;
    if (method === "none") {
      this.x = { ...p };
      this.velocity = { x: 0, y: 0, z: 0 };
    } else if (method === "euro") {
      const derivative = mul(sub(p, this.raw), 1 / dt),
        a = 1 / (1 + 1 / (2 * Math.PI * dt));
      this.velocity = add(mul(this.velocity, 1 - a), mul(derivative, a));
      const cutoff = 1.2 + 0.008 * norm(this.velocity),
        alpha = 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
      this.x = add(mul(this.x, 1 - alpha), mul(p, alpha));
    } else {
      const predicted = add(this.x, mul(this.velocity, dt)),
        residual = sub(p, predicted);
      this.x = add(predicted, mul(residual, 0.55));
      this.velocity = add(this.velocity, mul(residual, 0.08 / dt));
    }
    this.raw = { ...p };
    const velocity =
      method === "none"
        ? { x: 0, y: 0, z: 0 }
        : mul(sub(this.x, previous), 1 / dt);
    return add(
      this.x,
      mul(velocity, Math.min(40, Math.max(0, predictionMs)) / 1000),
    );
  }
}
