'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');

// ── GET /api/config ───────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/config ──────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const updated = { ...existing, ...req.body };
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
    res.json({ success: true, config: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/config/base-status ───────────────────────────
router.get('/base-status', (req, res) => {
  try {
    const baseSessionsPath = path.join(__dirname, '..', 'uploads', 'baseUserSessions.json');
    let preparedCount = 0;
    let sampleKeys = [];
    if (fs.existsSync(baseSessionsPath)) {
      const sessions = JSON.parse(fs.readFileSync(baseSessionsPath, 'utf8'));
      preparedCount = Array.isArray(sessions) ? sessions.length : 0;
      if (preparedCount > 0 && typeof sessions[0] === 'object') {
        sampleKeys = Object.keys(sessions[0]);
      }
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    res.json({
      success: true,
      useBaseConfig: !!config.useBaseConfig,
      baseNumUsers: config.baseNumUsers || 10,
      baseStepsCount: config.baseSteps ? config.baseSteps.length : 0,
      baseSavedKeys: config.baseSavedKeys || sampleKeys,
      preparedCount,
      preparedAt: config.basePreparedAt || null
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/config/run-base-chain ──────────────────────
router.post('/run-base-chain', async (req, res) => {
  try {
    const { baseNumUsers = 10, baseSteps = [] } = req.body;
    const numUsers = Math.max(1, Math.min(1000, Number(baseNumUsers) || 10));

    if (!Array.isArray(baseSteps) || baseSteps.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one step is required in Base API Configuration' });
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const selectedApp = config.applications?.find(a => a.id === config.selectedAppId)
      || config.applications?.[0]
      || null;

    const serverUrl = selectedApp?.serverUrl || config.serverUrl || '';
    const appUrl = selectedApp?.appUrl || config.appUrl || '';

    if (!serverUrl) {
      return res.status(400).json({ success: false, error: 'Server URL target is not set in Environment & Target Applications' });
    }

    const chainsRoute = require('./chains');
    const proxyRequest = chainsRoute.proxyRequest;
    const resolveVars = chainsRoute.resolveVars;
    const flattenKeys = chainsRoute.flattenKeys;

    // Load source user rows from userData.json if present
    let userData = [];
    const userDataPath = path.join(__dirname, '..', 'uploads', 'userData.json');
    if (fs.existsSync(userDataPath)) {
      try { userData = JSON.parse(fs.readFileSync(userDataPath, 'utf8')); } catch {}
    }

    const baseUserSessions = [];
    const allCapturedKeys = new Set(['authCookie', 'token', 'access_token', 'authorization']);
    let successUserCount = 0;
    let failedUserCount = 0;
    const errorDetails = [];

    for (let u = 0; u < numUsers; u++) {
      let initialUserVars = {};
      if (userData.length > 0) {
        initialUserVars = { ...userData[u % userData.length] };
      } else {
        initialUserVars = { userIndex: u + 1, email: `user${u + 1}@test.com`, id: `user_${u + 1}` };
      }

      let userContext = { ...initialUserVars };
      let userSuccess = true;

      for (let sIdx = 0; sIdx < baseSteps.length; sIdx++) {
        const step = baseSteps[sIdx];
        const method = (step.method || 'GET').toUpperCase();

        const resolvedEndpoint = resolveVars(step.endpoint || '/api', userContext);

        const resolvedHeaders = {};
        for (const [k, v] of Object.entries(step.headers || {})) {
          resolvedHeaders[resolveVars(k, userContext)] = resolveVars(v, userContext);
        }

        // Auto propagate cookie & token if not set
        const hasCookieHeader = Object.keys(resolvedHeaders).some(h => h.toLowerCase() === 'cookie');
        if (!hasCookieHeader && userContext.authCookie) {
          resolvedHeaders['Cookie'] = userContext.authCookie;
        }

        const hasAuthHeader = Object.keys(resolvedHeaders).some(h => h.toLowerCase() === 'authorization');
        if (!hasAuthHeader) {
          const authToken = userContext.authorization || (userContext.token ? `Bearer ${userContext.token}` : null) || (userContext.access_token ? `Bearer ${userContext.access_token}` : null);
          if (authToken) {
            resolvedHeaders['Authorization'] = authToken;
          }
        }

        let resolvedBody = null;
        if (['POST', 'PUT', 'PATCH'].includes(method) && step.body) {
          const rawBody = typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
          const resolvedBodyStr = resolveVars(rawBody, userContext);
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

          if (result.json && typeof result.json === 'object') {
            const keys = flattenKeys(result.json);
            keys.forEach(k => allCapturedKeys.add(k));

            function doFlatten(obj, prefix) {
              if (!obj || typeof obj !== 'object') return;
              if (Array.isArray(obj)) {
                if (obj.length > 0 && typeof obj[0] === 'object') doFlatten(obj[0], prefix);
                return;
              }
              for (const [k, v] of Object.entries(obj)) {
                const fullKey = prefix ? `${prefix}.${k}` : k;
                userContext[fullKey] = v;
                userContext[k] = v;
                allCapturedKeys.add(fullKey);
                allCapturedKeys.add(k);
                if (typeof v === 'object' && v !== null) doFlatten(v, fullKey);
              }
            }
            doFlatten(result.json, '');

            const tokenCandidate = result.json.access_token || result.json.accessToken || result.json.token || result.json.jwt || result.json.authToken || (result.json.user && (result.json.user.token || result.json.user.access_token));
            if (tokenCandidate && typeof tokenCandidate === 'string') {
              userContext['token'] = tokenCandidate;
              userContext['access_token'] = tokenCandidate;
              const formattedBearer = tokenCandidate.startsWith('Bearer ') ? tokenCandidate : `Bearer ${tokenCandidate}`;
              userContext['authorization'] = formattedBearer;
            }
          }

          const setCookie = result.headers && (result.headers['set-cookie'] || result.headers['Set-Cookie']);
          if (setCookie) {
            const capturedCookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
            userContext['authCookie'] = capturedCookieStr;
          }

          if (!result.success) {
            userSuccess = false;
            errorDetails.push(`User ${u + 1} failed on step ${sIdx + 1} (${step.name || method}): HTTP ${result.status}`);
            break;
          }
        } catch (err) {
          userSuccess = false;
          errorDetails.push(`User ${u + 1} step ${sIdx + 1} connection error: ${err.message}`);
          break;
        }
      }

      if (userSuccess) {
        successUserCount++;
      } else {
        failedUserCount++;
      }

      baseUserSessions.push(userContext);
    }

    // Save baseUserSessions.json
    const baseSessionsPath = path.join(__dirname, '..', 'uploads', 'baseUserSessions.json');
    fs.writeFileSync(baseSessionsPath, JSON.stringify(baseUserSessions, null, 2));

    const savedKeysList = Array.from(allCapturedKeys);

    // Update config.json
    const updatedConfig = {
      ...config,
      baseNumUsers: numUsers,
      baseSteps,
      baseSavedKeys: savedKeysList,
      basePreparedCount: baseUserSessions.length,
      basePreparedAt: new Date().toISOString(),
    };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));

    res.json({
      success: true,
      message: `Executed Base API Chain for ${numUsers} users: ${successUserCount} succeeded, ${failedUserCount} failed.`,
      preparedCount: baseUserSessions.length,
      successUserCount,
      failedUserCount,
      savedKeys: savedKeysList,
      errorDetails: errorDetails.slice(0, 5),
      config: updatedConfig
    });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;

