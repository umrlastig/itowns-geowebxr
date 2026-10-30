// WGS84 geodesy and small 3D math helpers, with no dependency on a 3D engine.
// Matrices are row-major arrays of 9 numbers, vectors arrays of 3 numbers,
// quaternions objects { x, y, z, w }.

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export const DEG = Math.PI / 180;

/**
 * @param {number} latDeg - latitude in degrees
 * @param {number} lonDeg - longitude in degrees
 * @param {number} h - ellipsoidal height in meters
 * @returns {number[]} ECEF (EPSG:4978) coordinates in meters
 */
export function geodeticToEcef(latDeg, lonDeg, h) {
    const lat = latDeg * DEG;
    const lon = lonDeg * DEG;
    const sinLat = Math.sin(lat);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    return [
        (n + h) * Math.cos(lat) * Math.cos(lon),
        (n + h) * Math.cos(lat) * Math.sin(lon),
        (n * (1 - WGS84_E2) + h) * sinLat,
    ];
}

/**
 * @param {number[]} ecef - ECEF coordinates in meters
 * @returns {{lat: number, lon: number, h: number}} geodetic coordinates (degrees, meters)
 */
export function ecefToGeodetic([x, y, z]) {
    const lon = Math.atan2(y, x);
    const p = Math.hypot(x, y);
    let lat = Math.atan2(z, p * (1 - WGS84_E2));
    let h = 0;
    for (let i = 0; i < 6; i++) {
        const sinLat = Math.sin(lat);
        const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
        h = p / Math.cos(lat) - n;
        lat = Math.atan2(z, p * (1 - WGS84_E2 * n / (n + h)));
    }
    return { lat: lat / DEG, lon: lon / DEG, h };
}

/**
 * Rotation from the East-North-Up frame at (lat, lon) to ECEF (columns are E, N, U).
 * @param {number} latDeg - latitude in degrees
 * @param {number} lonDeg - longitude in degrees
 * @returns {number[]} row-major 3x3 matrix
 */
export function enuToEcefMatrix(latDeg, lonDeg) {
    const sLat = Math.sin(latDeg * DEG);
    const cLat = Math.cos(latDeg * DEG);
    const sLon = Math.sin(lonDeg * DEG);
    const cLon = Math.cos(lonDeg * DEG);
    return [
        -sLon, -sLat * cLon, cLat * cLon,
        cLon, -sLat * sLon, cLat * sLon,
        0, cLat, sLat,
    ];
}

/**
 * WebXR reference space axes (x right, y up, z backwards) to ENU, before any
 * azimuth rotation: x → East, y → Up, -z → North.
 */
export const XR_TO_ENU = [
    1, 0, 0,
    0, 0, -1,
    0, 1, 0,
];

/**
 * @param {number} angle - counter-clockwise rotation around Up, in radians
 * @returns {number[]} row-major 3x3 matrix
 */
export function rotationAroundUp(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/**
 * @param {number[]} a - 3x3 matrix
 * @param {number[]} b - 3x3 matrix
 * @returns {number[]} a·b
 */
export function mat3Multiply(a, b) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
        }
    }
    return r;
}

/**
 * @param {number[]} m - 3x3 matrix
 * @param {number[]} v - vector
 * @returns {number[]} m·v
 */
export function mat3Apply(m, [x, y, z]) {
    return [
        m[0] * x + m[1] * y + m[2] * z,
        m[3] * x + m[4] * y + m[5] * z,
        m[6] * x + m[7] * y + m[8] * z,
    ];
}

/**
 * @param {{x: number, y: number, z: number, w: number}} q - unit quaternion
 * @param {number[]} v - vector
 * @returns {number[]} v rotated by q
 */
export function quatApply(q, [vx, vy, vz]) {
    // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
    const tx = 2 * (q.y * vz - q.z * vy);
    const ty = 2 * (q.z * vx - q.x * vz);
    const tz = 2 * (q.x * vy - q.y * vx);
    return [
        vx + q.w * tx + (q.y * tz - q.z * ty),
        vy + q.w * ty + (q.z * tx - q.x * tz),
        vz + q.w * tz + (q.x * ty - q.y * tx),
    ];
}

/**
 * @param {number[]} m - row-major 3x3 rotation matrix
 * @returns {{x: number, y: number, z: number, w: number}} unit quaternion
 */
export function quatFromMat3(m) {
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
    const trace = m00 + m11 + m22;
    let x;
    let y;
    let z;
    let w;
    if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1);
        w = 0.25 / s;
        x = (m21 - m12) * s;
        y = (m02 - m20) * s;
        z = (m10 - m01) * s;
    } else if (m00 > m11 && m00 > m22) {
        const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
        w = (m21 - m12) / s;
        x = 0.25 * s;
        y = (m01 + m10) / s;
        z = (m02 + m20) / s;
    } else if (m11 > m22) {
        const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
        w = (m02 - m20) / s;
        x = (m01 + m10) / s;
        y = 0.25 * s;
        z = (m12 + m21) / s;
    } else {
        const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
        w = (m10 - m01) / s;
        x = (m02 + m20) / s;
        y = (m12 + m21) / s;
        z = 0.25 * s;
    }
    return { x, y, z, w };
}

/**
 * @param {number} angle - radians
 * @returns {number} angle wrapped to (-π, π]
 */
export function wrapPi(angle) {
    let a = angle % (2 * Math.PI);
    if (a <= -Math.PI) { a += 2 * Math.PI; }
    if (a > Math.PI) { a -= 2 * Math.PI; }
    return a;
}
