# STAG GNSS bridge

A small localhost bridge that brings the RTK dual-antenna GNSS data from
**GNSS Master** into a WebXR page (iTowns) running in the Meta Quest browser.

```
UM982 (2 antennas) ──USB-C──> GNSS Master (Quest app, NTRIP client)
                                   │ NMEA over TCP (localhost)
                                   ▼
                        stag-gnss-bridge (Termux, Node.js)
                                   │ JSON over ws://127.0.0.1:5005
                                   ▼
                        Quest Browser ─ WebXR page (iTowns)
```

Why localhost: WebXR pages must be served over HTTPS. Browsers block `ws://`
connections from an HTTPS page to a LAN IP (mixed content), but treat
`127.0.0.1` as a secure origin. This means no certificate and no Wi-Fi
infrastructure are needed. Internet access is only needed for NTRIP corrections.

## Message format

One JSON message per GNSS epoch. GGA, GPHPD and HPR sentences that share the
same receiver time are fused into one message:

```json
{
  "type": "gnss", "version": 1,
  "tGnss": 1793354400900,      // receiver epoch, unix ms UTC (use it for time alignment)
  "tRecv": 1793360459959,      // bridge reception time, unix ms (headset clock)
  "valid": true,
  "lat": 50.457058, "lon": 2.794119,
  "alt": 97.9,                 // ellipsoidal height (altMsl + geoidSep)
  "altMsl": 52.0, "geoidSep": 45.9,
  "fixQuality": 4, "fixType": "rtk-fixed", "rtkFixed": true,
  "numSats": 28, "hdop": 0.6, "ageDiff": 1.0,
  "headingDeg": 46.3, "pitchDeg": 0.38, "rollDeg": null,
  "headingStatus": 4,          // raw receiver status, see the UM982 manual
  "baselineM": 0.3,
  "sentences": ["GGA", "HPD"]
}
```

The bridge also sends `{"type": "status", "upstream": "connected" | "disconnected"}`
to report the connection to GNSS Master. A new client immediately receives the
current status and the last message.

`http://127.0.0.1:5005/status` returns the bridge state as JSON: upstream status,
counters and last message. Open it in the Quest browser to check the bridge is running.

## Install on the Meta Quest

1. **Developer mode**: enable it for the headset in the Meta Horizon phone app.
2. **Install Termux**, plus optionally **Termux:Boot** for autostart. Use the F-Droid
   or GitHub builds, not the Play Store build:
   ```sh
   adb install termux-app_<version>_arm64-v8a.apk
   adb install termux-boot_<version>.apk   # optional
   ```
3. **Copy this folder** to the headset:
   ```sh
   adb push bridge /sdcard/Download/gnss-bridge
   ```
4. **In Termux** (open it from *Library → Unknown sources*):
   ```sh
   termux-setup-storage                 # allow access to /sdcard
   cp -r ~/storage/downloads/gnss-bridge ~/gnss-bridge
   sh ~/gnss-bridge/install-termux.sh tcp://127.0.0.1:<PORT>
   ~/.termux/boot/start-gnss-bridge.sh &
   ```
   `<PORT>` is the port of the GNSS Master NMEA TCP server (next section).
5. **Check** in the Quest browser: `http://127.0.0.1:5005/status`. `upstream`
   should say `connected` and `counts.messages` should increase.

### GNSS Master configuration
- Connect the UM982 over USB-C and configure the NTRIP client (Centipede mountpoint).
- Enable **NMEA output as a TCP server** and note the port.
- Make sure the receiver outputs **GGA** and **GPHPD** (or HPR), ideally at the
  same rate (e.g. 10 Hz), so that they fuse into one message per epoch. With
  Unicore commands this is typically `GPGGA 0.1`, `GPHPD 0.1`, then `SAVECONFIG`.
  Check the exact syntax in the UM982 manual.

### Points to verify on the headset
- The bridge must keep running while the browser is in immersive mode. The start
  script takes a Termux wake lock, which normally keeps it alive. If Horizon OS
  still pauses it, keep the Termux panel open in the background.
- Recent Chromium versions may show a one-time *local network access* prompt
  the first time the page connects to `127.0.0.1`. Accept it.

## Use from the WebXR page

```js
const ws = new WebSocket('ws://127.0.0.1:5005');
ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'gnss' && msg.valid && msg.rtkFixed) {
        // msg.lat, msg.lon, msg.alt (ellipsoidal), msg.headingDeg, msg.tGnss ...
    }
};
```

## Desktop testing without hardware

```sh
cd bridge
npm install
npm run replay                             # serves samples/synthetic-walk.nmea in a loop
node bridge.js --replay my-session.nmea --rate 2
```

`samples/synthetic-walk.nmea` is a **synthetic** 10 Hz log (10 s static, then a
walk towards the north-east near the Loos-en-Gohelle médiathèque), generated
by `npm run make-sample`. To record a real session for later replay, add
`--record session.nmea` to the start command.

## Command line

```
node bridge.js --source tcp://HOST:PORT [--listen HOST:PORT] [--record FILE]
node bridge.js --replay FILE [--rate N] [--loop] [--listen HOST:PORT]
```
