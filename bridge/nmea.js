// NMEA parsing and epoch fusion for the STAG GNSS bridge.
// Supported sentences (any talker ID): GGA (position, fix), GPHPD (Unicore
// dual-antenna heading/pitch/baseline) and HPR (Unicore heading/pitch/roll).

const GPS_EPOCH_MS = Date.UTC(1980, 0, 6);
const GPS_UTC_LEAP_S = 18; // GPS - UTC offset, valid since 2017-01-01
const DAY_MS = 86400000;

export const FIX_TYPES = {
    0: 'invalid',
    1: 'single',
    2: 'dgps',
    4: 'rtk-fixed',
    5: 'rtk-float',
    6: 'dead-reckoning',
};

function num(value) {
    if (value === undefined || value === '') { return null; }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function int(value) {
    const n = num(value);
    return n === null ? null : Math.trunc(n);
}

/**
 * @param {string} body - sentence content between `$` and `*`
 * @returns {string} two-digit uppercase hex XOR checksum
 */
export function computeChecksum(body) {
    let cs = 0;
    for (let i = 0; i < body.length; i++) { cs ^= body.charCodeAt(i); }
    return cs.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Append `*HH` to a sentence body. Used by tests and sample generation.
 * @param {string} body - sentence content without `$`
 * @returns {string} complete sentence
 */
export function withChecksum(body) {
    return `$${body}*${computeChecksum(body)}`;
}

/**
 * @param {string} line - raw sentence
 * @returns {string|null} sentence body (between `$` and `*`), or null if the checksum is wrong
 */
export function checkSentence(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('$')) { return null; }
    const star = trimmed.lastIndexOf('*');
    if (star === -1) { return trimmed.slice(1); }
    const body = trimmed.slice(1, star);
    return computeChecksum(body) === trimmed.slice(star + 1, star + 3).toUpperCase() ? body : null;
}

/**
 * @param {string} value - ddmm.mmmm (lat) or dddmm.mmmm (lon)
 * @param {string} hemisphere - N, S, E or W
 * @param {number} degDigits - 2 for latitude, 3 for longitude
 * @returns {number|null} signed decimal degrees
 */
export function parseLatLon(value, hemisphere, degDigits) {
    if (!value) { return null; }
    const deg = Number(value.slice(0, degDigits));
    const min = Number(value.slice(degDigits));
    if (!Number.isFinite(deg) || !Number.isFinite(min)) { return null; }
    const v = deg + min / 60;
    return hemisphere === 'S' || hemisphere === 'W' ? -v : v;
}

/**
 * @param {string} hhmmss - UTC time of day (hhmmss.ss)
 * @param {number} nowMs - reference time; the closest day to it is used
 * @returns {number|null} unix ms
 */
export function utcTimeOfDayToMs(hhmmss, nowMs) {
    if (!hhmmss || hhmmss.length < 6) { return null; }
    const tod = ((Number(hhmmss.slice(0, 2)) * 60 + Number(hhmmss.slice(2, 4))) * 60
        + Number(hhmmss.slice(4))) * 1000;
    if (!Number.isFinite(tod)) { return null; }
    let t = Math.floor(nowMs / DAY_MS) * DAY_MS + tod;
    if (t - nowMs > DAY_MS / 2) { t -= DAY_MS; }
    if (nowMs - t > DAY_MS / 2) { t += DAY_MS; }
    return t;
}

/**
 * @param {number} week - GPS week number
 * @param {number} seconds - GPS seconds of week
 * @returns {number} unix ms (UTC)
 */
export function gpsWeekSecondsToMs(week, seconds) {
    return GPS_EPOCH_MS + week * 7 * DAY_MS + (seconds - GPS_UTC_LEAP_S) * 1000;
}

/**
 * Parse one NMEA line.
 * @param {string} line - raw sentence
 * @param {number} nowMs - receive time, used to date the UTC time of day
 * @returns {object|null} parsed sentence with a `kind` and a `tGnss` (unix ms), or null
 */
export function parseSentence(line, nowMs = Date.now()) {
    const body = checkSentence(line);
    if (!body) { return null; }
    const f = body.split(',');
    const tag = f[0];

    if (tag.endsWith('GGA')) {
        const altMsl = num(f[9]);
        const geoidSep = num(f[11]);
        return {
            kind: 'GGA',
            tGnss: utcTimeOfDayToMs(f[1], nowMs),
            lat: parseLatLon(f[2], f[3], 2),
            lon: parseLatLon(f[4], f[5], 3),
            fixQuality: int(f[6]),
            numSats: int(f[7]),
            hdop: num(f[8]),
            altMsl,
            geoidSep,
            // Ellipsoidal height, as expected by EPSG:4326/4979 in iTowns
            alt: altMsl !== null && geoidSep !== null ? altMsl + geoidSep : altMsl,
            ageDiff: num(f[13]),
        };
    }

    if (tag.endsWith('HPD')) {
        const week = int(f[1]);
        const seconds = num(f[2]);
        return {
            kind: 'HPD',
            tGnss: week !== null && seconds !== null ? gpsWeekSecondsToMs(week, seconds) : null,
            headingDeg: num(f[3]),
            pitchDeg: num(f[4]),
            trackDeg: num(f[5]),
            lat: num(f[6]),
            lon: num(f[7]),
            alt: num(f[8]),
            velENU: [num(f[9]), num(f[10]), num(f[11])],
            baselineM: num(f[12]),
            numSatsMaster: int(f[13]),
            numSatsSlave: int(f[14]),
            // Raw receiver status, see the UM982 manual for its meaning
            headingStatus: int(f[15]),
        };
    }

    if (tag.endsWith('HPR')) {
        return {
            kind: 'HPR',
            tGnss: utcTimeOfDayToMs(f[1], nowMs),
            headingDeg: num(f[2]),
            pitchDeg: num(f[3]),
            rollDeg: num(f[4]),
            headingStatus: int(f[5]),
            numSats: int(f[6]),
        };
    }

    return null;
}

/**
 * @param {object} record - fused epoch: `{ tGnss, tRecv, GGA?, HPD?, HPR? }`
 * @returns {object} JSON message sent to the browser
 */
export function toMessage(record) {
    const gga = record.GGA || {};
    const hd = record.HPD || record.HPR || {};
    const lat = gga.lat ?? record.HPD?.lat ?? null;
    const lon = gga.lon ?? record.HPD?.lon ?? null;
    const fixQuality = gga.fixQuality ?? null;
    return {
        type: 'gnss',
        version: 1,
        tGnss: record.tGnss,
        tRecv: record.tRecv,
        valid: lat !== null && lon !== null && (fixQuality === null || fixQuality > 0),
        lat,
        lon,
        alt: gga.alt ?? record.HPD?.alt ?? null,
        altMsl: gga.altMsl ?? null,
        geoidSep: gga.geoidSep ?? null,
        fixQuality,
        fixType: fixQuality === null ? null : (FIX_TYPES[fixQuality] || `unknown-${fixQuality}`),
        rtkFixed: fixQuality === 4,
        numSats: gga.numSats ?? record.HPR?.numSats ?? null,
        hdop: gga.hdop ?? null,
        ageDiff: gga.ageDiff ?? null,
        headingDeg: hd.headingDeg ?? null,
        pitchDeg: hd.pitchDeg ?? null,
        rollDeg: record.HPR?.rollDeg ?? null,
        headingStatus: hd.headingStatus ?? null,
        baselineM: record.HPD?.baselineM ?? null,
        sentences: Object.keys(record).filter(k => k === 'GGA' || k === 'HPD' || k === 'HPR'),
    };
}

/**
 * Groups parsed sentences sharing the same GNSS epoch into one message.
 * An epoch is emitted when a sentence of a newer epoch arrives, or `flushMs`
 * after its last sentence, whichever comes first.
 */
export class EpochAggregator {
    constructor(onMessage, { flushMs = 30, epochResolutionMs = 10, timeJumpMs = 5000 } = {}) {
        this.onMessage = onMessage;
        this.flushMs = flushMs;
        this.epochResolutionMs = epochResolutionMs;
        this.timeJumpMs = timeJumpMs;
        this.current = null;
        this.lastEmitted = null;
        this.timer = null;
    }

    push(parsed, tRecv = Date.now()) {
        if (!parsed || parsed.tGnss === null) { return; }
        const key = Math.round(parsed.tGnss / this.epochResolutionMs) * this.epochResolutionMs;
        // Receiver restart or looped replay: time went far backwards
        if (this.lastEmitted !== null && key < this.lastEmitted - this.timeJumpMs) { this.reset(); }
        // Late sentence of an epoch that was already emitted
        if (this.lastEmitted !== null && key <= this.lastEmitted) { return; }
        if (this.current && this.current.tGnss !== key) {
            if (key < this.current.tGnss) { return; }
            this.flush();
        }
        if (!this.current) {
            this.current = { tGnss: key, tRecv };
        }
        this.current[parsed.kind] = parsed;
        if (this.flushMs > 0) {
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.flush(), this.flushMs);
        }
    }

    /** Drop the pending epoch and forget the last emitted one. */
    reset() {
        clearTimeout(this.timer);
        this.timer = null;
        this.current = null;
        this.lastEmitted = null;
    }

    flush() {
        clearTimeout(this.timer);
        this.timer = null;
        if (!this.current) { return; }
        const record = this.current;
        this.current = null;
        this.lastEmitted = record.tGnss;
        this.onMessage(toMessage(record));
    }
}
