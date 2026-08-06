'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const chainsPath = path.join(__dirname, '..', 'chains.json');
const configPath = path.join(__dirname, '..', 'config.json');

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

// ── Helper: make HTTP request ─────────────────────────────
function proxyRequest({ serverUrl, endpoint, method, headers, body }) {
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

    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
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
  const { serverUrl, appUrl, steps, stepIndex, context: initContext = {} } = req.body;

  if (!serverUrl) {
    return res.status(400).json({ success: false, error: 'serverUrl is required' });
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ success: false, error: 'steps array is required' });
  }
  if (stepIndex === undefined || stepIndex < 0 || stepIndex >= steps.length) {
    return res.status(400).json({ success: false, error: 'valid stepIndex is required' });
  }

  const results = [];
  // Context accumulates variables from responses
  let context = { ...initContext };

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
        body: resolvedBody
      });

      // Extract response keys for autocomplete
      const responseKeys = result.json ? flattenKeys(result.json) : [];

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
            if (typeof v === 'object' && v !== null) doFlatten(v, fullKey);
          }
        }
        doFlatten(result.json, '');
        Object.assign(context, flat);
      }

      // Also capture cookie header
      const setCookie = result.headers && result.headers['set-cookie'];
      if (setCookie) {
        context['authCookie'] = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
      }

      results.push({
        stepIndex: i,
        stepName: step.name || `Step ${i + 1}`,
        resolvedUrl: serverUrl.replace(/\/$/, '') + resolvedEndpoint,
        status: result.status,
        success: result.success,
        json: result.json,
        body: result.json ? undefined : result.body,
        durationMs: result.durationMs,
        responseKeys
      });

      // If this step failed and it's not the last, we could stop
      // but for chain building we still continue to give the user feedback
      if (!result.success) break;

    } catch (err) {
      results.push({
        stepIndex: i,
        stepName: step.name || `Step ${i + 1}`,
        resolvedUrl: serverUrl.replace(/\/$/, '') + resolvedEndpoint,
        status: null,
        success: false,
        error: err.message,
        durationMs: null,
        responseKeys: []
      });
      break;
    }
  }

  res.json({ success: true, results, context });
});

module.exports = router;
