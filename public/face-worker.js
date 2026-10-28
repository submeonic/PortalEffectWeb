/* Classic worker: MediaPipe's WASM loader requires importScripts.
 * Uses the pinned local CommonJS bundle via its explicit exports object.
 * One transferred bitmap at a time; frames are closed immediately after inference.
 */
self.exports = {};
let model = null;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'initialize') {
      importScripts(new URL('vendor/vision_bundle.cjs', data.base).href);
      const files = await self.exports.FilesetResolver.forVisionTasks(new URL('vendor/mediapipe', data.base).href);
      model = await self.exports.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL('models/face_landmarker.task', data.base).href, delegate: 'CPU' },
        canvas: new OffscreenCanvas(1, 1), runningMode: 'VIDEO', numFaces: 1,
        outputFacialTransformationMatrixes: true, outputFaceBlendshapes: false,
        minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
      });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      try {
        const start = performance.now();
        const result = model.detectForVideo(data.bitmap, data.time);
        self.postMessage({ type: 'result', result: {
          matrix: result.facialTransformationMatrixes[0]?.data ?? null,
          landmarks: result.faceLandmarks[0] ?? [],
          detected: result.faceLandmarks.length > 0,
          inferenceMs: performance.now() - start,
        }});
      } finally { data.bitmap.close(); }
    }
  } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
};
