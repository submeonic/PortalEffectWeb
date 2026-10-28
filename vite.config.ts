import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
const https =
  process.env.PORTAL_TLS_CERT && process.env.PORTAL_TLS_KEY
    ? {
        cert: readFileSync(process.env.PORTAL_TLS_CERT),
        key: readFileSync(process.env.PORTAL_TLS_KEY),
      }
    : undefined;
export default defineConfig({
  base: process.env.PORTAL_BASE_PATH ?? "/",
  server: { host: "0.0.0.0", https },
  preview: { host: "0.0.0.0", https },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          mediapipe: ["@mediapipe/tasks-vision"],
        },
      },
    },
  },
});
