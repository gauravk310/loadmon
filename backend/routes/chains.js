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

// ── Helper: flatten JSON object keys (dot notation) ────────
function flattenKeys(obj, prefix = '') {
  const keys = [];
  if (typeof obj !== 'object' || obj === null) return keys;
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
      // Flatten first element keys with [0] notation
      const childKeys = flattenKeys(obj[0], prefix ? `${prefix}[0]` : '[0]');
      keys.push(...childKeys);
    }
    return keys;
  }
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    keys.push(fullKey);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, fullKey));
    } else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      keys.push(...flattenKeys(v[0], `${fullKey}[0]`));
    }
  }
  return keys;
}

// ── Helper: resolve {{varName}} in a string ────────────────
function resolveVars(str, context) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{\s*([\w.\[\]]+)\s*\}\}/g, (match, key) => {
    // Support dot-notation: user.id → context['user.id'] or context.user?.id
    if (context[key] !== undefined) return context[key];
    // Try nested resolution
    const parts = key.split('.');
    let val = context;
    for (const p of parts) {
      if (val && typeof val === 'object') val = val[p];
      else { val = undefined; break; }
    }
    return val !== undefined ? val : match;
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

  // Load default user variables from uploads/userData.json if available
  let defaultUserVars = {};
  try {
    const userDataPath = path.join(__dirname, '..', 'uploads', 'userData.json');
    if (fs.existsSync(userDataPath)) {
      const rows = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
      if (Array.isArray(rows) && rows.length > 0) {
        defaultUserVars = rows[0];
      }
    }
  } catch {}

  const results = [];
  // Context accumulates variables from user data + previous step responses
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
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              capturedVarsMap[fullKey] = v;
            }
            if (typeof v === 'object' && v !== null) doFlatten(v, fullKey);
          }
        }
        doFlatten(result.json, '');
        Object.assign(context, flat);

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

    // Fallback to userData.json if objects not provided
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
    const objectResults = [];
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

    for (let objIdx = 0; objIdx < targetObjects.length; objIdx++) {
      if (objIdx > 0 && arrRate > 0) {
        const pacingDelayMs = Math.round(1000 / arrRate);
        await new Promise(resolve => setTimeout(resolve, pacingDelayMs));
      }

      const rawObj = targetObjects[objIdx];
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

      objectResults.push({
        objectIndex: objIdx + 1,
        identifier,
        objectData: rawObj,
        success: objectSuccess,
        totalDurationMs: objectTotalDurationMs,
        stepResults
      });
    }

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

module.exports = router;

