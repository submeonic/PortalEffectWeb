import type { Landmark } from "../types";
import { decodeAngle, gazeDirection, faceCrop, normalizeRGB } from "./math";
export class GazeProvider {
  private worker: Worker | null = null;
  private pending: {
    resolve: (data: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private crop = document.createElement("canvas");
  loadMs = 0;
  async initialize() {
    const start = performance.now();
    const base = new URL(import.meta.env.BASE_URL, location.href).href;
    this.worker = new Worker(new URL("gaze-worker.js", base));
    this.worker.onmessage = ({ data }) => {
      const p = this.pending;
      if (!p) return;
      clearTimeout(p.timer);
      this.pending = null;
      if (data.type === "error") p.reject(Error(data.message));
      else p.resolve(data);
    };
    this.worker.onerror = (e) =>
      this.abort(Error(e.message || "Gaze worker failed"));
    try {
      await this.request({ type: "initialize", base }, [], 60000);
    } catch (e) {
      this.dispose();
      throw e;
    }
    this.crop.width = this.crop.height = 448;
    this.loadMs = performance.now() - start;
  }
  private request(
    data: unknown,
    transfer: Transferable[] = [],
    timeout = 20000,
  ): Promise<any> {
    if (!this.worker || this.pending)
      return Promise.reject(Error("Gaze worker unavailable or busy"));
    return new Promise((resolve, reject) => {
      this.pending = {
        resolve,
        reject,
        timer: setTimeout(
          () => this.abort(Error("Gaze model timed out")),
          timeout,
        ),
      };
      this.worker!.postMessage(data, transfer);
    });
  }
  private abort(e: Error) {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(e);
      this.pending = null;
    }
  }
  async infer(frame: HTMLCanvasElement, landmarks: Landmark[]) {
    const crop = faceCrop(landmarks, frame.width, frame.height);
    if (!crop) return null;
    const context = this.crop.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(
      frame,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      448,
      448,
    );
    const pixels = normalizeRGB(context.getImageData(0, 0, 448, 448).data);
    const data = await this.request({ type: "frame", pixels }, [pixels.buffer]);
    const yaw = decodeAngle(data.yaw),
      pitch = decodeAngle(data.pitch);
    return {
      direction: gazeDirection(yaw, pitch),
      yaw,
      pitch,
      inferenceMs: data.inferenceMs as number,
      crop,
    };
  }
  dispose() {
    this.abort(Error("Gaze calibration stopped"));
    this.worker?.terminate();
    this.worker = null;
    this.crop.width = this.crop.height = 0;
  }
}
