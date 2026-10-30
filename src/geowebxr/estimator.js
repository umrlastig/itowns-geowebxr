// Geopose estimation of a WebXR reference space from dual-antenna GNSS
// (STAG paper, section 3.2.2), averaged over a short static window.
//
// Frames: XR = WebXR reference space (y up), viewer = headset, ENU = local
// tangent plane. The unknowns are the XR origin position and the azimuth ψ, a
// counter-clockwise rotation around Up such that
//   v_ENU = Rz(ψ) · XR_TO_ENU · v_XR

import {
    DEG,
    XR_TO_ENU,
    ecefToGeodetic,
    enuToEcefMatrix,
    geodeticToEcef,
    mat3Apply,
    mat3Multiply,
    quatApply,
    quatFromMat3,
    rotationAroundUp,
    wrapPi,
} from './geodesy.js';

export const DEFAULT_OPTIONS = {
    // Direction master → slave antenna in the headset frame (x right, y up, z back)
    baselineInViewer: [1, 0, 0],
    // Master antenna position in the headset frame, in meters (lever arm)
    leverArm: [0, 0, 0],
    // Sample gating
    requireRtkFixed: true,
    minHorizontalBaseline: 0.5, // horizontal part of the unit baseline, in the XR frame
    maxVerticalResidualDeg: 5,  // |GNSS pitch - XR baseline elevation|
    // Stillness: the headset must not move during `stillWindowMs` before the epoch
    stillWindowMs: 300,
    maxRotationDeg: 1,
    maxTranslationM: 0.03,
    maxPoseGapMs: 50,
    // Time alignment: GNSS epoch → headset clock (see GeoPoseEstimator#toHeadsetTime)
    transportLatencyMs: 0,
    poseBufferMs: 5000,
    // Calibration window
    durationMs: 3000,
    minSamples: 15,
    timeoutMs: 30000,
};

/**
 * @param {number} headingDeg - baseline azimuth, clockwise from North
 * @param {number} pitchDeg - baseline elevation
 * @returns {number[]} unit baseline vector in ENU
 */
export function baselineEnu(headingDeg, pitchDeg) {
    const h = headingDeg * DEG;
    const p = pitchDeg * DEG;
    return [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
}

function normalize(v) {
    const n = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * Estimate ψ from one GNSS epoch and the headset pose at that epoch
 * (equations 1-2 of the paper).
 * @param {object} viewer - headset pose in the XR space: `{ position: number[], quaternion: {x,y,z,w} }`
 * @param {object} gnss - `{ lat, lon, alt, headingDeg, pitchDeg }`
 * @param {object} options - see DEFAULT_OPTIONS
 * @returns {object} `{ psi, verticalResidualDeg, horizontalBaseline, antennaXr, antennaEcef, lat, lon }`
 */
export function estimateSample(viewer, gnss, options = DEFAULT_OPTIONS) {
    const bXr = quatApply(viewer.quaternion, normalize(options.baselineInViewer));
    const b0 = mat3Apply(XR_TO_ENU, bXr);
    const bGnss = baselineEnu(gnss.headingDeg, gnss.pitchDeg);
    const psi = wrapPi(Math.atan2(bGnss[1], bGnss[0]) - Math.atan2(b0[1], b0[0]));
    const elevXr = Math.asin(Math.max(-1, Math.min(1, b0[2])));
    const antennaXr = quatApply(viewer.quaternion, options.leverArm).map((v, i) => v + viewer.position[i]);
    return {
        psi,
        verticalResidualDeg: gnss.pitchDeg - elevXr / DEG,
        horizontalBaseline: Math.hypot(b0[0], b0[1]),
        antennaXr,
        antennaEcef: geodeticToEcef(gnss.lat, gnss.lon, gnss.alt),
        lat: gnss.lat,
        lon: gnss.lon,
    };
}

/**
 * @param {object} sample - result of estimateSample
 * @param {number} psi - azimuth to use (e.g. the averaged one)
 * @returns {number[]} ECEF position of the XR origin
 */
export function originFromSample(sample, psi) {
    const antennaEnu = mat3Apply(mat3Multiply(rotationAroundUp(psi), XR_TO_ENU), sample.antennaXr);
    const offset = mat3Apply(enuToEcefMatrix(sample.lat, sample.lon), antennaEnu);
    return sample.antennaEcef.map((v, i) => v - offset[i]);
}

/**
 * @param {number[]} angles - radians
 * @returns {number} circular mean in radians
 */
export function circularMean(angles) {
    let s = 0;
    let c = 0;
    for (const a of angles) { s += Math.sin(a); c += Math.cos(a); }
    return Math.atan2(s, c);
}

/**
 * Circular mean with outlier rejection (residuals beyond 3 robust sigmas).
 * @param {number[]} angles - radians
 * @returns {{mean: number, kept: number[], sampleStd: number}} mean and standard
 * deviation in radians, indices of the kept angles
 */
export function robustCircularMean(angles) {
    const mean0 = circularMean(angles);
    const res0 = angles.map(a => Math.abs(wrapPi(a - mean0)));
    const median = arr => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    const sigma = Math.max(1.4826 * median(res0), 0.05 * DEG);
    const kept = angles.map((_, i) => i).filter(i => res0[i] <= 3 * sigma);
    const mean = circularMean(kept.map(i => angles[i]));
    const res = kept.map(i => wrapPi(angles[i] - mean));
    const sampleStd = kept.length > 1
        ? Math.sqrt(res.reduce((acc, r) => acc + r * r, 0) / (kept.length - 1))
        : 0;
    return { mean, kept, sampleStd };
}

/**
 * Build the geopose of the XR reference space.
 * The quaternion maps XR reference space coordinates to ENU coordinates at the
 * origin (OGC GeoPose Basic-Quaternion, ENU tangent plane).
 * @param {number[]} originEcef - ECEF position of the XR origin
 * @param {number} psi - azimuth, radians
 * @returns {object} `{ position: {lat, lon, h}, quaternion, headingDeg }`
 */
export function buildGeoPose(originEcef, psi) {
    // XR forward (-z) is North for ψ = 0; ψ is counter-clockwise, headings are clockwise
    const headingDeg = ((-psi / DEG) % 360 + 360) % 360;
    return {
        position: ecefToGeodetic(originEcef),
        quaternion: quatFromMat3(mat3Multiply(rotationAroundUp(psi), XR_TO_ENU)),
        headingDeg,
    };
}

function quatAngle(a, b) {
    const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
    return 2 * Math.acos(Math.min(1, dot));
}

/**
 * Collects headset poses and GNSS epochs, and estimates the geopose of the
 * XR reference space on demand (static calibration).
 * Events: `progress` (detail: { accepted, rejected, reasons }) during a calibration.
 */
export class GeoPoseEstimator extends EventTarget {
    constructor(options = {}) {
        super();
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.poses = [];
        this.offsets = [];
        this.calibration = null;
    }

    /**
     * @param {number} t - unix ms (headset clock)
     * @param {number[]} position - headset position in the XR space
     * @param {{x: number, y: number, z: number, w: number}} quaternion - headset orientation in the XR space
     */
    addViewerPose(t, position, quaternion) {
        this.poses.push({ t, position, quaternion });
        const oldest = t - this.options.poseBufferMs;
        while (this.poses.length && this.poses[0].t < oldest) { this.poses.shift(); }
    }

    /** Drop the pose history, e.g. after a reference space reset. */
    clearPoses() {
        this.poses = [];
    }

    /**
     * Map a GNSS epoch to the headset clock. The offset between the two clocks
     * is the minimum of (reception time - epoch time) over recent epochs,
     * minus the known transport latency.
     * @param {object} gnss - message with `tGnss` and `tReceived` (headset clock)
     * @returns {number} unix ms in the headset clock
     */
    toHeadsetTime(gnss) {
        if (gnss.tGnss === null || gnss.tGnss === undefined) { return gnss.tReceived; }
        this.offsets.push(gnss.tReceived - gnss.tGnss);
        if (this.offsets.length > 100) { this.offsets.shift(); }
        return gnss.tGnss + Math.min(...this.offsets) - this.options.transportLatencyMs;
    }

    /**
     * @param {number} t - unix ms
     * @returns {{pose: object|null, reason: string|null}} pose at t, or why there is none
     */
    stillPoseAt(t) {
        const o = this.options;
        let nearest = null;
        for (const p of this.poses) {
            if (!nearest || Math.abs(p.t - t) < Math.abs(nearest.t - t)) { nearest = p; }
        }
        if (!nearest || Math.abs(nearest.t - t) > o.maxPoseGapMs) { return { pose: null, reason: 'no-pose' }; }
        for (const p of this.poses) {
            if (p.t < t - o.stillWindowMs || p.t > t) { continue; }
            const moved = Math.hypot(...p.position.map((v, i) => v - nearest.position[i]));
            if (moved > o.maxTranslationM || quatAngle(p.quaternion, nearest.quaternion) > o.maxRotationDeg * DEG) {
                return { pose: null, reason: 'moving' };
            }
        }
        return { pose: nearest, reason: null };
    }

    /**
     * @param {object} gnss - bridge message plus `tReceived` (headset clock, unix ms)
     * @returns {{sample: object|null, reason: string|null}} accepted sample, or why it was rejected
     */
    evaluate(gnss) {
        const o = this.options;
        const t = this.toHeadsetTime(gnss);
        if (!gnss.valid) { return { sample: null, reason: 'invalid' }; }
        if (o.requireRtkFixed && !gnss.rtkFixed) { return { sample: null, reason: 'not-rtk-fixed' }; }
        if (gnss.headingDeg === null || gnss.pitchDeg === null || gnss.alt === null) {
            return { sample: null, reason: 'no-heading' };
        }
        const { pose, reason } = this.stillPoseAt(t);
        if (!pose) { return { sample: null, reason }; }
        const sample = estimateSample(pose, gnss, o);
        if (sample.horizontalBaseline < o.minHorizontalBaseline) { return { sample: null, reason: 'baseline-vertical' }; }
        if (Math.abs(sample.verticalResidualDeg) > o.maxVerticalResidualDeg) {
            return { sample: null, reason: 'vertical-mismatch' };
        }
        return { sample, reason: null };
    }

    /** @param {object} gnss - bridge message plus `tReceived` (headset clock, unix ms) */
    addGnss(gnss) {
        const c = this.calibration;
        const { sample, reason } = this.evaluate(gnss);
        if (!c) { return; }
        if (sample) {
            c.samples.push(sample);
        } else {
            c.rejected++;
            c.reasons[reason] = (c.reasons[reason] || 0) + 1;
        }
        this.dispatchEvent(new CustomEvent('progress', {
            detail: { accepted: c.samples.length, rejected: c.rejected, reasons: { ...c.reasons } },
        }));
        const elapsed = gnss.tReceived - c.start;
        if (c.samples.length >= this.options.minSamples && elapsed >= this.options.durationMs) {
            this.finishCalibration();
        }
    }

    /**
     * Start a static calibration: the user should stand still for `durationMs`.
     * @param {object} [options] - overrides of DEFAULT_OPTIONS for this calibration
     * @returns {Promise<object>} geopose with `accuracy` and `stats`
     */
    calibrate(options = {}) {
        if (this.calibration) { return this.calibration.promise; }
        Object.assign(this.options, options);
        const c = { start: Date.now(), samples: [], rejected: 0, reasons: {} };
        c.promise = new Promise((resolve, reject) => { c.resolve = resolve; c.reject = reject; });
        c.timer = setTimeout(() => {
            this.calibration = null;
            c.reject(new Error(`GeoWebXR calibration timeout: ${c.samples.length} samples accepted, rejected: ${JSON.stringify(c.reasons)}`));
        }, this.options.timeoutMs);
        this.calibration = c;
        return c.promise;
    }

    /**
     * Abort the running calibration, if any; its promise is rejected.
     * @param {string} [reason] - error message
     */
    cancel(reason = 'GeoWebXR calibration cancelled') {
        const c = this.calibration;
        if (!c) { return; }
        this.calibration = null;
        clearTimeout(c.timer);
        c.reject(new Error(reason));
    }

    finishCalibration() {
        const c = this.calibration;
        this.calibration = null;
        clearTimeout(c.timer);
        const { mean: psi, kept, sampleStd } = robustCircularMean(c.samples.map(s => s.psi));
        const keptSamples = kept.map(i => c.samples[i]);
        const origins = keptSamples.map(s => originFromSample(s, psi));
        const origin = [0, 1, 2].map(i => origins.reduce((acc, o) => acc + o[i], 0) / origins.length);
        const positionStd = Math.sqrt(origins.reduce((acc, o) => {
            const d = o.map((v, i) => v - origin[i]);
            return acc + d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        }, 0) / Math.max(1, origins.length - 1));
        const geopose = buildGeoPose(origin, psi);
        geopose.timestamp = Date.now();
        // Standard deviation of the mean. This is a lower bound: GNSS noise is
        // correlated in time, and lever-arm/boresight errors are not included.
        geopose.accuracy = {
            headingDeg: sampleStd / Math.sqrt(keptSamples.length) / DEG,
            positionM: positionStd / Math.sqrt(keptSamples.length),
        };
        geopose.stats = {
            samples: c.samples.length,
            kept: keptSamples.length,
            rejected: c.rejected,
            reasons: c.reasons,
            headingSampleStdDeg: sampleStd / DEG,
            positionSampleStdM: positionStd,
            verticalResidualDeg: keptSamples.reduce((acc, s) => acc + s.verticalResidualDeg, 0) / keptSamples.length,
        };
        c.resolve(geopose);
    }
}
