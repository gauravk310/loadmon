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

// ── Artillery stdout metrics parser ───────────────────────
// Artillery prints a human-readable "Metrics for period to: …" block every ~10s.
// This parser accumulates those blocks and emits a structured metrics object.
class MetricsParser {
  constructor() {
    this.buf = '';
    this.pending = null;   // metrics object being built
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
    const line = raw.replace(/\r/g, '');
    const trimmed = line.trim();

    // ── New period boundary ─────────────────────────────────
    if (trimmed.includes('Metrics for period to:')) {
      this._emitPending(onMetric);
      this.pending = { counters: {}, summaries: {}, _ts: Date.now() };
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
  const mode = config?.arrivalMode || 'arrivalRate';
  let phasesYaml = '';
  if (phases && phases.length > 0) {
    phases.forEach(p => {
      if (p.pause) {
        phasesYaml += `\n        - pause: ${p.pause}`;
        return;
      }
      phasesYaml += `\n        - duration: ${p.duration !== undefined ? p.duration : 1}`;
      if (mode === 'arrivalCount') {
        if (p.arrivalCount !== undefined && p.arrivalCount !== null && p.arrivalCount !== '') {
          phasesYaml += `\n          arrivalCount: ${p.arrivalCount}`;
        } else if (p.arrivalRate !== undefined && p.arrivalRate !== null && p.arrivalRate !== '') {
          phasesYaml += `\n          arrivalRate: ${p.arrivalRate}`;
        }
      } else {
        if (p.arrivalRate !== undefined && p.arrivalRate !== null && p.arrivalRate !== '') {
          phasesYaml += `\n          arrivalRate: ${p.arrivalRate}`;
        } else if (p.arrivalCount !== undefined && p.arrivalCount !== null && p.arrivalCount !== '') {
          phasesYaml += `\n          arrivalCount: ${p.arrivalCount}`;
        }
      }
      if (p.rampTo && mode !== 'arrivalCount') phasesYaml += `\n          rampTo: ${p.rampTo}`;
      if (p.maxVusers) phasesYaml += `\n          maxVusers: ${p.maxVusers}`;
      if (p.name) phasesYaml += `\n          name: "${p.name}"`;
    });
  } else {
    phasesYaml = mode === 'arrivalCount'
      ? `\n        - duration: 30\n          arrivalCount: 50\n          name: "Quick Test"`
      : `\n        - duration: 30\n          arrivalRate: 5\n          name: "Quick Test"`;
  }

  let flowYaml = '      - function: "assignUser"\n';
  const steps = config.steps || [];

  if (steps.length > 0) {
    steps.forEach((step, idx) => {
      const method = (step.method || 'GET').toLowerCase();
      const name = step.name || `Step ${idx + 1}: ${method.toUpperCase()} ${step.endpoint}`;
      flowYaml += `      - ${method}:\n`;
      flowYaml += `          name: "${name}"\n`;
      flowYaml += `          url: "${step.endpoint}"\n`;

      const headers = step.headers || {};
      let headersYaml = '';
      if (config.randomIp) {
        headersYaml += `\n            X-Forwarded-For: "{{ randomIP }}"`;
      }
      Object.entries(headers).forEach(([k, v]) => {
        if (k && v !== undefined) {
          headersYaml += `\n            ${k}: "${v}"`;
        }
      });
      if (headersYaml) {
        flowYaml += `          headers:${headersYaml}\n`;
      }

      if (['post', 'put', 'patch'].includes(method) && step.body) {
        let bodyString = typeof step.body === 'string' ? step.body : JSON.stringify(step.body, null, 2);
        const indentedBody = bodyString.split('\n').map(line => `            ${line}`).join('\n');
        flowYaml += `          json:\n${indentedBody}\n`;
      }

      if (step.capture && Array.isArray(step.capture) && step.capture.length > 0) {
        flowYaml += `          capture:\n`;
        step.capture.forEach(c => {
          if (c.json) {
            flowYaml += `            - json: "${c.json}"\n              as: "${c.as}"\n`;
          } else if (c.header) {
            flowYaml += `            - header: "${c.header}"\n              as: "${c.as}"\n`;
          }
        });
      }

      flowYaml += `          beforeRequest: "beforeStep"\n`;
      flowYaml += `          afterResponse: "logResponse"\n`;

      if (step.think && Number(step.think) > 0) {
        flowYaml += `      - think: ${Number(step.think)}\n`;
      }
    });
  } else {
    // Single step fallback
    const method = (config.method || 'POST').toLowerCase();
    const endpoint = config.targetEndpoint || '/api';
    const name = config.scenarioName || `Single Step: ${method.toUpperCase()} ${endpoint}`;
    flowYaml += `      - ${method}:\n`;
    flowYaml += `          name: "${name}"\n`;
    flowYaml += `          url: "${endpoint}"\n`;

    const headers = config.headers || {};
    let headersYaml = '';
    if (config.randomIp) {
      headersYaml += `\n            X-Forwarded-For: "{{ randomIP }}"`;
    }
    Object.entries(headers).forEach(([k, v]) => {
      headersYaml += `\n            ${k}: "${v}"`;
    });
    if (headersYaml) {
      flowYaml += `          headers:${headersYaml}\n`;
    }

    if (['post', 'put', 'patch'].includes(method) && config.body) {
      let bodyString = typeof config.body === 'string' ? config.body : JSON.stringify(config.body, null, 2);
      if (bodyString && bodyString !== '{}') {
        const indentedBody = bodyString.split('\n').map(line => `            ${line}`).join('\n');
        flowYaml += `          json:\n${indentedBody}\n`;
      }
    }
    flowYaml += `          beforeRequest: "beforeStep"\n`;
    flowYaml += `          afterResponse: "logResponse"\n`;
    flowYaml += `      - think: 1\n`;
  }

  const scenarioName = config.scenarioName || 'Load Test';

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
  - name: "${scenarioName}"
    flow:
${flowYaml}`;
}

// ── POST /api/tests/start ─────────────────────────────────
router.post('/start', (req, res) => {
  if (testStatus.running) {
    return res.status(409).json({ success: false, error: 'A test is already running' });
  }

  const { environment = 'custom', phases, config: clientConfig, chain } = req.body;

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    config = clientConfig;
  }

  // Merge clientConfig if provided and valid (except steps, which are managed via chain or single request mode)
  if (clientConfig && typeof clientConfig === 'object') {
    const { steps: _ignoreSteps, ...restClientConfig } = clientConfig;
    config = { ...config, ...restClientConfig };
  }

  // Chain override: if a chain is provided, use its steps and environment URLs
  if (chain && typeof chain === 'object' && Array.isArray(chain.steps) && chain.steps.length > 0) {
    // Auto-generate capture rules from responseKeys stored during chain building
    const chainSteps = chain.steps.map((step, idx) => {
      const capture = [];
      // Auto-capture cookie
      capture.push({ header: 'set-cookie', as: 'authCookie' });
      // Auto-capture common token fields if present
      capture.push({ json: '$.access_token', as: 'access_token' });
      capture.push({ json: '$.token', as: 'token' });
      capture.push({ json: '$.jwt', as: 'jwt' });
      capture.push({ json: '$.authorization', as: 'authorization' });
      capture.push({ json: '$.user.token', as: 'user_token' });
      capture.push({ json: '$.user.access_token', as: 'user_access_token' });

      // Auto-capture common user/student ID fields with aliases
      capture.push({ json: '$.user.id', as: 'user.id' });
      capture.push({ json: '$.user.id', as: 'user_id' });
      capture.push({ json: '$.user.id', as: 'id' });
      capture.push({ json: '$.user.id', as: 'studentId' });
      capture.push({ json: '$.user.id', as: 'userId' });

      capture.push({ json: '$.user._id', as: 'user._id' });
      capture.push({ json: '$.user._id', as: 'user_id' });
      capture.push({ json: '$.user._id', as: 'id' });
      capture.push({ json: '$.user._id', as: 'studentId' });

      capture.push({ json: '$.id', as: 'id' });
      capture.push({ json: '$.id', as: 'user.id' });
      capture.push({ json: '$.id', as: 'user_id' });

      capture.push({ json: '$._id', as: 'id' });
      capture.push({ json: '$._id', as: 'user_id' });

      capture.push({ json: '$.studentId', as: 'studentId' });
      capture.push({ json: '$.studentId', as: 'user.id' });
      capture.push({ json: '$.userId', as: 'userId' });
      capture.push({ json: '$.userId', as: 'user.id' });

      // Auto-capture all discovered response keys
      if (Array.isArray(step.responseKeys)) {
        step.responseKeys.forEach(key => {
          // Convert dot-notation to JSONPath: user.id → $.user.id
          const jsonPath = '$.' + key.replace(/\[0\]/g, '[0]');
          const varNameUnderscore = key.replace(/[.\[\]]/g, '_').replace(/_+$/,'');
          if (!capture.some(c => c.as === varNameUnderscore)) {
            capture.push({ json: jsonPath, as: varNameUnderscore });
          }
          if (!capture.some(c => c.as === key)) {
            capture.push({ json: jsonPath, as: key });
          }
        });
      }

      const headers = { ...(step.headers || {}) };

      return {
        ...step,
        headers,
        capture
      };
    });

    config = {
      ...config,
      serverUrl: chain.serverUrl || config.serverUrl,
      appUrl: chain.appUrl || config.appUrl,
      hostname: chain.hostname || config.hostname,
      scenarioName: chain.name || 'Chain Load Test',
      steps: chainSteps,
    };
  } else {
    // No chain selected (Single Request mode) — clear steps so buildYaml uses single request configuration
    config.steps = [];
  }

  if (!config || typeof config !== 'object') {
    return res.status(400).json({ success: false, error: 'No configuration provided' });
  }


  const userDataPath = path.join(uploadsDir, 'userData.json');
  const baseSessionsPath = path.join(uploadsDir, 'baseUserSessions.json');
  const hasBaseSessions = config.useBaseConfig && fs.existsSync(baseSessionsPath);
  if (!fs.existsSync(userDataPath) && !hasBaseSessions) {
    return res.status(400).json({ success: false, error: 'No user data or Base Config sessions found. Please upload user data or run Base API Configuration first.' });
  }

  // Write dynamic YAML
  const yamlContent = buildYaml(config, phases, environment);
  const yamlPath = path.join(artilleryDir, 'runtime-test.yml');
  fs.writeFileSync(yamlPath, yamlContent);

  const resultsPath = path.join(artilleryDir, 'results.json');
  const errorLogPath = path.join(artilleryDir, 'error-logs.json');
  const studentLogPath = path.join(artilleryDir, 'student-logs.json');
  const vuCounterPath = path.join(artilleryDir, 'vu-counter.txt');
  if (fs.existsSync(resultsPath)) fs.unlinkSync(resultsPath);
  fs.writeFileSync(errorLogPath, '');
  fs.writeFileSync(studentLogPath, '');
  fs.writeFileSync(vuCounterPath, '0');

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
    BASE_SESSIONS_PATH: baseSessionsPath,
    USE_BASE_CONFIG: String(!!config.useBaseConfig),
  };

  currentProcess = spawn(artilleryCmd, args, {
    cwd: artilleryDir,
    env,
    shell: process.platform === 'win32',
  });

  testStatus = {
    running: true,
    pid: currentProcess.pid,
    startedAt: new Date().toISOString(),
    environment,
  };

  broadcast('status', { ...testStatus, type: 'started' });

  // ── Parse stdout for live metrics ──────────────────────────
  const parser = new MetricsParser();
  let stdoutBuf = '';

  const onMetric = (metric) => {
    metricsBuffer.push(metric);
    broadcast('metrics', metric);
  };

  const processStdoutLines = (chunkText, isFlush = false) => {
    stdoutBuf += chunkText;
    const lines = stdoutBuf.split('\n');
    if (!isFlush) {
      stdoutBuf = lines.pop(); // keep last incomplete line in buffer
    } else {
      stdoutBuf = '';
    }

    const displayLines = [];
    lines.forEach(line => {
      if (line.includes('[STEP_LOG]')) {
        try {
          const jsonStr = line.substring(line.indexOf('[STEP_LOG]') + 10).trim();
          const stepLog = JSON.parse(jsonStr);
          broadcast('stepLog', stepLog);
        } catch (e) { }
      } else {
        displayLines.push(line);
      }
    });

    const cleanText = displayLines.join('\n');
    if (cleanText.trim()) {
      broadcast('log', { text: cleanText, time: new Date().toISOString() });
    }
    parser.feed(lines.join('\n') + '\n', onMetric);
  };

  currentProcess.stdout.on('data', (data) => {
    processStdoutLines(data.toString(), false);
  });

  currentProcess.stderr.on('data', (data) => {
    broadcast('log', { text: data.toString(), level: 'warn', time: new Date().toISOString() });
  });

  currentProcess.on('close', (code) => {
    if (stdoutBuf) {
      processStdoutLines('', true);
    }
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
    try { res.write(`event: metrics\ndata: ${JSON.stringify(m)}\n\n`); } catch { }
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
