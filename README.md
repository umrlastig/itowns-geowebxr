# STAG — Outdoor augmented reality with GeoWebXR and iTowns

STAG (System for ouTdoor Augmented reality using GeoWebXR) displays 3D urban
planning scenarios at 1:1 scale in the real world, in the browser of a Meta
Quest 3. A dual-antenna RTK GNSS receiver mounted on the headset georeferences
the WebXR scene through a new `geo` reference space (GeoWebXR).

The demo shows three renovation scenarios of the Loos-en-Gohelle médiathèque.

```
UM982 RTK GNSS (2 antennas) ─USB-C─> GNSS Master (Quest app, NTRIP corrections)
                                          │ NMEA over TCP (localhost)
                                          ▼
                               GNSS bridge (bridge/, Termux on the Quest)
                                          │ JSON over ws://127.0.0.1:5005
                                          ▼
Quest Browser ── GeoWebXR 'geo' reference space (src/geowebxr/)
              └─ iTowns scene: terrain, buildings, scenarios (src/index.js, src/stag/)
```

## Repository layout

| Path | Content |
|---|---|
| `src/index.js` | The STAG application: mode selection, iTowns view, modes A/B/C, path recording |
| `src/geowebxr/` | GeoWebXR polyfill: `geo` reference space, GNSS providers, geopose estimation. Has no iTowns or three.js dependency |
| `src/stag/` | Glue between GeoWebXR and the iTowns scene (`applyGeoPose`) |
| `bridge/` | GNSS bridge: GNSS Master NMEA → WebSocket JSON. See [bridge/README.md](bridge/README.md) |
| `public/` | `index.html`, 3D models (`obj/`), iTowns layer configurations (`JSONLayers/`) |

## Requirements

- **Hardware**: Meta Quest 3, a Unicore UM982 receiver with two antennas mounted
  on the headset (transverse baseline, about 30 cm), a USB-C cable, and internet
  access (for example a phone hotspot) for the NTRIP corrections.
- **Software**: Node.js ≥ 18 and npm on the development computer, plus `adb`
  (Android platform tools) to set up the headset.

## Quickstart (desktop)

```sh
npm ci          # install the exact dependency versions
npm start       # development server on http://localhost:8080
```

Open http://localhost:8080. Without a headset you can check the iTowns view and
the mode selection screen. To test the XR part on a desktop, use a WebXR
emulator, for example the *Immersive Web Emulator* browser extension, together with a fixed GNSS
position:

```
http://localhost:8080/?gnss=fixed:50.457058,2.794119,97.9,90
```

The last value is a simulated antenna baseline heading. With 90°, the emulated
headset is treated as facing North at its starting orientation. This only
applies to this test mode: with the real receiver the heading is measured, and
the user can face any direction during the georeferencing.

## Running on the Meta Quest

WebXR only runs in a secure context: HTTPS, or `localhost`. The simplest setup
is to forward the development server to the headset over USB:

1. Enable developer mode on the Quest (Meta Horizon phone app) and connect it with USB.
2. Start the app and forward its port:
   ```sh
   npm start
   adb reverse tcp:8080 tcp:8080
   ```
3. In the Quest Browser, open **http://localhost:8080**.

For use without a cable, build the app (`npm run build`) and serve `dist/` from
any HTTPS web server.

### GNSS setup

Install and start the GNSS bridge on the headset once, following
[bridge/README.md](bridge/README.md). In short: install Termux, run `install-termux.sh`, configure
GNSS Master to output NMEA (GGA + GPHPD) over a TCP server, and check
http://127.0.0.1:5005/status in the Quest Browser.

Before each session:
1. Connect the receiver, start GNSS Master, and wait for an **RTK fixed**
   solution with a valid heading.
2. Make sure the bridge is running (`/status` shows `upstream: connected`).

## Using the app

### 1. Choose a mode
The start screen offers three ways to select a scenario (A, B or C, described
below). Pick one and press **Démarrer l'expérience XR**, then the XR button.

### 2. Georeferencing: stand still for 3 seconds
When the XR session starts, the `geo` reference space estimates its geopose.
**Stand still for about 3 seconds, facing any direction, with the head roughly
level.** No particular orientation (e.g. facing North) is needed: the heading
measured by the two antennas is combined with the headset orientation at the
same instant.
- GNSS epochs are kept only if they have an RTK fixed solution, a valid heading,
  and the headset did not move. Their heading and position are averaged, and
  outliers are removed.
- When the estimate is done, the whole scene (terrain, buildings, scenarios) snaps to
  the real world. The status, accuracy and number of epochs used appear in the
  page info panel and the browser console.
- If no estimate succeeds within 30 s (no RTK fix, no bridge, user moving), it
  retries automatically.
- If the headset loses tracking, the geopose is discarded and estimated again.

At the start of the session, the base map is hidden and the background made
transparent, so the passthrough camera shows the real world (augmented reality).

### 3. Explore the scenarios
In all modes the selected scenario appears at 1:1 scale at its real location,
replacing the others.

| Mode | How to select a scenario | Controls |
|---|---|---|
| **A — Virtual mock-ups** | Three small models stand on the ground near the site. Point at one with the right controller and press the right **grip**. A colored ring marks the selected one. | Right grip: select |
| **B — Pad navigation** | Scenarios are shown in turn at full scale. | Right thumbstick ← →: previous / next scenario. **A** button: estimate the geopose again (stand still) |
| **C — Physical mock-ups** | Rings mark where the printed mock-ups stand on a table in front of the user. Point at one and press the right **grip** (the pointed ring turns white), then release to select it. | Right grip: point / select |

### 4. Path recording
The headset position is recorded every 0.5 s during the session.
- When the session ends, the path is downloaded as GeoJSON
  (`stag_path_mode<M>_<date>.geojson`). It contains a LineString of the path and
  one timestamped Point per sample, in WGS84.
- The path is also saved in the browser after each sample. If the page was closed
  before the end of the session, the start screen shows
  **⬇ Télécharger le parcours précédent** to recover it.

### URL parameters

| Parameter | Effect |
|---|---|
| *(none)* | Read the GNSS from the local bridge `ws://127.0.0.1:5005` |
| `?gnss=ws://HOST:PORT` | Use another bridge, e.g. one replaying a recorded session |
| `?gnss=fixed:LAT,LON,ALT,HEADING` | Constant RTK-fixed GNSS position and baseline heading, for desktop/emulator tests. ALT is the ellipsoidal height in meters |

## Configuration

These values live at the top of `src/index.js`:

| Constant | Meaning |
|---|---|
| `GEOWEBXR_OPTIONS.baselineInViewer` | Direction from the master to the slave antenna in the headset frame (x right, y up, z back). Default `[1, 0, 0]`: slave antenna on the right |
| `GEOWEBXR_OPTIONS.leverArm` | Master antenna position relative to the headset, in meters. **Measure it on your prototype**: the default `[0, 0, 0]` causes a position error the size of the mount |
| `MODEL_NAMES`, `SCENARIO_LABELS`, `SCENARIO_COLORS` | Scenario models (OBJ/MTL files in `public/obj/`), names and colors |
| `INSITU`, `HEADING_DEG` | ECEF position and heading of the full-scale models |
| `PHYSICAL_MODEL_OFFSETS` (mode C) | Positions of the printed mock-ups relative to the XR origin, in meters |

`GEOWEBXR_OPTIONS` also accepts the estimator settings defined in
`src/geowebxr/estimator.js` (`DEFAULT_OPTIONS`):
- calibration duration and minimum number of epochs,
- stillness thresholds,
- `requireRtkFixed`,
- `transportLatencyMs`.

To use another site or other models, change `placement` (initial view),
`INSITU`/`HEADING_DEG` and the model files.

## GeoWebXR API

`src/geowebxr/` adds the `geo` reference space proposed in the STAG paper. It
works with any WebXR application, not only iTowns:

```js
import { installGeoWebXR, BridgeProvider } from './geowebxr/index.js';

installGeoWebXR({
    provider: new BridgeProvider('ws://127.0.0.1:5005'),
    estimator: { baselineInViewer: [1, 0, 0], leverArm: [0, 0, 0] },
});

// three.js: renderer.xr.setReferenceSpaceType('geo');
const space = await session.requestReferenceSpace('geo');
space.addEventListener('geoposechange', () => {
    const { position, quaternion, headingDeg, accuracy } = space.geopose;
    // position: { lat, lon, h } of the XR origin (ellipsoidal height)
    // quaternion: rotation from XR reference space axes to East-North-Up
});
space.geoXR.calibrate(); // estimate again (the user should stand still)
```

- `'geo'` may be listed in `requiredFeatures`/`optionalFeatures`. It is replaced by
  the base space (`local-floor` by default, `baseType` option).
- Events on the space: `geoposechange`, and `geostatus` (`calibrating` with progress,
  `ready`, `error`). The native `reset` event triggers a new estimate.
- Providers: `BridgeProvider` (GNSS bridge) and `FixedProvider` (tests). A new
  provider only needs to dispatch `gnss` events in the bridge message format.
- In iTowns, `applyGeoPose(view.webXR.vrControls.groupXR, space.geopose)`
  (`src/stag/geoAnchor.js`) places the XR scene root in ECEF.

## Development

```sh
npm start            # development server (webpack serve)
npm run start-prod   # development server with a production build
npm run build        # production bundle in dist/
npm run build-dev    # development bundle in dist/
```

## Known limitations

- The geopose is estimated from a static window at the start of the session (or on demand).
  Headset drift is not corrected continuously.
- The heading accuracy shown is a lower bound. It does not include lever-arm or
  antenna/headset misalignment errors, and GNSS noise is correlated over time.
- The full-scale model placement (`INSITU`, `HEADING_DEG`) was tuned by hand
  before the `geo` reference space existed. It may need to be checked on site.
- Only mode B has a button to estimate the geopose again.

## Citation

C. Gautier, M. Brédif. *STAG: System for ouTdoor Augmented reality using
GeoWebXR*. ISPRS Annals of the Photogrammetry, Remote Sensing and Spatial
Information Sciences, XI-4-2026, pp. 213-220, 2026.
https://doi.org/10.5194/isprs-annals-XI-4-2026-213-2026

## Resources

- [iTowns][itowns], [API][itowns:API], [examples][itowns:examples],
  [tutorials][itowns:tutorials], [issues][itowns:issues]
- [WebXR Device API](https://www.w3.org/TR/webxr/)
- [OGC GeoPose](https://www.ogc.org/standards/geopose/)

[itowns]: https://github.com/iTowns/itowns
[itowns:API]: http://www.itowns-project.org/itowns/docs/#home
[itowns:examples]: http://www.itowns-project.org/itowns/examples/
[itowns:issues]: https://github.com/iTowns/itowns/issues
[itowns:tutorials]: http://www.itowns-project.org/itowns/docs/#tutorials/Fundamentals
