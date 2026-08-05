'use strict';

const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const configPath = path.join(__dirname, '..', 'config.json');

// Find artillery binary — try local backend, then the shared GradeMeAI node_modules
function findArtilleryBin() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '.bin', 'artillery'),
    path.join(__dirname, '..', '..', 'node_modules', '.bin', 'artillery'),
    path.join('e:\\GradeMeAI\\grademeai-load-testing', 'node_modules', '.bin', 'artillery'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) || fs.existsSync(p + '.cmd')) return p;
  }
  return 'artillery'; // fallback to PATH
}
const artilleryDir = path.join(__dirname, '..', 'artillery');
const uploadsDir = path.join(__dirname, '..', 'uploads');

// ── Shared state ──────────────────────────────────────────
let currentProcess = null;
let testStatus = { running: false, pid: null, startedAt: null, environment: null };
let sseClients = [];
let metricsBuffer = [];

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients = sseClients.filter(client => {
    try { client.res.write(msg); return true; }
    catch { return false; }
  });
}

// ── Build dynamic YAML from config + phases ───────────────
function buildYaml(config, phases, environment) {
  const fieldMapping = config.fieldMapping || { email: 'email', password: 'password' };

  // Build JSON body with template vars
  let bodyFields = '';
  const bodyObj = config.body || {};
  Object.entries(bodyObj).forEach(([k, v]) => {
    bodyFields += `\n            ${k}: "${v}"`;
  });

  // Build phases YAML
  let phasesYaml = '';
  if (phases && phases.length > 0) {
    phases.forEach(p => {
      phasesYaml += `\n        - duration: ${p.duration}\n          arrivalRate: ${p.arrivalRate}`;
      if (p.rampTo) phasesYaml += `\n          rampTo: ${p.rampTo}`;
      if (p.name)   phasesYaml += `\n          name: "${p.name}"`;
    });
  } else {
    // Default quick phase
    phasesYaml = `\n        - duration: 30\n          arrivalRate: 5\n          name: "Quick Test"`;
  }

  const headers = config.headers || {};
  let headersYaml = '';
  Object.entries(headers).forEach(([k, v]) => {
    // 12 spaces — same indent level as X-Forwarded-For inside headers:
    headersYaml += `\n            ${k}: "${v}"`;
  });

  const method = (config.method || 'POST').toLowerCase();
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
          headers:
            X-Forwarded-For: "{{ randomIP }}"${headersYaml}
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

  // Check userData exists
  const userDataPath = path.join(uploadsDir, 'userData.json');
  if (!fs.existsSync(userDataPath)) {
    return res.status(400).json({ success: false, error: 'No userData.json found. Please upload data first.' });
  }

  // Write dynamic YAML
  const yamlContent = buildYaml(config, phases, environment);
  const yamlPath = path.join(artilleryDir, 'runtime-test.yml');
  fs.writeFileSync(yamlPath, yamlContent);

  // Clear previous results & logs
  const resultsPath = path.join(artilleryDir, 'results.json');
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
    APP_URL: config.appUrl,
    SERVER_URL: config.serverUrl,
    HOSTNAME: config.hostname,
    USERDATA_PATH: userDataPath,
  };

  currentProcess = spawn(artilleryCmd, args, { cwd: artilleryDir, env, shell: process.platform === 'win32' });

  testStatus = {
    running: true,
    pid: currentProcess.pid,
    startedAt: new Date().toISOString(),
    environment
  };

  broadcast('status', { ...testStatus, type: 'started' });

  // Stream stdout
  currentProcess.stdout.on('data', (data) => {
    const text = data.toString();
    broadcast('log', { text, time: new Date().toISOString() });

    // Parse intermediate JSON metrics from Artillery's stdout
    text.split('\n').forEach(line => {
      if (line.startsWith('{')) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.counters || parsed.summaries) {
            metricsBuffer.push({ ...parsed, _ts: Date.now() });
            broadcast('metrics', parsed);
          }
        } catch { /* not JSON */ }
      }
    });
  });

  currentProcess.stderr.on('data', (data) => {
    broadcast('log', { text: data.toString(), level: 'warn', time: new Date().toISOString() });
  });

  currentProcess.on('close', (code) => {
    testStatus = { running: false, pid: null, startedAt: null, environment: null };
    broadcast('status', { running: false, exitCode: code, type: 'finished', time: new Date().toISOString() });
    
    // Parse results and broadcast summary
    if (fs.existsSync(resultsPath)) {
      try {
        const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
        broadcast('summary', results.aggregate || {});
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

  // Send current status immediately on connect
  res.write(`event: status\ndata: ${JSON.stringify(testStatus)}\n\n`);

  const client = { id: Date.now(), res };
  sseClients.push(client);

  // Heartbeat
  const heartbeat = setInterval(() => {
    try { res.write(`:heartbeat\n\n`); } catch { clearInterval(heartbeat); }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter(c => c.id !== client.id);
  });
});

module.exports = router;
