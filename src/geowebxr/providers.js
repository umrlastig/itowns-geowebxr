// GNSS providers for GeoWebXR. A provider is an EventTarget with start()/stop()
// that dispatches:
//   'gnss'   detail: bridge message (see bridge/README.md) + tReceived (unix ms, headset clock)
//   'status' detail: { connected: boolean, upstream: string|null }

/** Reads the local GNSS bridge (bridge/) over WebSocket, with reconnection. */
export class BridgeProvider extends EventTarget {
    /** @param {string} url - bridge WebSocket URL, e.g. ws://127.0.0.1:5005 */
    constructor(url) {
        super();
        this.url = url;
        this.ws = null;
        this.users = 0;
        this.retryTimer = null;
        this.status = { connected: false, upstream: null };
        this.last = null;
    }

    start() {
        if (this.users++ > 0) { return; }
        this.connect();
    }

    stop() {
        if (--this.users > 0) { return; }
        this.users = 0;
        clearTimeout(this.retryTimer);
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        this.setStatus({ connected: false });
    }

    connect() {
        const ws = new WebSocket(this.url);
        this.ws = ws;
        ws.onopen = () => this.setStatus({ connected: true });
        ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }
            if (msg.type === 'status') {
                this.setStatus({ upstream: msg.upstream });
            } else if (msg.type === 'gnss') {
                msg.tReceived = Date.now();
                this.last = msg;
                this.dispatchEvent(new CustomEvent('gnss', { detail: msg }));
            }
        };
        ws.onclose = () => {
            this.setStatus({ connected: false, upstream: null });
            this.retryTimer = setTimeout(() => this.connect(), 1000);
        };
    }

    setStatus(change) {
        this.status = { ...this.status, ...change };
        this.dispatchEvent(new CustomEvent('status', { detail: this.status }));
    }
}

/**
 * Emits a constant GNSS fix at a fixed rate. For desktop/emulator tests: with a
 * still headset, the XR origin gets this position and the headset faces
 * `headingDeg - 90` (default transverse baseline pointing right).
 */
export class FixedProvider extends EventTarget {
    /**
     * @param {object} fix - `{ lat, lon, alt, headingDeg, pitchDeg }`
     * @param {number} [rateHz] - emission rate
     */
    constructor(fix, rateHz = 10) {
        super();
        this.fix = fix;
        this.periodMs = 1000 / rateHz;
        this.timer = null;
        this.status = { connected: false, upstream: null };
    }

    start() {
        if (this.timer) { return; }
        this.status = { connected: true, upstream: 'connected' };
        this.dispatchEvent(new CustomEvent('status', { detail: this.status }));
        this.timer = setInterval(() => {
            const now = Date.now();
            this.dispatchEvent(new CustomEvent('gnss', {
                detail: {
                    type: 'gnss', valid: true, rtkFixed: true, fixType: 'rtk-fixed', pitchDeg: 0,
                    ...this.fix, tGnss: now, tReceived: now,
                },
            }));
        }, this.periodMs);
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
        this.status = { connected: false, upstream: null };
        this.dispatchEvent(new CustomEvent('status', { detail: this.status }));
    }
}
