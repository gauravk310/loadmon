'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const chainsPath = path.join(__dirname, '..', 'chains.json');
const configPath = path.join(__dirname, '..', 'config.json');

// ── Helper: load config ────────────────────────────────────
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

// ── Helper: load chains ───────────────────────────────────
function loadChains() {
  try {
    return JSON.parse(fs.readFileSync(chainsPath, 'utf8'));
  } catch {
    return [];
  }
}

function saveChains(chains) {
  fs.writeFileSync(chainsPath, JSON.stringify(chains, null, 2));
}

// ── Helper: Save report files for Reports page ─────────────
function saveChainReportFiles(serverUrl, objectResults, passedObjects, failedObjects, startTime) {
  const endTime = Date.now();
  const artilleryDir = path.join(__dirname, '..', 'artillery');
  if (!fs.existsSync(artilleryDir)) {
    fs.mkdirSync(artilleryDir, { recursive: true });
  }

  const studentLogLines = [];
  const errorLogLines = [];
  const sendTimestampLines = [];
  const responseTimes = [];
  const counters = {
    'http.requests': 0,
    'http.responses': 0,
    'vusers.created': objectResults.length,
    'vusers.completed': passedObjects,
    'vusers.failed': failedObjects,
  };

  objectResults.forEach(objRes => {
    const studentId = objRes.identifier || `VU #${objRes.objectIndex}`;
    const rawObj = objRes.objectData || {};

    (objRes.stepResults || []).forEach(sr => {
      counters['http.requests']++;
      counters['http.responses']++;

      const statusCode = sr.status || 500;
      const codeKey = `http.codes.${statusCode}`;
      counters[codeKey] = (counters[codeKey] || 0) + 1;

      if (typeof sr.durationMs === 'number' && sr.durationMs >= 0) {
        responseTimes.push(sr.durationMs);
      }

      const fullUrl = serverUrl ? (serverUrl.replace(/\/$/, '') + sr.endpoint) : sr.endpoint;

      const ts = sr.timestamp || new Date().toISOString();
      sendTimestampLines.push(`${ts} - ${studentId} - ${sr.method} ${fullUrl}`);

      const stepLog = {
        timestamp: ts,
        vuId: `VU #${objRes.objectIndex}`,
        student: studentId,
        studentDetails: {
          email: rawObj.email || studentId,
          name: rawObj.name || rawObj.username || rawObj.student || null,
          id: rawObj.id || null
        },
        stepName: sr.stepName || `${sr.method} ${sr.endpoint}`,
        method: sr.method || 'GET',
        url: fullUrl,
        status: sr.status || 'NETWORK_ERROR',
        success: sr.success,
        executed: true,
        durationMs: sr.durationMs || 0,
        error: sr.success ? null : (typeof sr.body === 'string' ? sr.body : JSON.stringify(sr.body || sr.error || ''))
      };
      studentLogLines.push(JSON.stringify(stepLog));

      if (!sr.success) {
        const errKey = `errors.HTTP_${statusCode}`;
        counters[errKey] = (counters[errKey] || 0) + 1;

        const errorLog = {
          timestamp: ts,
          url: fullUrl,
          vars: rawObj,
          status: sr.status || 'NETWORK_ERROR',
          body: typeof sr.body === 'string' ? sr.body : JSON.stringify(sr.body || sr.error || '')
        };
        errorLogLines.push(JSON.stringify(errorLog));
      }
    });
  });

  responseTimes.sort((a, b) => a - b);
  const count = responseTimes.length;
  const sum = responseTimes.reduce((a, b) => a + b, 0);

  const getPercentile = (arr, p) => {
    if (arr.length === 0) return 0;
    const index = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, Math.min(index, arr.length - 1))];
  };

  const summaries = {
    'http.response_time': {
      min: count > 0 ? responseTimes[0] : 0,
      max: count > 0 ? responseTimes[count - 1] : 0,
      mean: count > 0 ? Math.round(sum / count) : 0,
      median: count > 0 ? getPercentile(responseTimes, 50) : 0,
      p75: count > 0 ? getPercentile(responseTimes, 75) : 0,
      p90: count > 0 ? getPercentile(responseTimes, 90) : 0,
      p95: count > 0 ? getPercentile(responseTimes, 95) : 0,
      p99: count > 0 ? getPercentile(responseTimes, 99) : 0,
    }
  };

  const resultsData = {
    aggregate: {
      counters,
      summaries,
      firstMetricAt: startTime,
      lastMetricAt: endTime
    },
    intermediate: [
      {
        period: String(startTime),
        counters,
        summaries
      }
    ]
  };

  try {
    fs.writeFileSync(path.join(artilleryDir, 'student-logs.json'), studentLogLines.join('\n'));
    fs.writeFileSync(path.join(artilleryDir, 'error-logs.json'), errorLogLines.join('\n'));
    fs.writeFileSync(path.join(artilleryDir, 'send-timestamps.log'), sendTimestampLines.join('\n'));
    fs.writeFileSync(path.join(artilleryDir, 'results.json'), JSON.stringify(resultsData, null, 2));
  } catch (err) {
    console.error('Failed to write artillery results for data-driven chain:', err.message);
  }
}

// ── Helper: flatten JSON object keys (dot notation) ────────
function flattenKeys(obj, prefix = '') {
  const keys = new Set();
  if (typeof obj !== 'object' || obj === null) return Array.from(keys);

  function recurse(o, p = '') {
    if (typeof o !== 'object' || o === null) return;
    if (Array.isArray(o)) {
      if (o.length > 0 && typeof o[0] === 'object' && o[0] !== null) {
        recurse(o[0], p);
      }
      return;
    }
    for (const [k, v] of Object.entries(o)) {
      const fullKey = p ? `${p}.${k}` : k;
      keys.add(fullKey);
      keys.add(k);
      if (typeof v === 'object' && v !== null) {
        recurse(v, fullKey);
      }
    }
  }

  recurse(obj, prefix);
  return Array.from(keys);
}

// ── Helper: resolve {{varName}} in a string ────────────────
function resolveVars(str, context) {
  if (typeof str !== 'string' || !str) return str;
  if (!context || typeof context !== 'object') return str;

  return str.replace(/\{\{\s*([\w.\[\]]+)\s*\}\}/g, (match, key) => {
    // 1. Direct match
    if (context[key] !== undefined && context[key] !== null) return context[key];
    
    // 2. Strip array brackets prefix: [0].classId -> classId or [0]
    const strippedKey = key.replace(/^\[\d+\]\./, '').replace(/\[\d+\]/g, '');
    if (context[strippedKey] !== undefined && context[strippedKey] !== null) {
      return context[strippedKey];
    }

    // 3. Last segment fallback: e.g. "class.classId" or "[0].classId" -> "classId"
    const lastSeg = strippedKey.split('.').pop();
    if (lastSeg && context[lastSeg] !== undefined && context[lastSeg] !== null) {
      return context[lastSeg];
    }

    // 4. Dot notation nested resolution
    const cleanPath = key.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
    const parts = cleanPath.split('.');
    let val = context;
    for (const p of parts) {
      if (val && typeof val === 'object') val = val[p];
      else { val = undefined; break; }
    }
    if (val !== undefined && val !== null) return val;

    return match;
  });
}

function randomPublicIPv4() {
  let first;
  do {
    first = Math.floor(Math.random() * 223) + 1;
  } while (
    first === 10 ||
    first === 127 ||
    first === 169 ||
    first === 172 ||
    first === 192
  );

  const second = Math.floor(Math.random() * 256);
  const third = Math.floor(Math.random() * 256);
  const fourth = Math.floor(Math.random() * 254) + 1;

  return `${first}.${second}.${third}.${fourth}`;
}

// ── Helper: make HTTP request ─────────────────────────────
function proxyRequest({ serverUrl, endpoint, method, headers, body, appUrl }) {
  return new Promise((resolve, reject) => {
    const fullUrl = serverUrl.replace(/\/$/, '') + endpoint;
    let parsedUrl;
    try {
      parsedUrl = new URL(fullUrl);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${fullUrl}`));
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;
    const bodyStr = body && typeof body === 'object' ? JSON.stringify(body) : (body || '');

    // ── Build request headers that mimic a real browser/Artillery request ──
    const defaultOrigin = appUrl
      ? appUrl.replace(/\/$/, '')
      : (serverUrl ? new URL(serverUrl).origin : '');

    const cfg = loadConfig();

    const reqHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'LoadMon/1.0 (Chain Builder)',
      'Host': parsedUrl.hostname,
    };

    if (cfg.randomIp !== false) {
      reqHeaders['X-Forwarded-For'] = randomPublicIPv4();
    }

    if (defaultOrigin) {
      reqHeaders['Origin'] = defaultOrigin;
      reqHeaders['Referer'] = `${defaultOrigin}/`;
    }

    // Merge custom step headers without letting empty keys/values corrupt defaults
    if (headers && typeof headers === 'object') {
      for (const [k, v] of Object.entries(headers)) {
        if (k && k.trim() && v !== undefined && v !== null && v !== '') {
          const existingKey = Object.keys(reqHeaders).find(h => h.toLowerCase() === k.toLowerCase());
          if (existingKey) delete reqHeaders[existingKey];
          reqHeaders[k] = v;
        }
      }
    }

    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method.toUpperCase(),
      headers: reqHeaders,
      timeout: 30000,
    };

    const startTime = Date.now();
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const durationMs = Date.now() - startTime;
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          headersSent: reqHeaders,
          body: data,
          json,
          durationMs,
          success: res.statusCode >= 200 && res.statusCode < 300
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 30s'));
    });

    req.on('error', reject);

    if (bodyStr && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ── GET /api/chains — list all chains ────────────────────
router.get('/', (req, res) => {
  res.json({ success: true, chains: loadChains() });
});

// ── POST /api/chains — create or update a chain ──────────
router.post('/', (req, res) => {
  const { id, name, appId, serverUrl, appUrl, steps } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Chain name is required' });
  }

  const chains = loadChains();
  const now = new Date().toISOString();

  if (id) {
    // Update existing
    const idx = chains.findIndex(c => c.id === id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Chain not found' });
    chains[idx] = { ...chains[idx], name, appId, serverUrl, appUrl, steps: steps || [], updatedAt: now };
    saveChains(chains);
    return res.json({ success: true, chain: chains[idx] });
  }

  // Create new
  const chain = {
    id: `chain_${Date.now()}`,
    name: name.trim(),
    appId,
    serverUrl,
    appUrl,
    steps: steps || [],
    createdAt: now,
    updatedAt: now
  };
  chains.push(chain);
  saveChains(chains);
  res.json({ success: true, chain });
});

// ── DELETE /api/chains/:id ────────────────────────────────
router.delete('/:id', (req, res) => {
  const chains = loadChains();
  const filtered = chains.filter(c => c.id !== req.params.id);
  if (filtered.length === chains.length) {
    return res.status(404).json({ success: false, error: 'Chain not found' });
  }
  saveChains(filtered);
  res.json({ success: true });
});

// ── POST /api/chains/run-step ─────────────────────────────
// Execute a single step (or a chain up to stepIndex) against the target server.
// Body:
//   serverUrl   : target server base URL
//   appUrl      : origin URL
//   steps       : array of step configs (all steps in chain so far)
//   stepIndex   : index of the step to run (0-based)
//   context     : optional initial context variables (e.g., from user data)
//
// Returns: array of { stepIndex, status, json, durationMs, success, resolvedUrl, responseKeys }
router.post('/run-step', async (req, res) => {
  let { serverUrl, appUrl, steps, stepIndex, context: initContext = {} } = req.body;

  // ── Fall back to config's selected application if serverUrl/appUrl not provided ──
  const cfg = loadConfig();
  const selectedApp = cfg.applications?.find(a => a.id === cfg.selectedAppId)
    || cfg.applications?.[0]
    || null;

  if (!serverUrl) {
    serverUrl = selectedApp?.serverUrl || cfg.serverUrl || '';
  }
  if (!appUrl) {
    appUrl = selectedApp?.appUrl || cfg.appUrl || '';
  }

  if (!serverUrl) {
    return res.status(400).json({ success: false, error: 'serverUrl is required — configure a Target Application in the Configure page.' });
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ success: false, error: 'steps array is required' });
  }
  if (stepIndex === undefined || stepIndex < 0 || stepIndex >= steps.length) {
    return res.status(400).json({ success: false, error: 'valid stepIndex is required' });
  }

  // Load default user variables from uploads/userData.json and uploads/baseUserSessions.json if available
  let defaultUserVars = {};
  try {
    const userDataPath = path.join(__dirname, '..', 'uploads', 'userData.json');
    if (fs.existsSync(userDataPath)) {
      const rows = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
      if (Array.isArray(rows) && rows.length > 0) {
        defaultUserVars = { ...rows[0] };
      }
    }
  } catch {}

  try {
    const baseSessionsPath = path.join(__dirname, '..', 'uploads', 'baseUserSessions.json');
    if (fs.existsSync(baseSessionsPath)) {
      const sessions = JSON.parse(fs.readFileSync(baseSessionsPath, 'utf8'));
      if (Array.isArray(sessions) && sessions.length > 0) {
        defaultUserVars = { ...defaultUserVars, ...sessions[0] };
      }
    }
  } catch {}

  const results = [];
  // Context accumulates variables from user data + authenticated user sessions + previous step responses
  let context = { ...defaultUserVars, ...initContext };

  // Execute steps 0..stepIndex sequentially
  for (let i = 0; i <= stepIndex; i++) {
    const step = steps[i];
    const method = (step.method || 'GET').toUpperCase();

    // Resolve endpoint
    const resolvedEndpoint = resolveVars(step.endpoint || '/api', context);

    // Resolve headers
    const resolvedHeaders = {};
    for (const [k, v] of Object.entries(step.headers || {})) {
      resolvedHeaders[resolveVars(k, context)] = resolveVars(v, context);
    }

    // ── Auto-propagate session cookies and auth tokens if not explicitly set ──
    const hasCookieHeader = Object.keys(resolvedHeaders).some(h => h.toLowerCase() === 'cookie');
    if (!hasCookieHeader && context.authCookie) {
      resolvedHeaders['Cookie'] = context.authCookie;
    }

    const hasAuthHeader = Object.keys(resolvedHeaders).some(h => h.toLowerCase() === 'authorization');
    if (!hasAuthHeader) {
      const authToken = context.authorization || (context.token ? `Bearer ${context.token}` : null) || (context.access_token ? `Bearer ${context.access_token}` : null) || (context.accessToken ? `Bearer ${context.accessToken}` : null);
      if (authToken) {
        resolvedHeaders['Authorization'] = authToken;
      }
    }

    // Resolve body
    let resolvedBody = null;
    if (['POST', 'PUT', 'PATCH'].includes(method) && step.body) {
      const rawBody = typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
      const resolvedBodyStr = resolveVars(rawBody, context);
      try { resolvedBody = JSON.parse(resolvedBodyStr); } catch { resolvedBody = resolvedBodyStr; }
    }

    try {
      const result = await proxyRequest({
        serverUrl,
        endpoint: resolvedEndpoint,
        method,
        headers: resolvedHeaders,
        body: resolvedBody,
        appUrl  // used to set Origin header so target CORS middleware accepts the request
      });

      // Extract response keys for autocomplete
      const responseKeys = result.json ? flattenKeys(result.json) : [];

      const capturedVarsMap = {};

      // Auto-capture: flatten the JSON into context so subsequent steps can reference keys
      if (result.json && typeof result.json === 'object') {
        const flat = {};
        function doFlatten(obj, prefix) {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) {
            if (obj.length > 0 && typeof obj[0] === 'object') doFlatten(obj[0], prefix);
            return;
          }
          for (const [k, v] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${k}` : k;
            flat[fullKey] = v;
            flat[k] = v; // also store by short key for convenience
            flat[`[0].${fullKey}`] = v;
            flat[`[0].${k}`] = v;
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              capturedVarsMap[fullKey] = v;
              capturedVarsMap[k] = v;
            }
            if (typeof v === 'object' && v !== null) doFlatten(v, fullKey);
          }
        }
        doFlatten(result.json, '');
        Object.assign(context, flat);

        const sampleItem = Array.isArray(result.json) && result.json.length > 0 ? result.json[0] : result.json;
        if (sampleItem && typeof sampleItem === 'object') {
          const sampleId = sampleItem._id || sampleItem.id;
          if (sampleId) {
            if (!context['_id']) context['_id'] = sampleId;
            if (!capturedVarsMap['_id']) capturedVarsMap['_id'] = sampleId;

            if (!sampleItem.testId && (sampleItem.testName !== undefined || sampleItem.onlineExamQuestions !== undefined || sampleItem.isOnlineExamination !== undefined)) {
              if (!context['testId']) context['testId'] = sampleId;
              if (!context['test_id']) context['test_id'] = sampleId;
              capturedVarsMap['testId'] = sampleId;
              capturedVarsMap['test_id'] = sampleId;
            }
            if (!sampleItem.classId && (sampleItem.className !== undefined || sampleItem.instructorId !== undefined)) {
              if (!context['classId']) context['classId'] = sampleId;
              if (!context['class_id']) context['class_id'] = sampleId;
              capturedVarsMap['classId'] = sampleId;
              capturedVarsMap['class_id'] = sampleId;
            }
          }
        }

        // Auto-detect common auth tokens in response JSON
        const tokenCandidate = result.json.access_token || result.json.accessToken || result.json.token || result.json.jwt || result.json.authToken || (result.json.user && (result.json.user.token || result.json.user.access_token));
        if (tokenCandidate && typeof tokenCandidate === 'string') {
          context['token'] = tokenCandidate;
          context['access_token'] = tokenCandidate;
          const formattedBearer = tokenCandidate.startsWith('Bearer ') ? tokenCandidate : `Bearer ${tokenCandidate}`;
          context['authorization'] = formattedBearer;
          context['bearerToken'] = formattedBearer;
        }
      }

      // Also capture cookie header
      const setCookie = result.headers && (result.headers['set-cookie'] || result.headers['Set-Cookie']);
      let capturedCookieStr = null;
      if (setCookie) {
        capturedCookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
        context['authCookie'] = capturedCookieStr;

        // Parse individual cookies
        const cookiesList = Array.isArray(setCookie) ? setCookie : [setCookie];
        cookiesList.forEach(cStr => {
          const firstPair = cStr.split(';')[0];
          const eqIdx = firstPair.indexOf('=');
          if (eqIdx !== -1) {
            const cName = firstPair.substring(0, eqIdx).trim();
            const cVal = firstPair.substring(eqIdx + 1).trim();
            context[`cookie_${cName}`] = cVal;
            if (cName === 'access_token' || cName === 'token' || cName === 'jwt') {
              if (!context['token']) {
                context['token'] = cVal;
                context['access_token'] = cVal;
                context['authorization'] = `Bearer ${cVal}`;
              }
            }
          }
        });
      }

      // Compute the origin that was sent so UI can display it for debugging
      const sentOrigin = result.headersSent?.Origin || result.headersSent?.origin || (appUrl ? appUrl.replace(/\/$/, '') : (serverUrl ? new URL(serverUrl).origin : '(None)'));

      // Build structured capturedData object for UI display
      const capturedData = {
        cookies: capturedCookieStr || context.authCookie || null,
        tokens: {
          token: context.token || null,
          access_token: context.access_token || null,
          authorization: context.authorization || null,
        },
        vars: capturedVarsMap,
        headers: result.headers || {},
        autoInjectedHeaders: {
          cookie: !hasCookieHeader && context.authCookie ? context.authCookie : null,
          authorization: !hasAuthHeader && (context.authorization || context.token) ? (context.authorization || `Bearer ${context.token}`) : null,
        }
      };

      results.push({
        stepIndex: i,
        stepName: step.name || `Step ${i + 1}`,
        resolvedUrl: serverUrl.replace(/\/$/, '') + resolvedEndpoint,
        sentOrigin,           // the Origin header value sent with the request
        status: result.status,
        success: result.success,
        json: result.json,
        body: result.body,   // always include raw body so UI can show error responses too
        durationMs: result.durationMs,
        responseKeys,
        capturedData
      });

      // If this step failed, stop the chain (no point running subsequent steps)
      if (!result.success) break;

    } catch (err) {
      // Surface a clear error — network/DNS failures can look like CORS errors in the browser
      // but since this runs server-side, the real cause is always in err.message
      results.push({
        stepIndex: i,
        stepName: step.name || `Step ${i + 1}`,
        resolvedUrl: serverUrl.replace(/\/$/, '') + resolvedEndpoint,
        status: null,
        success: false,
        error: `Connection failed: ${err.message}`,
        durationMs: null,
        responseKeys: []
      });
      break;
    }
  }

  res.json({ success: true, results, context });
});

// ── POST /api/chains/run-data-driven ────────────────────
// Run chain sequentially for each object in objects array
router.post('/run-data-driven', async (req, res) => {
  try {
    let { serverUrl, appUrl, steps, objects, limit, duration, arrivalRate } = req.body;

    const cfg = loadConfig();
    const selectedApp = cfg.applications?.find(a => a.id === cfg.selectedAppId) || cfg.applications?.[0] || null;

    if (!serverUrl) serverUrl = selectedApp?.serverUrl || cfg.serverUrl || '';
    if (!appUrl) appUrl = selectedApp?.appUrl || cfg.appUrl || '';

    if (!serverUrl) {
      return res.status(400).json({ success: false, error: 'serverUrl is required' });
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ success: false, error: 'steps array is required' });
    }

    // Parse or sanitize objects
    let dataObjects = [];
    if (Array.isArray(objects)) {
      dataObjects = objects;
    } else if (typeof objects === 'string') {
      try {
        const parsed = JSON.parse(objects);
        dataObjects = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid JSON objects input' });
      }
    }

    // Fallback to baseUserSessions.json or userData.json if dataObjects is empty
    if (dataObjects.length === 0) {
      try {
        const baseSessionsPath = path.join(__dirname, '..', 'uploads', 'baseUserSessions.json');
        if (fs.existsSync(baseSessionsPath)) {
          const sessions = JSON.parse(fs.readFileSync(baseSessionsPath, 'utf8'));
          if (Array.isArray(sessions) && sessions.length > 0) dataObjects = sessions;
        }
      } catch {}
    }
    if (dataObjects.length === 0) {
      try {
        const userDataPath = path.join(__dirname, '..', 'uploads', 'userData.json');
        if (fs.existsSync(userDataPath)) {
          const rows = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
          if (Array.isArray(rows)) dataObjects = rows;
        }
      } catch {}
    }

    if (dataObjects.length === 0) {
      return res.status(400).json({ success: false, error: 'No data objects available to run' });
    }

    const maxLimit = Number(limit) > 0 ? Math.min(Number(limit), dataObjects.length) : dataObjects.length;
    const dur = Number(duration) > 0 ? Number(duration) : 0;
    const arrRate = Number(arrivalRate) > 0 ? Number(arrivalRate) : 0;

    let targetCount = maxLimit;
    if (dur > 0 && arrRate > 0) {
      targetCount = Math.min(maxLimit, Math.round(dur * arrRate));
    }
    const targetObjects = dataObjects.slice(0, targetCount);

    const startTime = Date.now();
    let passedObjects = 0;
    let failedObjects = 0;

    // Track per-step aggregates: stepIndex -> { totalMs, passCount, failCount }
    const stepAggregates = steps.map((s, i) => ({
      stepIndex: i,
      stepName: s.name || `Step ${i + 1}`,
      method: (s.method || 'GET').toUpperCase(),
      endpoint: s.endpoint || '',
      passCount: 0,
      failCount: 0,
      totalDurationMs: 0
    }));

    const objectPromises = targetObjects.map(async (rawObj, objIdx) => {
      if (objIdx > 0 && arrRate > 0) {
        const pacingDelayMs = Math.round((1000 / arrRate) * objIdx);
        await new Promise(resolve => setTimeout(resolve, pacingDelayMs));
      }

      const objectContext = typeof rawObj === 'object' && rawObj !== null ? { ...rawObj } : { value: rawObj };
      const identifier = objectContext.email || objectContext.username || objectContext.id || objectContext.student || `Object #${objIdx + 1}`;

      const stepResults = [];
      let objectSuccess = true;
      let objectTotalDurationMs = 0;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const method = (step.method || 'GET').toUpperCase();

        const resolvedEndpoint = resolveVars(step.endpoint || '/api', objectContext);

        const resolvedHeaders = {};
        for (const [k, v] of Object.entries(step.headers || {})) {
          if (k && v !== undefined && v !== null) {
            resolvedHeaders[resolveVars(k, objectContext)] = resolveVars(String(v), objectContext);
          }
        }

        const hasCookieHeader = Object.keys(resolvedHeaders).some(h => h.toLowerCase() === 'cookie');
        if (!hasCookieHeader && objectContext.authCookie) {
          resolvedHeaders['Cookie'] = objectContext.authCookie;
        }

        const hasAuthHeader = Object.keys(resolvedHeaders).some(h => h.toLowerCase() === 'authorization');
        if (!hasAuthHeader) {
          const authToken = objectContext.authorization || (objectContext.token ? `Bearer ${objectContext.token}` : null) || (objectContext.access_token ? `Bearer ${objectContext.access_token}` : null) || (objectContext.accessToken ? `Bearer ${objectContext.accessToken}` : null);
          if (authToken) {
            resolvedHeaders['Authorization'] = authToken;
          }
        }

        let resolvedBody = null;
        if (['POST', 'PUT', 'PATCH'].includes(method) && step.body) {
          const rawBodyStr = typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
          const resolvedBodyStr = resolveVars(rawBodyStr, objectContext);
          try { resolvedBody = JSON.parse(resolvedBodyStr); } catch { resolvedBody = resolvedBodyStr; }
        }

        const stepStartTime = new Date().toISOString();
        try {
          const result = await proxyRequest({
            serverUrl,
            endpoint: resolvedEndpoint,
            method,
            headers: resolvedHeaders,
            body: resolvedBody,
            appUrl
          });

          const duration = result.durationMs || 0;
          objectTotalDurationMs += duration;

          if (result.json && typeof result.json === 'object') {
            const flat = {};
            function doFlatten(o, prefix) {
              if (!o || typeof o !== 'object') return;
              if (Array.isArray(o)) {
                if (o.length > 0 && typeof o[0] === 'object') doFlatten(o[0], prefix);
                return;
              }
              for (const [k, v] of Object.entries(o)) {
                const fullKey = prefix ? `${prefix}.${k}` : k;
                flat[fullKey] = v;
                flat[k] = v;
                flat[`[0].${fullKey}`] = v;
                flat[`[0].${k}`] = v;
                if (typeof v === 'object' && v !== null) doFlatten(v, fullKey);
              }
            }
            doFlatten(result.json, '');
            Object.assign(objectContext, flat);

            const tokenCandidate = result.json.access_token || result.json.accessToken || result.json.token || result.json.jwt || result.json.authToken || (result.json.user && (result.json.user.token || result.json.user.access_token));
            if (tokenCandidate && typeof tokenCandidate === 'string') {
              objectContext['token'] = tokenCandidate;
              objectContext['access_token'] = tokenCandidate;
              const formattedBearer = tokenCandidate.startsWith('Bearer ') ? tokenCandidate : `Bearer ${tokenCandidate}`;
              objectContext['authorization'] = formattedBearer;
              objectContext['bearerToken'] = formattedBearer;
            }
          }

          const setCookie = result.headers && (result.headers['set-cookie'] || result.headers['Set-Cookie']);
          if (setCookie) {
            const capturedCookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
            objectContext['authCookie'] = capturedCookieStr;
          }

          stepResults.push({
            stepIndex: i,
            stepName: step.name || `Step ${i + 1}`,
            timestamp: stepStartTime,
            method,
            endpoint: resolvedEndpoint,
            status: result.status,
            success: result.success,
            durationMs: duration,
            body: result.body,
            json: result.json,
            error: result.success ? null : `HTTP ${result.status}`
          });

          if (result.success) {
            stepAggregates[i].passCount++;
            stepAggregates[i].totalDurationMs += duration;
          } else {
            stepAggregates[i].failCount++;
            stepAggregates[i].totalDurationMs += duration;
            objectSuccess = false;
            break; // Stop remaining steps for this object
          }

        } catch (err) {
          objectSuccess = false;
          stepAggregates[i].failCount++;
          stepResults.push({
            stepIndex: i,
            stepName: step.name || `Step ${i + 1}`,
            timestamp: stepStartTime,
            method,
            endpoint: resolvedEndpoint,
            status: null,
            success: false,
            durationMs: 0,
            error: err.message
          });
          break;
        }
      }

      if (objectSuccess) {
        passedObjects++;
      } else {
        failedObjects++;
      }

      return {
        objectIndex: objIdx + 1,
        identifier,
        objectData: rawObj,
        success: objectSuccess,
        totalDurationMs: objectTotalDurationMs,
        stepResults
      };
    });

    const objectResults = await Promise.all(objectPromises);

    saveChainReportFiles(serverUrl, objectResults, passedObjects, failedObjects, startTime);

    const totalDurationMs = Date.now() - startTime;
    const totalExecuted = objectResults.length;
    const successRate = totalExecuted > 0 ? Number(((passedObjects / totalExecuted) * 100).toFixed(1)) : 0;
    const avgChainDurationMs = totalExecuted > 0 ? Math.round(objectResults.reduce((acc, r) => acc + r.totalDurationMs, 0) / totalExecuted) : 0;

    const stepStats = stepAggregates.map(sa => {
      const stepExecuted = sa.passCount + sa.failCount;
      return {
        stepIndex: sa.stepIndex,
        stepName: sa.stepName,
        method: sa.method,
        endpoint: sa.endpoint,
        passCount: sa.passCount,
        failCount: sa.failCount,
        avgDurationMs: stepExecuted > 0 ? Math.round(sa.totalDurationMs / stepExecuted) : 0
      };
    });

    const reportCard = {
      totalExecuted,
      passedObjects,
      failedObjects,
      successRate,
      totalDurationMs,
      avgChainDurationMs,
      stepStats,
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      reportCard,
      objectResults
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Data-driven execution error' });
  }
});

router.proxyRequest = proxyRequest;
router.resolveVars = resolveVars;
router.flattenKeys = flattenKeys;

module.exports = router;

