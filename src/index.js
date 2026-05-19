import * as itowns from 'itowns';
import * as THREE from 'three';
import { XRButton } from 'three/addons/webxr/XRButton.js';
import { createText } from 'three/addons/webxr/Text2D.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

// ==================== MODE SELECTION ====================
let selectedMode = null;
const cards    = document.querySelectorAll('.mode-card');
const startBtn = document.getElementById('startBtn');

cards.forEach(card => {
    card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedMode = card.dataset.mode;
        startBtn.classList.add('ready');
    });
});

startBtn.addEventListener('click', () => {
    if (!selectedMode) return;
    document.getElementById('modeSelection').style.display = 'none';
    document.getElementById('description').style.display = 'block';
    initXR(selectedMode);
});

// ==================== CONSTANTS ====================
const DEFAULT_POS = { longitude: 2.794119, latitude: 50.457058 };

// ECEF position of the in-situ mediatheque location (Loos-en-Gohelle)
const INSITU = { x: 4063966, y: 198367, z: 4895353 };
// const ALTERNATIVE_A = { x: 4063974.2910459707, y: 198354.20224887572, z: 4895347.954892088 };

const MODEL_NAMES = [
    'LEG-media_library_V2',
    'LEG-media_library_alternative_A_V1',
    'LEG-media_library_alternative_B_V1',
];
const SCENARIO_LABELS = ['Scénario actuel', 'Scénario A', 'Scénario B'];
const SCENARIO_COLORS = [0x4488ff, 0xff8844, 0x44dd88];

// Heading adjustments degrees, around local "up".
const HEADING_DEG   = -45;

// ==================== GNSS ====================
let TCP_status = 'Disconnected';
let data = { geo: { longitude: null, latitude: null, altitude: null }, rotation: { heading: null, pitch: null } };

async function waitForGNSS() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket('wss://10.73.118.207:5005');
        ws.onopen  = () => { TCP_status = 'Connected'; };
        ws.onmessage = (event) => {
            try {
                const gnss = JSON.parse(event.data);
                if (gnss.valid) { ws.close(); resolve(gnss); }
            } catch (e) { console.warn('GNSS parse error:', e); }
        };
        ws.onerror = (e) => { TCP_status = 'Disconnected'; reject(e); };
        ws.onclose = () => { TCP_status = 'Disconnected'; };
    });
}

// ==================== INIT XR ====================
async function initXR(mode) {
    let geopose;
    // try {
    //     const gnss = await waitForGNSS();
    //     data.geo      = { longitude: gnss.lon, latitude: gnss.lat, altitude: gnss.alt };
    //     data.rotation = { heading: gnss.headingDeg, pitch: gnss.pitchDeg };
    //     TCP_status    = 'Connected';
    //     geopose = fromGNSS(gnss, gnss.rotation.yaw, gnss.rotation.pitch, gnss.rotation.roll);
    //     geopose.validate();
    // } catch (e) {
    //     data.geo = DEFAULT_POS;
    //     console.warn('GNSS unavailable, using default position.', e);
    //     geopose = new GeoPose(data.geo.latitude, data.geo.longitude, 0, 0, 0, 0);
    // }

    // itowns.updateGNSSStatus(TCP_status, data);

    // Camera centered on the mediatheque, ~80 m back, tilted 30° down, heading toward the building
    const placement = {
        coord:   new itowns.Coordinates('EPSG:4326', 2.794119, 50.457058),
        range:   10,
        tilt:    5,
        heading: 50,
    };
    const viewerDiv = document.getElementById('viewerDiv');
    const view = new itowns.GlobeView(viewerDiv, placement, { webXR: { controllers: true, cameraOnGround: true } });

    view.renderer.xr.enabled = true;
    viewerDiv.appendChild(XRButton.createButton(view.renderer, {
        requiredFeatures: ['local'],
        // depthSensing: {
        //     usagePreference: ['gpu-optimized', 'cpu-optimized'],
        //     dataFormatPreference: ['float32', 'luminance-alpha'],
        // },
    }));

    // Layers
    function addElevation(config) {
        config.source = new itowns.WMTSSource(config.source);
        view.addLayer(new itowns.ElevationLayer(config.id, config));
    }
    itowns.Fetcher.json('./JSONLayers/Ortho.json').then(config => {
        config.source = new itowns.WMTSSource(config.source);
        view.addLayer(new itowns.ColorLayer('Ortho', config));
    });
    itowns.Fetcher.json('./JSONLayers/IGN_MNT_HIGHRES.json').then(addElevation);
    itowns.Fetcher.json('./JSONLayers/WORLD_DTM.json').then(addElevation);

    // WFS buildings
    // const wfsSrc = new itowns.WFSSource({
    //     url: 'https://data.geopf.fr/wfs/ows?', version: '2.0.0',
    //     typeName: 'BDTOPO_V3:batiment', crs: 'EPSG:4326', ipr: 'IGN', format: 'application/json',
    // });
    // const altitudeFn = p => p.altitude_minimale_sol;
    // const extrudeFn  = p => p.hauteur;
    // const filterFn   = p => !!p.hauteur;
    // const colorFn    = p => {
    //     const map = { 'Résidentiel': 0xFDFDFF, 'Commercial et services': 0x62929E, 'Sportif': 0x546A7B };
    //     return new itowns.THREE.Color(map[p.usage_1] || 0x555555);
    // };
    // const wire = new itowns.FeatureGeometryLayer('WFS Building Wireframe', {
    //     batchId: (_, id) => id, filter: filterFn, source: wfsSrc, zoom: { min: 14 },
    //     style: { fill: { color: new THREE.Color(0x000000), base_altitude: altitudeFn, extrusion_height: extrudeFn } },
    // });
    // wire.wireframe = true;
    // view.addLayer(wire);
    // view.addLayer(new itowns.FeatureGeometryLayer('WFS Building', {
    //     batchId: (_, id) => id, filter: filterFn, source: wfsSrc, zoom: { min: 14 },
    //     style: { fill: { color: colorFn, opacity: 0.2, base_altitude: altitudeFn, extrusion_height: extrudeFn } },
    // }));

    setupMediathequeXR(view, createText, data.rotation, mode);
}

function setTransparentData(view) {
    function findMeshinChildren(featureMesh) {
        const children = featureMesh.children[0];
        if (children.isMesh) {
            const material = new THREE.MeshBasicMaterial({ color: children.material.color });
            material.transparent = true;
            material.opacity = 0.5;
            material.blending = THREE.CustomBlending;
            material.blendEquation = THREE.SubtractEquation;
            material.blendSrc = THREE.SrcAlphaFactor;
            material.blendDst = THREE.ZeroFactor;
            children.material = material;
        } else {
            findMeshinChildren(children);
        }
    }
    view.renderer.setClearColor(new THREE.Color(), 0);
    view.tileLayer.opacity = 0;
    const layer = view.getLayers().find(l => l.id === 'WFS Building');
    if (layer) {
        layer.whenReady.then(() => {
            layer.object3d.children.forEach((featureMesh) => {
                findMeshinChildren(featureMesh);
                view.notifyChange();
            }); 
        });
    }
    view.notifyChange();
}

// ==================== HELPERS ====================

/** Place and orient an object at the in-situ ECEF position. */
function placeInSitu(view, obj) {
    obj.position.set(INSITU.x, INSITU.y, INSITU.z);
    const coord = new itowns.Coordinates('EPSG:4978', obj.position.x, obj.position.y, obj.position.z - 3).as('EPSG:4978');
    coord.toVector3(obj.position);
    obj.lookAt(coord.geodesicNormal.clone().add(obj.position));
    itowns.DEMUtils.placeObjectOnGround(view.tileLayer, 'EPSG:4978', obj);
    obj.rotateOnAxis(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    obj.rotateOnAxis(new THREE.Vector3(0, 0, -1), THREE.MathUtils.degToRad(HEADING_DEG));
    obj.updateMatrixWorld();
}

/** Load all 3 in-situ models (full scale, all hidden). Returns array. */
async function loadInSituModels(view) {
    const ambientLight = new THREE.AmbientLight(0x404040, 5);
    view.scene.add(ambientLight);
    const models = [];
    for (const name of MODEL_NAMES) {
        const mat = await new MTLLoader().setPath('obj/').loadAsync(`${name}.mtl`);
        mat.preload();
        const obj = await new OBJLoader().setPath('obj/').setMaterials(mat).loadAsync(`${name}.obj`);
        obj.name    = name;
        obj.visible = false;
        placeInSitu(view, obj);
        view.scene.add(obj);
        models.push(obj);
    }
    return models;
}

/** Show only scenario at index, hide others. */
function showScenario(models, index, view) {
    models.forEach((m, i) => { m.visible = i === index; });
    view.notifyChange();
}

/** Create a 3D text label attached to a controller. */
function makeControllerLabel(text, position = new THREE.Vector3(0, 0.12, 0)) {
    const label = createText(text, 0.025);
    label.position.copy(position);
    return label;
}

/** Raycast from a controller's line. Returns intersected objects. */
function raycastFromController(controller, targets) {
    let line = null;
    controller.children.forEach(child => { if (child.isLine) line = child; });
    if (!line) return [];
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    line.getWorldPosition(pos);
    line.getWorldDirection(dir);
    const raycaster = new THREE.Raycaster();
    raycaster.ray.origin    = pos;
    raycaster.ray.direction = dir.multiplyScalar(-1);
    return raycaster.intersectObjects(targets, true);
}

// ==================== PATH TRACKING ====================

const SAMPLE_MS   = 500; // ms between position samples
const STORAGE_KEY = 'stag_xr_path';

/** Persist current samples to localStorage so a page reload can recover them. */
function persistPath(samples, mode, startTime) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ samples, mode, startTime })); }
    catch (e) { /* quota exceeded — silently skip */ }
}

/**
 * Start sampling the XR camera position every SAMPLE_MS milliseconds.
 * Saves to localStorage on every sample so a reload never loses data.
 * Returns a tracker object; call tracker.stop() to get the raw points.
 */
function startPathTracking(view, mode) {
    const samples   = [];
    const startTime = Date.now();
    localStorage.removeItem(STORAGE_KEY); // clear any previous session
    const interval  = setInterval(() => {
        const pos = new THREE.Vector3();
        view.camera.camera3D.getWorldPosition(pos);
        samples.push({ x: pos.x, y: pos.y, z: pos.z, t: Date.now() - startTime });
        persistPath(samples, mode, startTime); // write after every sample
    }, SAMPLE_MS);
    return { stop: () => { clearInterval(interval); return samples; }, mode, startTime };
}

// On page load: check for a saved path from a previous (interrupted) session
// and show the download button if one exists.
(function checkPreviousPath() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!saved?.samples?.length) return;
        const btn = document.getElementById('prevPathBtn');
        btn.style.display = 'inline-block';
        btn.addEventListener('click', () => {
            const geojson = buildPathGeoJSON(saved.samples, saved.mode, saved.startTime);
            downloadGeoJSON(geojson, saved.mode, saved.startTime);
            localStorage.removeItem(STORAGE_KEY);
            btn.style.display = 'none';
        });
    } catch (e) { /* corrupt data — ignore */ }
})();

/**
 * Convert ECEF samples → WGS84 GeoJSON FeatureCollection.
 * Contains one LineString (the path) + one Point per sample (with timestamp).
 */
function buildPathGeoJSON(samples, mode, startTime) {
    const wgs84 = samples.map(s => {
        const c = new itowns.Coordinates('EPSG:4978', s.x, s.y, s.z).as('EPSG:4326');
        return { lon: c.longitude, lat: c.latitude, alt: c.altitude, t: s.t };
    });

    return {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: wgs84.map(p => [p.lon, p.lat, p.alt]) },
                properties: {
                    mode,
                    start_iso:   new Date(startTime).toISOString(),
                    duration_s:  Math.round((samples[samples.length - 1]?.t || 0) / 1000),
                    sample_count: samples.length,
                },
            },
            ...wgs84.map((p, i) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [p.lon, p.lat, p.alt] },
                properties: { index: i, t_ms: p.t, t_s: Math.round(p.t / 1000) },
            })),
        ],
    };
}

/** Trigger a browser download of the GeoJSON file. */
function downloadGeoJSON(geojson, mode, startTime) {
    const ts   = new Date(startTime).toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `stag_path_mode${mode}_${ts}.geojson`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== MAIN XR SETUP (mode dispatcher) ====================
function setupMediathequeXR(view, createText, rotation, mode) {
    const xr = view.renderer.xr;
    let tracker = null;

    xr.addEventListener('sessionstart', async function () {
        const vrControls = view.webXR.vrControls;
        const session    = xr.getSession ? xr.getSession() : this.getSession();

        // Start recording the user's path immediately
        tracker = startPathTracking(view, mode);

        setTransparentData(view);

        // Enable depth sensing for occlusion
        if (session && session.requestDepthSensing) {
            try { session.requestDepthSensing(); } catch (e) { console.warn('Depth sensing:', e.message); }
        }

        // All modes need in-situ models
        const inSituModels = await loadInSituModels(view);

        if (mode === 'A') {
            setupModeA(view, vrControls, inSituModels, xr);
        } else if (mode === 'B') {
            setupModeB(view, vrControls, inSituModels);
        } else if (mode === 'C') {
            setupModeC(view, vrControls, inSituModels);
        }
    });

    xr.addEventListener('sessionend', function () {
        if (!tracker) return;
        const samples = tracker.stop();
        if (samples.length > 1) {
            const geojson = buildPathGeoJSON(samples, tracker.mode, tracker.startTime);
            downloadGeoJSON(geojson, tracker.mode, tracker.startTime);
        }
        tracker = null;
    });
}

// ==================== MODE B — Pad navigation ====================
// Right thumbstick left/right cycles scenarios in-situ.
// A text label on the right controller guides the user.
function setupModeB(view, vrControls, inSituModels, xr) {
    let currentIndex = 0;
    let padCooldown  = false;

    // Show first scenario immediately
    showScenario(inSituModels, 0, view);

    // Floating scenario name label (world space, in front of user)
    const scenarioLabel = createText(SCENARIO_LABELS[0], 0.05);
    scenarioLabel.position.set(
        view.camera.camera3D.position.x,
        view.camera.camera3D.position.y + 2,
        view.camera.camera3D.position.z - 2,
    );
    view.scene.add(scenarioLabel);

    function updateScenarioLabel(text) {
        // Re-create text mesh content (Text2D approach: replace child canvas)
        // Simple approach: hide/show one label per scenario
        scenarioLabel.visible = true;
        // Note: createText returns a Mesh with canvas texture.
        // We update by swapping the texture.
        const canvas  = document.createElement('canvas');
        const ctx     = canvas.getContext('2d');
        const size    = 80;
        ctx.font      = `bold ${size}px Arial`;
        const w       = ctx.measureText(text).width + 20;
        canvas.width  = w; canvas.height = size + 10;
        ctx.font      = `bold ${size}px Arial`;
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 10, (size + 10) / 2);
        const tex = new THREE.CanvasTexture(canvas);
        scenarioLabel.material = new THREE.MeshBasicMaterial({
            map: tex, transparent: true, side: THREE.DoubleSide,
        });
        scenarioLabel.geometry = new THREE.PlaneGeometry(0.05 * w / size, 0.05);
    }

    // Override right axis for pad cycling
    vrControls.onRightAxisChanged = function (ctrl) {
        if (padCooldown) return;
        const axisX = ctrl.gamepad.axes[2]; // horizontal axis
        if (Math.abs(axisX) > 0.7) {
            padCooldown   = true;
            currentIndex  = (currentIndex + (axisX > 0 ? 1 : 2)) % 3;
            showScenario(inSituModels, currentIndex, view);
            updateScenarioLabel(SCENARIO_LABELS[currentIndex]);
            setTimeout(() => { padCooldown = false; }, 650);
        }
    };

    vrControls.onLeftAxisChanged = function (ctrl) {};

    // Add instruction text to right controller on connect
    const instructionText = makeControllerLabel('<- -> Scénario suivant / précédent', new THREE.Vector3(0, 0.12, 0));

    xr.getController(0).addEventListener('connected', function () {
        if (this.userData.handedness === 'right' || !this.userData.handedness) {
            this.add(instructionText.clone());
        }
    });
    xr.getController(1).addEventListener('connected', function () {
        if (this.userData.handedness === 'right') {
            this.add(instructionText.clone());
        }
    });

    // After vrControls populates controllers, attach label to right controller
    // Use onRightButtonReleased as a hook to also update label
    vrControls.onRightButtonReleased = function (evt) {
        // A button (4) = GNSS recalibration (kept from original)
        if (evt.message.buttonIndex === 4) {
            rotateWithGNSS(view);
        }
    };
}

// ==================== MODE A — Virtual scale models + pointing ====================
// 3 small models placed on the ground, user points with right controller grip.
async function setupModeA(view, vrControls, inSituModels) {
    const groundGroup = new THREE.Group();
    const groundModels = [];

    // Load small-scale models for the ground display
    for (let i = 0; i < MODEL_NAMES.length; i++) {
        const name = MODEL_NAMES[i];
        const mat  = await new MTLLoader().setPath('obj/').loadAsync(`${name}.mtl`);
        mat.preload();
        const obj = await new OBJLoader().setPath('obj/').setMaterials(mat).loadAsync(`${name}.obj`);
        obj.name  = name;
        obj.scale.set(0.04, 0.04, 0.04);
        obj.position.set((i * 2) - 2, 0, 0);
        obj.rotateOnAxis(new THREE.Vector3(0, 0, 1), Math.PI / 2);
        obj.visible = true;

        // Scenario label above each ground model
        const label = createText(SCENARIO_LABELS[i], 0.025);
        label.position.set(0, 60, 0); // in model-local space (scale 0.04 ≈ 2.4 above)
        obj.add(label);

        groundGroup.add(obj);
        groundModels.push(obj);
    }

    // Place ground group relative to in-situ location, oriented to face the user
    groundGroup.position.set(
        4063985,
        198340,
        4895342.530291722
    );
    const coord = new itowns.Coordinates('EPSG:4978',
        groundGroup.position.x, groundGroup.position.y, groundGroup.position.z);
    coord.toVector3(groundGroup.position);
    groundGroup.lookAt(coord.geodesicNormal.clone().add(groundGroup.position));
    groundGroup.rotateOnAxis(new THREE.Vector3(0, 0, -1), THREE.MathUtils.degToRad(HEADING_DEG));
    itowns.DEMUtils.placeObjectOnGround(view.tileLayer, 'EPSG:4978', groundGroup);
    groundGroup.updateMatrixWorld();
    view.scene.add(groundGroup);

    // Instruction label on left controller
    const leftLabel = makeControllerLabel('Pointez un scénario + Gâchette grip', new THREE.Vector3(0, 0.12, 0));
    vrControls.controllers.filter(c => c.userData.handedness === 'left').forEach(c => c.add(leftLabel));

    // Selection ring overlays — one per ground model (avoid touching loaded materials)
    const selectionRings = groundModels.map(() => {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(20, 27.5, 32),
            new THREE.MeshBasicMaterial({ color: 0x44ff44, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
        );
        ring.position.y = -2; // just below model base in local space (×0.04 → ~8cm below)
        ring.name = 'selectionRing';
        return ring;
    });
    groundModels.forEach((m, i) => m.add(selectionRings[i]));

    //update ring matrices after adding to scene
    groundGroup.updateMatrixWorld();

    function highlightGroundModel(idx) {
        selectionRings.forEach((ring, i) => {
            ring.material.opacity = i === idx ? 0.85 : 0;
            ring.material.color.setHex(SCENARIO_COLORS[i]);
        });
    }


    // Right grip (buttonIndex 1) → raycast → show selected in-situ model
    vrControls.onRightButtonReleased = function (evt) {
        if (evt.message.buttonIndex !== 1) return; // grip only
        const controllerRight = this.controllers.find(c => c.userData.handedness === 'right');
        if (!controllerRight) return;

        const hits = raycastFromController(controllerRight, groundModels);
        if (!hits.length) return;

        for (const hit of hits) {
            let cur = hit.object;
            while (cur && !MODEL_NAMES.includes(cur.name)) cur = cur.parent;
            if (!cur) continue;

            const idx = MODEL_NAMES.indexOf(cur.name);
            if (idx !== -1) {
                showScenario(inSituModels, idx, view);
                highlightGroundModel(idx);
                break;
            }
        }
        view.notifyChange();
    };

    vrControls.onLeftAxisChanged = function (ctrl) {};
    vrControls.onRightAxisChanged = function (ctrl) {};
}

// ==================== MODE C — Physical markers + virtual highlight ====================
// Flat rings mark the positions of the 3 printed physical models on the table.
// Rings are always visible (idle opacity). Pointing + trigger selects a scenario:
// the pointed ring pulses white while aiming, then locks to the scenario color on release.
//
// CALIBRATION NOTE: Adjust PHYSICAL_MODEL_OFFSETS (meters, local XR space)
// to match where you place the physical printed models on-site.
function setupModeC(view, vrControls, inSituModels) {
    // Offsets relative to XR origin at session start
    const PHYSICAL_MODEL_OFFSETS = [
        new THREE.Vector3(-0.35 - 1, 1, -2.0),  // Scénario actuel  (left)
        new THREE.Vector3(  0.0 - 1, 1, -2.0),  // Scénario A       (centre)
        new THREE.Vector3( 0.35 - 1, 1, -2.0),  // Scénario B       (right)
    ];

    const xrOrigin = vrControls.groupXR;

    // Build flat ring highlights for each physical model position
    const highlights = PHYSICAL_MODEL_OFFSETS.map((offset, i) => {
        const mat  = new THREE.MeshBasicMaterial({
            color: SCENARIO_COLORS[i], transparent: true, opacity: 0.6,
            side: THREE.DoubleSide, depthWrite: false,
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.11, 48), mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(offset);
        ring.name = `highlight_${i}`;

        // Invisible hit-plane so raycasting works even when pointing straight down
        const hitMat  = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
        const hitDisc = new THREE.Mesh(new THREE.CircleGeometry(0.13, 32), hitMat);
        hitDisc.rotation.x = -Math.PI / 2;
        hitDisc.name = `hitdisc_${i}`;
        ring.add(hitDisc);

        // Scenario label above the ring
        const label = createText(SCENARIO_LABELS[i], 0.022);
        label.position.set(0, 0.07, 0);
        ring.add(label);

        xrOrigin.add(ring);
        return { ring, mat, index: i };
    });

    xrOrigin.updateMatrixWorld();

    let selectedIndex    = -1;
    let lastHoveredIndex = -1;
    let triggerCooldown  = false;

    function setRingState(i, state) {
        // states: 'idle' | 'hover' | 'selected'
        const h = highlights[i];
        if (state === 'hover') {
            h.mat.color.set(0xffffff);
            h.mat.opacity = 0.95;
        } else if (state === 'selected') {
            h.mat.color.setHex(SCENARIO_COLORS[i]);
            h.mat.opacity = 0.95;
        } else {
            // idle — dim if another scenario is selected, normal otherwise
            h.mat.color.setHex(SCENARIO_COLORS[i]);
            h.mat.opacity = selectedIndex !== -1 && selectedIndex !== i ? 0.2 : 0.55;
        }
    }

    function resetToIdle() {
        highlights.forEach((_, i) => setRingState(i, i === selectedIndex ? 'selected' : 'idle'));
    }

    // While trigger held: hover the pointed ring
    vrControls.onRightButtonPressed = function (evt) {
        if (evt.message.buttonIndex !== 1) return;
        const controllerRight = this.controllers.find(c => c.userData.handedness === 'right');
        if (!controllerRight) return;

        const meshes = highlights.map(h => h.ring);
        const hits   = raycastFromController(controllerRight, meshes);
        resetToIdle();
        lastHoveredIndex = -1;

        if (hits.length > 0) {
            let cur = hits[0].object;
            while (cur && !cur.name.startsWith('highlight_')) cur = cur.parent;
            if (cur) {
                const i = parseInt(cur.name.split('_')[1], 10);
                setRingState(i, 'hover');
                lastHoveredIndex = i;
            }
        }
        view.notifyChange();
    };

    // Trigger released → confirm selection
    vrControls.onRightButtonReleased = function (evt) {
        if (evt.message.buttonIndex === 1 && lastHoveredIndex !== -1) {
            if (triggerCooldown) return;
            triggerCooldown = true;
            selectedIndex = lastHoveredIndex;
            showScenario(inSituModels, selectedIndex, view);
            resetToIdle();
            setRingState(selectedIndex, 'selected');
            setTimeout(() => { triggerCooldown = false; }, 500);
        }
    };

    // Instruction on right controller
    const rightLabel = makeControllerLabel('Pointez + Gâchette -> sélectionner', new THREE.Vector3(0, 0.12, 0));
    vrControls.controllers.filter(c => c.userData.handedness === 'right').forEach(c => c.add(rightLabel));

    vrControls.onLeftAxisChanged = function (ctrl) {};
    vrControls.onRightAxisChanged = function (ctrl) {};
}

// ==================== GNSS ROTATION (shared utility) ====================
async function rotateWithGNSS(view) {
    let pos;
    try {
        const res = await fetch('https://10.73.118.16:8082/geopos');
        if (!res.ok) throw new Error('Network error');
        pos = await res.json();
        if (!pos || pos.worldPosition === undefined) throw new Error('Invalid GNSS response');
    } catch (e) {
        console.warn('GNSS fetch error:', e);
        return;
    }
    try {
        const headingRad = THREE.MathUtils.degToRad((pos.heading + 270) % 360);
        const pitchRad   = THREE.MathUtils.degToRad(pos.pitch);
        const groupXR    = view.webXR.vrControls.groupXR;
        const baseOrientation = groupXR.quaternion.clone().normalize();

        const Rz = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationZ(headingRad));
        const Rx = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationX(pitchRad));
        const worldPos = new THREE.Vector3(pos.worldPosition.x, pos.worldPosition.y, pos.worldPosition.z);
        const bNorm    = worldPos.clone().normalize();

        // Simplified Ry from baseline (mirrors xrCalibration logic)
        const v1 = new THREE.Vector3(1, 0, 0).applyMatrix3(Rx);
        const RzT = new THREE.Matrix3().copy(Rz).transpose();
        const v2 = bNorm.clone().applyMatrix3(RzT);
        const ryAngle = Math.atan2(v2.z, v2.x) - Math.atan2(v1.z, v1.x);

        const Ry   = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationY(ryAngle));
        const RzRyRx = new THREE.Matrix3().multiplyMatrices(Rz, new THREE.Matrix3().multiplyMatrices(Ry, Rx));
        const q    = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(RzRyRx));

        groupXR.quaternion.multiplyQuaternions(q, baseOrientation);
        groupXR.updateMatrixWorld();
        view.notifyChange();
    } catch (e) {
        console.warn('Error applying GNSS rotation:', e);
    }
}
