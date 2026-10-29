# Parallax Lab

A mobile-first, head-tracked Three.js window and calibration research prototype. Built with Vite, TypeScript, MediaPipe Face Landmarker, Vitest and Playwright. It runs as an ordinary web page: no WebXR session, backend, account, or camera upload.

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

`npm run assets` downloads the versioned official Face Landmarker model, copies the pinned MediaPipe runtime into `public/vendor`, and writes its URL/SHA-256 to `public/models/provenance.json`. Assets are deliberately excluded from Git; run this after a fresh clone or dependency update. Runtime model processing is local. The stylesheet optionally fetches Google Fonts; system fonts work without that network request.

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

## What works

- A cube, multiple-depth cubes, tunnel and wireframe scenes, physical frame and reference floor.
- Asymmetric perspective frusta from an explicit physical eye and the actual DOM canvas rectangle. Two portals share the same eye model.
- Simulated X/Y/Z controls, static perspective and naive rotation controls for comparison.
- Real single-face MediaPipe tracking, canonical eye proxies, head rotation, raw/filtered eye positions, graceful tracking loss, optional bounded prediction through saved configurations.
- CPU inference in a classic worker when supported, with one frame in flight. GPU/CPU main-thread fallback, adaptive tracking target, and measured inference versus render intervals.
- Nominal iPhone, generic and randomized repeatable credit-card scale calibration with local persistence and profile export/import.
- Iris depth with assumed or imported reference intrinsics, Brown–Conrady distortion inversion and a clearly experimental 50/50 fusion condition.
- Diagnostics, numerical recording, independent distance annotations, paired replay, summary statistics, randomized blind rendering comparisons, 1–7 ratings, comments, JSON/CSV export and JSON reimport.
- Seeded synthetic geometry studies and bounded X/Y gaze-ray fitting with regularization, conditioning checks, robust weighting, physical bounds and a withheld validation target.
- Explicit one-frame image-export opt-in and an optional Python/OpenCV checkerboard reference utility.

## First physical evaluation

1. In Portal, confirm simulated positive X changes perspective appropriately while the room stays fixed. Try each scene and the second portal.
2. Enable the camera. Move left/right and up/down; verify signs and loss/reacquisition. Export Diagnostics.
3. In Calibration, measure a portrait credit card five times. Compare variance and nominal agreement. Enter the physical content-origin offset under Advanced placement if known.
4. In Experiments, record stationary trials at independently measured 250, 400 and 600 mm. Write the measurement method and head orientation. Navigate to Portal while recording to collect actual rendered-frame statistics; return to Experiments to finish.
5. Select iris depth under Calibration, then run paired replay of a recorded camera trial. It holds the original trial's device profile fixed. Import reference intrinsics **before recording** when comparing reference versus assumed intrinsics.
6. Run the randomized blind comparison, rate all three variants, and repeat. Export JSON before leaving the page.
7. Follow the complete protocol and failure checklist in [TESTING.md](TESTING.md).

## Data and limitations

Calibration persists in browser localStorage. Recorded trials remain in memory until exported, are capped at 900 observations per trial, and can be reimported. Export regularly. JSON is the reproducible record (configuration, profile, original landmarks/matrices, timestamps and metadata); CSV is a flat analysis convenience. No camera images are recorded unless the explicit reference-frame checkbox is enabled and Download is clicked. Numeric facial observations are still personal research data; store exports accordingly.

Nominal geometry and MediaPipe metric depth are assumptions/estimates. Credit-card agreement with a manufacturer number is not independent accuracy. Iris diameter and focal length are confounded. The browser does not reliably expose the physical top of its content area relative to the whole display. Card-mode live rendering suspends after relevant viewport changes until placement is confirmed. Unseen focus/crop/stabilization changes can still invalidate camera reference profiles.

Live gaze-model inference and automatic four-corner fixation collection are **not integrated**. The advanced importer accepts externally supplied genuine 3D gaze observations; the fit is implemented and tested. See [GAZE.md](docs/GAZE.md) for model research and the remaining device/license/convention validation gates. No iris-center approximation is presented as gaze.

Read [RESEARCH.md](RESEARCH.md) for coordinate conventions, estimands and limitations; [RESULTS.md](RESULTS.md) for the evidence-based report template; [MILESTONES.md](MILESTONES.md) for implementation and verification status.
