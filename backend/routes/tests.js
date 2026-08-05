'use strict';

const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');

// Find artillery binary
function findArtilleryBin() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '.bin', 'artillery'),
    path.join(__dirname, '..', '..', 'node_modules', '.bin', 'artillery'),
    path.join('e:\\GradeMeAI\\grademeai-load-testing', 'node_modules', '.bin', 'artillery'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) || fs.existsSync(p + '.cmd')) return p;
  }
  return 'artillery';
}

const artilleryDir = path.join(__dirname, '..', 'artillery');
const uploadsDir  = path.join(__dirname, '..', 'uploads');

// ── Shared state ──────────────────────────────────────────
let currentProcess = null;
let testStatus  = { running: false, pid: null, startedAt: null, environment: null };
let sseClients  = [];
let metricsBuffer = [];

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients = sseClients.filter(client => {
    try { client.res.write(msg); return true; }
    catch { return false; }
  });
}

// ── Artillery stdout metrics parser ───────────────────────
// Artillery prints a human-readable "Metrics for period to: …" block every ~10s.
// This parser accumulates those blocks and emits a structured metrics object.
class MetricsParser {
  constructor() {
    this.buf          = '';
    this.pending      = null;   // metrics object being built
    this.currentHisto = null;   // current histogram key (e.g. 'http.response_time')
  }

  feed(chunk, onMetric) {
    this.buf += chunk;
    const lines = this.buf.split('\n');
    this.buf = lines.pop(); // keep incomplete last line
    for (const raw of lines) this._parseLine(raw, onMetric);
  }

  flush(onMetric) {
    // Emit anything still pending when the process closes
    this._emitPending(onMetric);
  }

  _emitPending(onMetric) {
    if (!this.pending) return;
    const m = this.pending;
    if (Object.keys(m.counters).length > 0 || Object.keys(m.summaries).length > 0) {
      onMetric(m);
    }
    this.pending = null;
  }

  _parseLine(raw, onMetric) {
    const line    = raw.replace(/\r/g, '');
    const trimmed = line.trim();

    // ── New period boundary ─────────────────────────────────
    if (trimmed.includes('Metrics for period to:')) {
      this._emitPending(onMetric);
      this.pending      = { counters: {}, summaries: {}, _ts: Date.now() };
      this.currentHisto = null;
      return;
    }

    if (!this.pending) return;

    // Skip separators and blank lines (but reset histogram context on blank)
    if (!trimmed || /^-{3,}/.test(trimmed)) {
      if (!trimmed) this.currentHisto = null;
      return;
    }

    // ── Indented histogram sub-value ────────────────────────
    // e.g. "  p95: ............. 1224.4"  or  "  p95:      1224.4"
    if (/^\s{2}/.test(line) && this.currentHisto) {
      const m = trimmed.match(/^([\w\d]+):\s*[. ]*\s*([\d.]+)\s*$/);
      if (m) {
        if (!this.pending.summaries[this.currentHisto]) {
          this.pending.summaries[this.currentHisto] = {};
        }
        this.pending.summaries[this.currentHisto][m[1]] = parseFloat(m[2]);
      }
      return;
    }

    // ── Top-level metric with inline value ──────────────────
    // e.g. "http.codes.200: ................ 25"
    const withVal = trimmed.match(/^([\w./\-:@]+):\s*[. ]+\s*([\d.]+)\s*$/);
    if (withVal) {
      this.pending.counters[withVal[1]] = parseFloat(withVal[2]);
      this.currentHisto = null;
      return;
    }

    // ── Histogram header (no inline value) ─────────────────
    // e.g. "http.response_time:"
    const histoHeader = trimmed.match(/^([\w./\-:@]+):\s*$/);
    if (histoHeader) {
      this.currentHisto = histoHeader[1];
      if (!this.pending.summaries[this.currentHisto]) {
        this.pending.summaries[this.currentHisto] = {};
      }
    }
  }
}

// ── Build dynamic YAML from config + phases ───────────────
function buildYaml(config, phases, environment) {
  let bodyFields = '';
  const bodyObj = config.body || {};
  Object.entries(bodyObj).forEach(([k, v]) => {
    bodyFields += `\n            ${k}: "${v}"`;
  });

  let phasesYaml = '';
  if (phases && phases.length > 0) {
    phases.forEach(p => {
      phasesYaml += `\n        - duration: ${p.duration}\n          arrivalRate: ${p.arrivalRate}`;
      if (p.rampTo) phasesYaml += `\n          rampTo: ${p.rampTo}`;
      if (p.name)   phasesYaml += `\n          name: "${p.name}"`;
    });
  } else {
    phasesYaml = `\n        - duration: 30\n          arrivalRate: 5\n          name: "Quick Test"`;
  }
  const headers = config.headers || {};
  let headersYaml = '';
  Object.entries(headers).forEach(([k, v]) => {
    headersYaml += `\n            ${k}: "${v}"`;
  });

  const randomIpHeader = config.randomIp === true ? `\n            X-Forwarded-For: "{{ randomIP }}"` : '';
  const method   = (config.method || 'POST').toLowerCase();
  const endpoint = config.targetEndpoint || '/api';

  return `config:
  target: "${config.serverUrl}"
  defaults:
    headers:
      Content-Type: "application/json"
      Origin: "${config.appUrl}"
  processor: "./processor.js"
  http:
    timeout: ${config.httpTimeout || 30}
    maxSockets: ${config.maxSockets || 5000}
  environments:
    custom:
      phases:${phasesYaml}

scenarios:
  - name: "Load Test"
    flow:
      - function: "assignUser"
      - ${method}:
          url: "${endpoint}"
          headers:${randomIpHeader}${headersYaml}
${method !== 'get' && bodyFields ? `          json:${bodyFields}\n` : ''}          afterResponse: "logResponse"
      - think: 1
`;
}

// ── POST /api/tests/start ─────────────────────────────────
router.post('/start', (req, res) => {
  if (testStatus.running) {
    return res.status(409).json({ success: false, error: 'A test is already running' });
  }

  const { environment = 'custom', phases } = req.body;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const userDataPath = path.join(uploadsDir, 'userData.json');
  if (!fs.existsSync(userDataPath)) {
    return res.status(400).json({ success: false, error: 'No userData.json found. Please upload data first.' });
  }

  // Write dynamic YAML
  const yamlContent = buildYaml(config, phases, environment);
  const yamlPath    = path.join(artilleryDir, 'runtime-test.yml');
  fs.writeFileSync(yamlPath, yamlContent);

  // Clear previous results
  const resultsPath  = path.join(artilleryDir, 'results.json');
  const errorLogPath = path.join(artilleryDir, 'error-logs.json');
  if (fs.existsSync(resultsPath)) fs.unlinkSync(resultsPath);
  fs.writeFileSync(errorLogPath, '');

  metricsBuffer = [];

  // Spawn artillery
  const artilleryBin = findArtilleryBin();
  const artilleryCmd = process.platform === 'win32' && fs.existsSync(artilleryBin + '.cmd')
    ? artilleryBin + '.cmd'
    : artilleryBin;
  const args = ['run', '--environment', 'custom', '-o', resultsPath, yamlPath];

  const env = {
    ...process.env,
    APP_URL:       config.appUrl,
    SERVER_URL:    config.serverUrl,
    HOSTNAME:      config.hostname,
    USERDATA_PATH: userDataPath,
  };

  currentProcess = spawn(artilleryCmd, args, {
    cwd:   artilleryDir,
    env,
    shell: process.platform === 'win32',
  });

  testStatus = {
    running:     true,
    pid:         currentProcess.pid,
    startedAt:   new Date().toISOString(),
    environment,
  };

  broadcast('status', { ...testStatus, type: 'started' });

  // ── Parse stdout for live metrics ──────────────────────────
  const parser = new MetricsParser();

  const onMetric = (metric) => {
    metricsBuffer.push(metric);
    broadcast('metrics', metric);
  };

  currentProcess.stdout.on('data', (data) => {
    const text = data.toString();
    broadcast('log', { text, time: new Date().toISOString() });
    parser.feed(text, onMetric);
  });

  currentProcess.stderr.on('data', (data) => {
    broadcast('log', { text: data.toString(), level: 'warn', time: new Date().toISOString() });
  });

  currentProcess.on('close', (code) => {
    // Flush any in-progress period block
    parser.flush(onMetric);

    testStatus = { running: false, pid: null, startedAt: null, environment: null };
    broadcast('status', { running: false, exitCode: code, type: 'finished', time: new Date().toISOString() });

    // Emit final aggregate summary from results file
    if (fs.existsSync(resultsPath)) {
      try {
        const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
        broadcast('summary', results.aggregate || {});
        // Also emit any intermediate periods we may have missed (belt & suspenders)
        const intermediates = results.intermediate || [];
        intermediates.forEach((m, i) => {
          if (i >= metricsBuffer.length) {
            metricsBuffer.push({ ...m, _ts: Date.now() });
            broadcast('metrics', m);
          }
        });
      } catch { /* ignore */ }
    }
    currentProcess = null;
  });

  res.json({ success: true, pid: currentProcess.pid, startedAt: testStatus.startedAt });
});

// ── POST /api/tests/stop ──────────────────────────────────
router.post('/stop', (req, res) => {
  if (!currentProcess || !testStatus.running) {
    return res.status(400).json({ success: false, error: 'No test is running' });
  }
  currentProcess.kill('SIGTERM');
  setTimeout(() => {
    if (currentProcess) currentProcess.kill('SIGKILL');
  }, 3000);
  res.json({ success: true, message: 'Stop signal sent' });
});

// ── GET /api/tests/status ─────────────────────────────────
router.get('/status', (req, res) => {
  res.json({ success: true, ...testStatus });
});

// ── GET /api/tests/stream (SSE) ───────────────────────────
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send current status immediately
  res.write(`event: status\ndata: ${JSON.stringify(testStatus)}\n\n`);

  // Replay buffered metrics to new clients (e.g. page refresh mid-test)
  metricsBuffer.forEach(m => {
    try { res.write(`event: metrics\ndata: ${JSON.stringify(m)}\n\n`); } catch {}
  });

  const client = { id: Date.now(), res };
  sseClients.push(client);

  // Heartbeat to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(`:heartbeat\n\n`); } catch { clearInterval(heartbeat); }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter(c => c.id !== client.id);
  });
});

module.exports = router;
