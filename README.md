# Parallax Lab

A mobile-first, head-tracked Three.js comparison and physical-coordinate calibration research prototype. Built with Vite, TypeScript, MediaPipe Face Landmarker, Vitest and Playwright. It runs as an ordinary web page: no WebXR session, backend, account, or camera upload.

**Status:** working prototype; automated numerical and Chromium integration tests pass. Actual iPhone 16 Pro / Mobile Safari behavior and physical accuracy remain **awaiting hardware verification**. GitHub Pages deployment is configured for pushes to `master`.

## Run locally

Node 22.12+ or Node 24 recommended (developed with Node 24.15).

```bash
cd /mnt/projects/PortalEffectWeb
npm ci
npm run assets
npm run dev
```

Open `http://localhost:5173` on the same computer. The simulator works without camera access. Click **Enable head tracking** to grant front-camera access. First startup loads the local model and WASM. If initialization fails, the UI reports the error and the simulator remains available.

`npm run assets` downloads the versioned official Face Landmarker model, copies the pinned MediaPipe runtime into `public/vendor`, and writes its URL/SHA-256 to `public/models/provenance.json`. It also prepares the pinned calibration-only MobileGaze ONNX model and matching single-thread WASM runtime, recipe and provenance. The gaze worker validates the model hash at load time. Assets are deliberately excluded from Git; run this after a fresh clone or dependency update. Runtime model processing is local. The stylesheet optionally fetches Google Fonts; system fonts work without that network request.

```bash
npm test                 # numerical / algorithmic tests
npx playwright install chromium
npm run test:e2e         # Chromium UI and real-model fixture integration
npm run simulate        # docs/synthetic-results.json
npm run build           # type-check + static production bundle in dist/
npm run preview         # preview built output
npm run evaluate -- portal-session.json evaluation.json
```

The evaluation command replays face/iris methods against identical recorded inputs. It does not require camera access or run a gaze model.

## Open on an iPhone over HTTPS

Safari camera capture needs a secure origin. `http://192.168.x.x:5173` is **not** a secure origin just because your computer and phone share Wi-Fi. See [WebKit's capture-origin policy](https://webkit.org/blog/7763/a-closer-look-into-webrtc/).

Local HTTPS keeps the project on your network:

1. Install [mkcert](https://github.com/FiloSottile/mkcert) on the development computer. Find that computer's LAN IP, for example `192.168.1.20`.
2. Generate a local certificate covering **your actual IP**:

   ```bash
   mkcert -install
   mkdir -p .cert
   mkcert -key-file .cert/key.pem -cert-file .cert/cert.pem localhost 127.0.0.1 192.168.1.20
   PORTAL_TLS_CERT=.cert/cert.pem PORTAL_TLS_KEY=.cert/key.pem npm run dev
   ```

3. Transfer only `rootCA.pem` from the directory printed by `mkcert -CAROOT` to your iPhone. Install the certificate profile. Do not transfer `rootCA-key.pem`.
4. Enable its trust in **Settings → General → About → Certificate Trust Settings**. Apple documents this additional trust step for [manually installed certificates](https://support.apple.com/en-us/102390).
5. On the same network, open `https://192.168.1.20:5173` in Safari. Replace the example IP with your actual IP. Allow port 5173 through your computer's firewall. An execution container's loopback address is not reachable from the phone; run these commands on a LAN-accessible host or configure host port forwarding.
6. Hold the phone in portrait, use 100% page zoom, and enable head tracking. Check Diagnostics for the **actual** delivered video dimensions and backend.

The GitHub Actions workflow in [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) deploys to GitHub Pages whenever `master` is pushed, and can also be run manually from the Actions tab. It installs dependencies, prepares the versioned model and WASM assets, builds with `PORTAL_BASE_PATH=/PortalEffectWeb/`, and publishes `dist/` at `https://submeonic.github.io/PortalEffectWeb/`. The initial deployment starts after this workflow is pushed to `master`.

For another HTTPS static host, `npm run assets` followed by `npm run build` produces static `dist/`. Serve `.wasm` as `application/wasm`, `.js` as JavaScript, and the `.task` model as binary. For a subdirectory build, set `PORTAL_BASE_PATH=/your-path/ npm run build`. Ordinary HTTPS hosting does not require COOP/COEP for this single-threaded worker model.

## Compare and calibrate

1. **Calibration:** measure the portrait ID-1 card separately; repeat to assess precision. Enter the physical browser content origin if measured. Scale alone cannot locate Safari's content area on the panel.
2. **Portal:** A and B each select **iPhone 16 Pro — Reference** or **Unknown Device**, plus independently saved physical scale and gaze refinement. Unavailable/incompatible calibrations are disabled. Both use the same live observation and camera-space filtering.
3. **Depth inspection:** below the comparisons, a much larger portal has independent selections, a 32 mm cube, a physical cube-center slider and **Fill screen**. The default cube center is Z=0. Positive Z is toward the viewer in this codebase. A/B use identical 22 mm cubes. Every compartment is 25.4 mm deep.
4. **Gaze calibration:** four visible corner targets train a bounded camera X/Y correction; a center fixation and another center at a new head position validate it. The real 3D gaze model runs only during calibration. Save accepted fits and toggle them on matching portal conditions. Export rejected evidence as well as accepted evidence. See [GAZE.md](docs/GAZE.md).
5. **Experiments / Diagnostics:** original recording, paired depth replay, independent ruler annotations, raw/filtered observations, ratings, blind rendering comparison, intrinsics, iris experiments, synthetic bench and JSON/CSV imports/exports remain available. Record a trial, then visit Portal to collect rendered-frame timing.

The renderer now updates room/object/light placement with each HTML aperture and uses a near plane 1 mm from the eye so foreground geometry is retained. Uniform walls, square depth columns, real point-light falloff/shadows and screen-plane witness marks make the shallow geometry easier to assess.

Unknown Device does not inherit iPhone measurements. It starts with an explicitly assumed CSS reference-pixel scale (25.4/96 mm), generic top-center camera and zero physical content origin until calibrated/measured. Reference uses nominal 460 ppi at 3 physical pixels per CSS pixel and a declared 8 mm camera inset. Neither is independent ground truth.

Follow the physical protocol in [TESTING.md](TESTING.md), and see [the iteration review](docs/ITERATION.md) for the changes and verification evidence.

## Data and limitations

Calibration persists in browser localStorage. Recorded trials remain in memory until exported, are capped at 900 observations per trial, and can be reimported. Export regularly. JSON is the reproducible record (configuration, profile, original landmarks/matrices, timestamps and metadata); CSV is a flat analysis convenience. No camera images are recorded unless the explicit reference-frame checkbox is enabled and Download is clicked. Numeric facial observations are still personal research data; store exports accordingly.

Nominal geometry and MediaPipe metric depth are assumptions/estimates. Credit-card agreement with a manufacturer number is not independent accuracy. Iris diameter and focal length are confounded. The browser does not reliably expose the physical top of its content area relative to the whole display. Card scale becomes unavailable after incompatible display changes; width changes require placement review. Browser-height changes preserve scale but can change the unknown physical content origin. Unseen focus/crop/stabilization changes can still invalidate camera reference profiles.

Live gaze inference and target collection are implemented and fixture-tested in Chromium; iPhone Safari support, signs, runtime memory, performance and physical benefit still need measurement. It uses an appearance-based 3D model, not iris-center gaze or screen-coordinate regression. Compact accepted fits persist locally. The latest eight full numerical gaze runs remain in memory until session export; export the latest separately with **Export gaze evidence** before leaving. No raw camera frames are retained by the gaze collector.

Read [RESEARCH.md](RESEARCH.md) for coordinate conventions, estimands and limitations; [RESULTS.md](RESULTS.md) for the evidence-based report template; [MILESTONES.md](MILESTONES.md) for implementation and verification status.
