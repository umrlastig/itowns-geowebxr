// Generates a SYNTHETIC 10 Hz NMEA log (GGA + GPHPD) of a slow walk near the
// Loos-en-Gohelle médiathèque, for desktop testing of the bridge in replay mode.
// It is not a real receiver recording.

import { withChecksum } from '../nmea.js';

const START = Date.UTC(2026, 9, 30, 10, 0, 0);
const GPS_EPOCH_MS = Date.UTC(1980, 0, 6);
const LEAP_S = 18;
const LAT0 = 50.457058;
const LON0 = 2.794119;
const ALT_MSL = 52.0;
const GEOID_SEP = 45.9;
const M_PER_DEG_LAT = 111200;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(LAT0 * Math.PI / 180);

function ddmm(value, degDigits) {
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const min = (abs - deg) * 60;
    return `${String(deg).padStart(degDigits, '0')}${min.toFixed(7).padStart(10, '0')}`;
}

function hhmmss(ms) {
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.${String(Math.floor(d.getUTCMilliseconds() / 10)).padStart(2, '0')}`;
}

const lines = [];
for (let i = 0; i < 300; i++) {
    const t = START + i * 100;
    // 10 s standing still, then walk 0.5 m/s towards north-east
    const walk = Math.max(0, (i - 100) * 0.05);
    const east = walk * Math.SQRT1_2;
    const north = walk * Math.SQRT1_2;
    const lat = LAT0 + north / M_PER_DEG_LAT;
    const lon = LON0 + east / M_PER_DEG_LON;
    const heading = 45 + 3 * Math.sin(i / 20);
    const pitch = 1.5 * Math.sin(i / 35);
    const gpsMs = t - GPS_EPOCH_MS + LEAP_S * 1000;
    const week = Math.floor(gpsMs / (7 * 86400000));
    const sow = (gpsMs - week * 7 * 86400000) / 1000;

    lines.push(withChecksum(`GNGGA,${hhmmss(t)},${ddmm(lat, 2)},N,${ddmm(lon, 3)},E,4,28,0.6,${ALT_MSL.toFixed(3)},M,${GEOID_SEP.toFixed(3)},M,1.0,0001`));
    lines.push(withChecksum(`GPHPD,${week},${sow.toFixed(2)},${heading.toFixed(2)},${pitch.toFixed(2)},0.00,${lat.toFixed(8)},${lon.toFixed(8)},${(ALT_MSL + GEOID_SEP).toFixed(3)},0.000,0.000,0.000,0.300,28,26,4`));
}
console.log(lines.join('\n'));
