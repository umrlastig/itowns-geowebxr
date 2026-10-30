#!/usr/bin/env node
// STAG GNSS bridge: reads NMEA from GNSS Master (TCP) or a recorded file and
// serves fused, timestamped JSON messages over WebSocket to the WebXR page.
//
// Usage:
//   node bridge.js --source tcp://127.0.0.1:<port> [--listen 127.0.0.1:5005] [--record out.nmea]
//   node bridge.js --replay samples/synthetic-walk.nmea [--rate 1] [--loop]

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import readline from 'node:readline';
import { WebSocketServer } from 'ws';
import { EpochAggregator, parseSentence } from './nmea.js';

const USAGE = `Usage:
  node bridge.js --source tcp://HOST:PORT [--listen HOST:PORT] [--record FILE]
  node bridge.js --replay FILE [--rate N] [--loop] [--listen HOST:PORT]

  --source   NMEA TCP server to read from (GNSS Master "NMEA output > TCP server")
  --replay   NMEA file to replay instead of a live source
  --rate     replay speed factor (default 1)
  --loop     restart the replay at end of file
  --listen   WebSocket/HTTP address to serve (default 127.0.0.1:5005)
  --record   append every raw NMEA line received to FILE (for later replay)`;

function parseArgs(argv) {
    const args = { listen: '127.0.0.1:5005', rate: 1, loop: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--loop') { args.loop = true; } else if (a === '--help' || a === '-h') { args.help = true; } else if (a.startsWith('--')) { args[a.slice(2)] = argv[++i]; }
    }
    args.rate = Number(args.rate) || 1;
    return args;
}

function splitHostPort(value, defaultHost) {
    const m = /^(?:tcp:\/\/)?(?:(.+):)?(\d+)$/.exec(value);
    if (!m) { throw new Error(`Invalid address: ${value}`); }
    return { host: m[1] || defaultHost, port: Number(m[2]) };
}

const args = parseArgs(process.argv.slice(2));
if (args.help || (!args.source && !args.replay)) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
}

// ---------- State ----------
const state = {
    upstream: 'disconnected',
    source: args.source || `replay:${args.replay}`,
    lastMessage: null,
    counts: { lines: 0, parsed: 0, ignored: 0, messages: 0 },
    startedAt: new Date().toISOString(),
};
const recorder = args.record ? fs.createWriteStream(args.record, { flags: 'a' }) : null;

// ---------- WebSocket / HTTP server ----------
const listen = splitHostPort(args.listen, '127.0.0.1');
const server = http.createServer();
const wss = new WebSocketServer({ server });
server.on('request', (req, res) => {
    // CORS + Private Network Access headers, so an https page may query localhost
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.url === '/status' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...state, clients: wss.clients.size }, null, 2));
        return;
    }
    res.writeHead(404); res.end();
});

function broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const client of wss.clients) {
        if (client.readyState === client.OPEN) { client.send(data); }
    }
}

function setUpstream(status) {
    if (state.upstream === status) { return; }
    state.upstream = status;
    console.log(`[bridge] upstream ${status} (${state.source})`);
    broadcast({ type: 'status', upstream: status, source: state.source });
}

wss.on('connection', (ws, req) => {
    console.log(`[bridge] client connected from ${req.socket.remoteAddress} (${wss.clients.size} total)`);
    ws.send(JSON.stringify({ type: 'status', upstream: state.upstream, source: state.source }));
    if (state.lastMessage) { ws.send(JSON.stringify(state.lastMessage)); }
});

server.listen(listen.port, listen.host, () => {
    console.log(`[bridge] serving ws://${listen.host}:${listen.port} (status: http://${listen.host}:${listen.port}/status)`);
});

// ---------- NMEA pipeline ----------
const aggregator = new EpochAggregator((msg) => {
    state.lastMessage = msg;
    state.counts.messages++;
    broadcast(msg);
});

function handleLine(line) {
    if (!line.trim()) { return; }
    state.counts.lines++;
    if (recorder) { recorder.write(`${line.trim()}\n`); }
    const parsed = parseSentence(line);
    if (parsed) {
        state.counts.parsed++;
        aggregator.push(parsed);
    } else {
        // Unsupported sentence type or bad checksum
        state.counts.ignored++;
    }
}

// Live source: GNSS Master NMEA TCP server, with reconnection
function connectTcp(address) {
    const { host, port } = splitHostPort(address, '127.0.0.1');
    let retryMs = 500;
    const connect = () => {
        const socket = net.createConnection({ host, port });
        socket.setEncoding('ascii');
        socket.setNoDelay(true);
        let buffer = '';
        socket.on('connect', () => { retryMs = 500; aggregator.reset(); setUpstream('connected'); });
        socket.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop(); // incomplete last line
            lines.forEach(handleLine);
            if (buffer.length > 4096) { buffer = ''; } // garbage without line breaks
        });
        socket.on('error', (e) => { console.warn(`[bridge] upstream error: ${e.message}`); });
        socket.on('close', () => {
            setUpstream('disconnected');
            setTimeout(connect, retryMs);
            retryMs = Math.min(retryMs * 2, 5000);
        });
    };
    connect();
}

// Recorded source: paced with the GNSS timestamps of the file
async function replay(file) {
    const sleep = ms => new Promise((r) => { setTimeout(r, ms); });
    do {
        setUpstream('connected');
        let prevT = null;
        const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
        // Sequential on purpose: the replay is paced line by line
        // eslint-disable-next-line no-await-in-loop
        for await (const line of rl) {
            const parsed = parseSentence(line);
            if (parsed && parsed.tGnss !== null) {
                if (prevT !== null && parsed.tGnss > prevT) {
                    // eslint-disable-next-line no-await-in-loop
                    await sleep(Math.min(parsed.tGnss - prevT, 5000) / args.rate);
                }
                prevT = parsed.tGnss;
            }
            handleLine(line);
        }
        aggregator.flush();
    } while (args.loop);
    setUpstream('disconnected');
}

if (args.replay) {
    replay(args.replay).catch((e) => { console.error(e); process.exit(1); });
} else {
    connectTcp(args.source);
}

process.on('SIGINT', () => {
    console.log('\n[bridge] stopping');
    recorder?.end();
    process.exit(0);
});
