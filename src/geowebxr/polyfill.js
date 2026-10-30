// GeoWebXR polyfill: adds a 'geo' reference space to WebXR.
//
//   installGeoWebXR({ provider: new BridgeProvider('ws://127.0.0.1:5005') });
//   const space = await session.requestReferenceSpace('geo');
//   space.addEventListener('geoposechange', () => console.log(space.geopose));
//
// The 'geo' space is the base space (`baseType`, default 'local-floor')
// extended with:
//   space.geopose  - null until estimated, then { position: {lat, lon, h},
//                    quaternion (XR → ENU), headingDeg, accuracy, stats, timestamp }
//   space.geoXR    - { status, provider, estimator, calibrate(options) }
// and dispatches 'geoposechange' and 'geostatus' (detail: { status, progress, error }).
// 'geo' in requiredFeatures/optionalFeatures is replaced by `baseType`.

import { GeoPoseEstimator } from './estimator.js';

const GEO = 'geo';

function translateFeatures(features, baseType) {
    if (!features || !features.includes(GEO)) { return features; }
    return [...new Set(features.filter(f => f !== GEO).concat(baseType))];
}

// XRSpace is an EventTarget in the WebXR spec, but some emulators (e.g. the
// Immersive Web Emulator) return reference spaces without event methods.
function ensureEventTarget(space) {
    if (typeof space.addEventListener === 'function') { return; }
    const target = new EventTarget();
    space.addEventListener = target.addEventListener.bind(target);
    space.removeEventListener = target.removeEventListener.bind(target);
    space.dispatchEvent = target.dispatchEvent.bind(target);
}

function attachGeoSpace(session, space, config) {
    ensureEventTarget(space);
    const { provider } = config;
    const estimator = new GeoPoseEstimator(config.estimator);
    let running = true;

    const geo = {
        status: 'idle',
        geopose: null,
        provider,
        estimator,
        calibrate(options) {
            setStatus('calibrating');
            return estimator.calibrate(options).then((geopose) => {
                geo.geopose = geopose;
                setStatus('ready');
                space.dispatchEvent(new CustomEvent('geoposechange', { detail: geopose }));
                return geopose;
            }, (error) => {
                setStatus('error', { error });
                throw error;
            });
        },
    };

    function setStatus(status, extra = {}) {
        geo.status = status;
        space.dispatchEvent(new CustomEvent('geostatus', { detail: { status, ...extra } }));
    }

    function autoCalibrate() {
        if (!running || !config.autoCalibrate) { return; }
        geo.calibrate().catch((error) => {
            console.warn(error.message);
            autoCalibrate(); // keep trying while the session runs
        });
    }

    Object.defineProperty(space, 'geopose', { get: () => geo.geopose, configurable: true });
    space.geoXR = geo;

    const onGnss = event => estimator.addGnss(event.detail);
    const onProgress = event => setStatus(geo.status, { progress: event.detail });
    provider.addEventListener('gnss', onGnss);
    estimator.addEventListener('progress', onProgress);
    provider.start();

    // Headset pose history, used to pair each GNSS epoch with the pose at that time
    const onFrame = (time, frame) => {
        if (!running) { return; }
        const pose = frame.getViewerPose(space);
        if (pose && !pose.emulatedPosition) {
            const { position: p, orientation: o } = pose.transform;
            const t = performance.timeOrigin + (frame.predictedDisplayTime ?? time);
            estimator.addViewerPose(t, [p.x, p.y, p.z], { x: o.x, y: o.y, z: o.z, w: o.w });
        }
        session.requestAnimationFrame(onFrame);
    };
    session.requestAnimationFrame(onFrame);

    // Tracking was lost/relocalized: the previous geopose no longer holds
    space.addEventListener('reset', () => {
        estimator.clearPoses();
        geo.geopose = null;
        space.dispatchEvent(new CustomEvent('geoposechange', { detail: null }));
        if (geo.status !== 'calibrating') { autoCalibrate(); }
    });

    session.addEventListener('end', () => {
        running = false;
        estimator.cancel('GeoWebXR calibration cancelled: session ended');
        provider.removeEventListener('gnss', onGnss);
        estimator.removeEventListener('progress', onProgress);
        provider.stop();
    });

    autoCalibrate();
    return space;
}

/**
 * Install the 'geo' reference space.
 * @param {object} config - configuration
 * @param {EventTarget} config.provider - GNSS provider (see providers.js)
 * @param {string} [config.baseType] - WebXR reference space the 'geo' space is built on
 * @param {boolean} [config.autoCalibrate] - estimate the geopose at session start and after resets
 * @param {object} [config.estimator] - GeoPoseEstimator options (lever arm, baseline, gating...)
 * @returns {boolean} false if WebXR is not available
 */
export function installGeoWebXR(config) {
    if (typeof navigator === 'undefined' || !navigator.xr || typeof XRSession === 'undefined') { return false; }
    if (!config || !config.provider) { throw new Error('installGeoWebXR: a provider is required'); }
    const cfg = { baseType: 'local-floor', autoCalibrate: true, estimator: {}, ...config };
    if (XRSession.prototype.requestReferenceSpace.geoWebXR) { return true; }

    const xrSystem = navigator.xr;
    const requestSession = xrSystem.requestSession.bind(xrSystem);
    xrSystem.requestSession = (mode, init = {}) => requestSession(mode, {
        ...init,
        requiredFeatures: translateFeatures(init.requiredFeatures, cfg.baseType),
        optionalFeatures: translateFeatures(init.optionalFeatures, cfg.baseType),
    });

    const requestReferenceSpace = XRSession.prototype.requestReferenceSpace;
    function patched(type) {
        if (type !== GEO) { return requestReferenceSpace.call(this, type); }
        if (!this.geoSpacePromise) {
            this.geoSpacePromise = requestReferenceSpace.call(this, cfg.baseType)
                .then(space => attachGeoSpace(this, space, cfg));
        }
        return this.geoSpacePromise;
    }
    patched.geoWebXR = true;
    XRSession.prototype.requestReferenceSpace = patched;
    return true;
}
