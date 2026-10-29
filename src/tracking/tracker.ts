import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { Observation } from "../types";
type FrameResult = Pick<
  Observation,
  "matrix" | "landmarks" | "detected" | "inferenceMs"
>;
export class Tracker {
  model: FaceLandmarker | null = null;
  // Calibration hook receives the exact frozen frame used for the face estimate.
  onFrame:
    | ((observation: Observation, frame: HTMLCanvasElement) => Promise<void>)
    | null = null;
  private frame = document.createElement("canvas");
  running = false;
  targetHz = 24;
  delegate = "initializing";
  fallbackReason: string | null = null;
  private worker: Worker | null = null;
  private pending: ((result: FrameResult) => void) | null = null;
  private failed: ((error: Error) => void) | null = null;
  private timer = 0;
  private lastVideo = -1;
  private lastTime = 0;
  async initialize() {
    const base = new URL(import.meta.env.BASE_URL, location.href).href;
    if (
      typeof Worker !== "undefined" &&
      typeof OffscreenCanvas !== "undefined" &&
      typeof createImageBitmap !== "undefined"
    ) {
      try {
        const worker = new Worker(new URL("face-worker.js", base));
        this.worker = worker;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(Error("Worker initialization timed out")),
            15000,
          );
          worker.onerror = (e) => {
            clearTimeout(timeout);
            reject(Error(e.message));
          };
          worker.onmessage = ({ data }) => {
            if (data.type === "ready") {
              clearTimeout(timeout);
              resolve();
            } else if (data.type === "error") {
              clearTimeout(timeout);
              reject(Error(data.message));
            }
          };
          worker.postMessage({ type: "initialize", base });
        });
        worker.onmessage = ({ data }) => {
          if (data.type === "result") {
            this.pending?.(data.result);
            this.pending = null;
            this.failed = null;
          } else if (data.type === "error") {
            this.failed?.(Error(data.message));
            this.pending = null;
            this.failed = null;
          }
        };
        worker.onerror = (e) => this.failed?.(Error(e.message));
        this.delegate = "worker CPU";
        return;
      } catch (e) {
        this.fallbackReason = String(e);
        this.worker?.terminate();
        this.worker = null;
      }
    }
    const files = await FilesetResolver.forVisionTasks(
      `${base}vendor/mediapipe`,
    );
    const options = {
      baseOptions: {
        modelAssetPath: `${base}models/face_landmarker.task`,
        delegate: "GPU" as const,
      },
      runningMode: "VIDEO" as const,
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
      minFaceDetectionConfidence: 0.6,
      minFacePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    };
    try {
      this.model = await FaceLandmarker.createFromOptions(files, options);
      this.delegate = "main-thread GPU";
    } catch {
      this.model = await FaceLandmarker.createFromOptions(files, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" },
      });
      this.delegate = "main-thread CPU";
    }
  }
  start(
    video: HTMLVideoElement,
    callback: (o: Observation) => void,
    onError: (e: unknown) => void,
  ) {
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      const started = performance.now();
      if (
        !document.hidden &&
        video.readyState >= 2 &&
        video.currentTime !== this.lastVideo
      ) {
        this.lastVideo = video.currentTime;
        try {
          let result: FrameResult;
          const hook = this.onFrame;
          let source: HTMLVideoElement | HTMLCanvasElement = video;
          if (hook) {
            this.frame.width = video.videoWidth;
            this.frame.height = video.videoHeight;
            this.frame.getContext("2d")!.drawImage(video, 0, 0);
            source = this.frame;
          }
          if (this.worker) {
            const bitmap = await createImageBitmap(source);
            if (!this.running) {
              bitmap.close();
              return;
            }
            result = await new Promise<FrameResult>((resolve, reject) => {
              const timeout = setTimeout(
                () => reject(Error("Worker inference timed out")),
                10000,
              );
              this.pending = (r) => {
                clearTimeout(timeout);
                resolve(r);
              };
              this.failed = (e) => {
                clearTimeout(timeout);
                reject(e);
              };
              this.worker!.postMessage(
                { type: "frame", bitmap, time: started },
                [bitmap],
              );
            });
          } else {
            const inferenceStarted = performance.now(),
              r = this.model!.detectForVideo(source, started);
            result = {
              matrix: r.facialTransformationMatrixes[0]?.data ?? null,
              landmarks: r.faceLandmarks[0] ?? [],
              detected: r.faceLandmarks.length > 0,
              inferenceMs: performance.now() - inferenceStarted,
            };
          }
          if (!this.running) return;
          const observation: Observation = {
            ...result,
            time: started,
            source: "camera",
            width: video.videoWidth,
            height: video.videoHeight,
            intervalMs: this.lastTime ? started - this.lastTime : 0,
            quality: null,
            processingMs: performance.now() - started,
          };
          callback(observation);
          // Hook handles its own inference failures; normal tracking stays usable.
          if (hook && this.onFrame === hook)
            await hook(observation, this.frame);
          this.lastTime = started;
          if (result.inferenceMs > 45)
            this.targetHz = Math.max(10, this.targetHz - 1);
          else if (result.inferenceMs < 22)
            this.targetHz = Math.min(24, this.targetHz + 0.05);
        } catch (e) {
          if (!this.running) return;
          this.stop();
          onError(e);
          return;
        }
      }
      this.timer = window.setTimeout(
        tick,
        Math.max(4, 1000 / this.targetHz - (performance.now() - started)),
      );
    };
    void tick();
  }
  stop() {
    this.running = false;
    this.onFrame = null;
    this.frame.width = this.frame.height = 0;
    clearTimeout(this.timer);
    this.failed?.(Error("Tracking stopped"));
    this.pending = null;
    this.failed = null;
    this.worker?.terminate();
    this.worker = null;
    this.model?.close();
    this.model = null;
    this.lastTime = 0;
    this.lastVideo = -1;
  }
}
