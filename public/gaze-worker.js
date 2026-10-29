/* Created only for calibration; terminate() releases the entire ORT/WASM heap. */
let session;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "initialize") {
      importScripts(new URL("vendor/onnx/ort.wasm.min.js", data.base).href);
      ort.env.wasm.wasmPaths = new URL("vendor/onnx/", data.base).href;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const response = await fetch(
        new URL("models/mobilegaze.onnx", data.base),
      );
      if (!response.ok)
        throw Error(`Gaze model HTTP ${response.status}; run npm run assets`);
      const bytes = await response.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (x) => x.toString(16).padStart(2, "0"),
      ).join("");
      if (
        hash !==
        "7367559b5d95ca3d74d85cb117b38ccd6bb0f0ca5eb0311ecef4129baa9b8fbc"
      )
        throw Error("Gaze model checksum mismatch");
      session = await ort.InferenceSession.create(bytes, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      if (
        session.inputNames[0] !== "x0" ||
        session.outputNames.join(",") !== "linear,linear_1"
      )
        throw Error("Unexpected gaze model interface");
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame") {
      const input = new ort.Tensor("float32", data.pixels, [1, 3, 448, 448]);
      const start = performance.now();
      const output = await session.run({ x0: input });
      self.postMessage({
        type: "result",
        yaw: Array.from(output.linear.data),
        pitch: Array.from(output.linear_1.data),
        inferenceMs: performance.now() - start,
      });
      input.dispose();
      Object.values(output).forEach((t) => t.dispose());
    }
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  }
};
