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

// ── Helper to clean variable keys (strip [0]. prefixes) ────────
function cleanVarKey(key) {
  if (typeof key !== 'string') return key;
  return key.replace(/^\[\d+\]\./, '').replace(/\[\d+\]/g, '');
}

function cleanVarKeysList(keysArr) {
  if (!Array.isArray(keysArr)) return [];
  const cleanedSet = new Set();
  keysArr.forEach(k => {
    if (k && typeof k === 'string') {
      const clean = cleanVarKey(k);
      if (clean) cleanedSet.add(clean);
    }
  });
  return Array.from(cleanedSet);
}

// ── Helper to fallback baseStepSavedKeys if missing in config ──
function getFallbackStepSavedKeys(config) {
  if (config && Array.isArray(config.baseStepSavedKeys) && config.baseStepSavedKeys.length > 0) {
    return config.baseStepSavedKeys.map(s => ({
      ...s,
      keys: cleanVarKeysList(s.keys)
    }));
  }
  if (config && Array.isArray(config.baseSavedKeys) && config.baseSavedKeys.length > 0) {
    const steps = config.baseSteps || [];
    const firstStep = steps[0] || { name: 'Step 1' };
    return [
      {
        stepIndex: 1,
        stepId: firstStep.id || 'step_1',
        stepName: firstStep.name || 'Step 1',
        keys: cleanVarKeysList(config.baseSavedKeys)
      }
    ];
  }
  return [];
}

let baseProgress = {
  running: false,
  totalUsers: 0,
  completedUsers: 0,
  successCount: 0,
  failedCount: 0,
  percent: 0,
  currentStep: ''
};

// ── GET /api/config/base-progress ─────────────────────────
router.get('/base-progress', (req, res) => {
  res.json({ success: true, progress: baseProgress });
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
      baseArrivalRate: config.baseArrivalRate || 10,
      baseStepsCount: config.baseSteps ? config.baseSteps.length : 0,
      baseSavedKeys: cleanVarKeysList(config.baseSavedKeys || sampleKeys),
      baseStepSavedKeys: getFallbackStepSavedKeys(config),
      baseStepResponses: config.baseStepResponses || [],
      preparedCount,
      preparedAt: config.basePreparedAt || null
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/config/base-sessions ─────────────────────────
router.get('/base-sessions', (req, res) => {
  try {
    const baseSessionsPath = path.join(__dirname, '..', 'uploads', 'baseUserSessions.json');
    if (!fs.existsSync(baseSessionsPath)) {
      return res.json({ success: false, exists: false, error: 'No base user sessions saved yet' });
    }
    const sessions = JSON.parse(fs.readFileSync(baseSessionsPath, 'utf8'));
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    if (!Array.isArray(sessions) || sessions.length === 0) {
      return res.json({ success: false, exists: false, error: 'Base user sessions file is empty' });
    }

    const sample = sessions[0] || {};
    const allKeys = Object.keys(sample);
    const keyPriority = ['email', 'user.email', 'id', 'user.id', 'user_id', 'studentId', '_id', 'classId', 'testId', 'authCookie', 'token', 'authorization'];
    const columns = Array.from(new Set([...keyPriority.filter(k => k in sample), ...allKeys.filter(k => !k.startsWith('[0].'))])).slice(0, 15);

    res.json({
      success: true,
      exists: true,
      rowCount: sessions.length,
      preparedAt: config.basePreparedAt || null,
      columns,
      sessions: sessions.slice(0, 500)
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/config/run-base-chain ──────────────────────
router.post('/run-base-chain', async (req, res) => {
  try {
    const { baseNumUsers = 10, baseArrivalRate = 10, baseSteps = [] } = req.body;
    const numUsers = Math.max(1, Math.min(1000, Number(baseNumUsers) || 10));
    const arrRate = Math.max(1, Math.min(1000, Number(baseArrivalRate) || 10));

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

    const allCapturedKeys = new Set(['authCookie', 'token', 'access_token', 'authorization']);
    const stepKeySets = baseSteps.map(() => new Set());
    const baseStepResponses = [];
    let successUserCount = 0;
    let failedUserCount = 0;
    const errorDetails = [];

    baseProgress = {
      running: true,
      totalUsers: numUsers,
      completedUsers: 0,
      successCount: 0,
      failedCount: 0,
      percent: 0,
      currentStep: 'Authenticating user sessions...'
    };

    const runUserSession = async (u) => {
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
            keys.forEach(k => {
              const cleanK = cleanVarKey(k);
              if (cleanK) {
                allCapturedKeys.add(cleanK);
                stepKeySets[sIdx].add(cleanK);
              }
            });

            function doFlatten(obj, prefix) {
              if (!obj || typeof obj !== 'object') return;
              if (Array.isArray(obj)) {
                if (obj.length > 0 && typeof obj[0] === 'object') doFlatten(obj[0], prefix);
                return;
              }
              for (const [k, v] of Object.entries(obj)) {
                const fullKey = prefix ? `${prefix}.${k}` : k;
                const cleanFull = cleanVarKey(fullKey);
                const cleanShort = cleanVarKey(k);

                userContext[cleanFull] = v;
                userContext[cleanShort] = v;
                userContext[`[0].${cleanFull}`] = v;
                userContext[`[0].${cleanShort}`] = v;

                if (cleanFull) {
                  allCapturedKeys.add(cleanFull);
                  stepKeySets[sIdx].add(cleanFull);
                }
                if (cleanShort) {
                  allCapturedKeys.add(cleanShort);
                  stepKeySets[sIdx].add(cleanShort);
                }

                if (typeof v === 'object' && v !== null) doFlatten(v, cleanFull);
              }
            }
            doFlatten(result.json, '');

            // Auto-detect IDs (_id, testId, classId)
            const sampleItem = Array.isArray(result.json) && result.json.length > 0 ? result.json[0] : result.json;
            if (sampleItem && typeof sampleItem === 'object') {
              const sampleId = sampleItem._id || sampleItem.id;
              if (sampleId) {
                if (!userContext['_id']) userContext['_id'] = sampleId;
                allCapturedKeys.add('_id');
                stepKeySets[sIdx].add('_id');

                if (!sampleItem.testId && (sampleItem.testName !== undefined || sampleItem.onlineExamQuestions !== undefined || sampleItem.isOnlineExamination !== undefined)) {
                  if (!userContext['testId']) userContext['testId'] = sampleId;
                  if (!userContext['test_id']) userContext['test_id'] = sampleId;
                  allCapturedKeys.add('testId');
                  allCapturedKeys.add('test_id');
                  stepKeySets[sIdx].add('testId');
                  stepKeySets[sIdx].add('test_id');
                }
                if (!sampleItem.classId && (sampleItem.className !== undefined || sampleItem.instructorId !== undefined)) {
                  if (!userContext['classId']) userContext['classId'] = sampleId;
                  if (!userContext['class_id']) userContext['class_id'] = sampleId;
                  allCapturedKeys.add('classId');
                  allCapturedKeys.add('class_id');
                  stepKeySets[sIdx].add('classId');
                  stepKeySets[sIdx].add('class_id');
                }
              }
            }

            const tokenCandidate = result.json.access_token || result.json.accessToken || result.json.token || result.json.jwt || result.json.authToken || (result.json.user && (result.json.user.token || result.json.user.access_token));
            if (tokenCandidate && typeof tokenCandidate === 'string') {
              userContext['token'] = tokenCandidate;
              userContext['access_token'] = tokenCandidate;
              const formattedBearer = tokenCandidate.startsWith('Bearer ') ? tokenCandidate : `Bearer ${tokenCandidate}`;
              userContext['authorization'] = formattedBearer;
              stepKeySets[sIdx].add('token');
              stepKeySets[sIdx].add('access_token');
              stepKeySets[sIdx].add('authorization');
            }
          }

          const setCookie = result.headers && (result.headers['set-cookie'] || result.headers['Set-Cookie']);
          if (setCookie) {
            const capturedCookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
            userContext['authCookie'] = capturedCookieStr;
            stepKeySets[sIdx].add('authCookie');
          }

          if (u === 0) {
            baseStepResponses.push({
              stepIndex: sIdx + 1,
              stepId: step.id || `step_${sIdx + 1}`,
              stepName: step.name || `Step ${sIdx + 1}`,
              method: method,
              endpoint: step.endpoint,
              resolvedEndpoint: resolvedEndpoint,
              status: result.status,
              statusText: result.statusText,
              duration: result.duration,
              success: result.success,
              headers: result.headers,
              responseJson: result.json || null,
              responseBody: result.text ? (result.text.length > 5000 ? result.text.slice(0, 5000) + '...' : result.text) : null,
              error: !result.success ? `HTTP ${result.status}` : null,
              capturedCookies: userContext['authCookie'] || null,
              capturedTokens: {
                token: userContext['token'] || null,
                access_token: userContext['access_token'] || null,
                authorization: userContext['authorization'] || null
              }
            });
          }

          if (!result.success) {
            userSuccess = false;
            errorDetails.push(`User ${u + 1} failed on step ${sIdx + 1} (${step.name || method}): HTTP ${result.status}`);
            break;
          }
        } catch (err) {
          if (u === 0) {
            baseStepResponses.push({
              stepIndex: sIdx + 1,
              stepId: step.id || `step_${sIdx + 1}`,
              stepName: step.name || `Step ${sIdx + 1}`,
              method: method,
              endpoint: step.endpoint,
              resolvedEndpoint: resolvedEndpoint,
              status: 500,
              statusText: 'Connection Error',
              duration: 0,
              success: false,
              error: err.message,
              responseJson: null,
              responseBody: err.message
            });
          }
          userSuccess = false;
          errorDetails.push(`User ${u + 1} step ${sIdx + 1} connection error: ${err.message}`);
          break;
        }
      }

      baseProgress.completedUsers++;
      if (userSuccess) {
        baseProgress.successCount++;
      } else {
        baseProgress.failedCount++;
      }
      baseProgress.percent = Math.min(100, Math.round((baseProgress.completedUsers / numUsers) * 100));

      return { userContext, userSuccess };
    };

    const userPromises = [];
    const intervalMs = Math.round(1000 / arrRate);

    for (let u = 0; u < numUsers; u++) {
      if (u > 0 && arrRate > 0) {
        await new Promise(r => setTimeout(r, intervalMs));
      }
      userPromises.push(runUserSession(u));
    }

    const userResults = await Promise.all(userPromises);

    const baseUserSessions = [];
    for (let u = 0; u < userResults.length; u++) {
      const resItem = userResults[u];
      if (resItem.userSuccess) {
        successUserCount++;
      } else {
        failedUserCount++;
      }
      baseUserSessions.push(resItem.userContext);
    }

    baseProgress.running = false;
    baseProgress.percent = 100;

    // Save baseUserSessions.json
    const baseSessionsPath = path.join(__dirname, '..', 'uploads', 'baseUserSessions.json');
    fs.writeFileSync(baseSessionsPath, JSON.stringify(baseUserSessions, null, 2));

    const savedKeysList = cleanVarKeysList(Array.from(allCapturedKeys));
    const baseStepSavedKeys = baseSteps.map((step, idx) => ({
      stepIndex: idx + 1,
      stepId: step.id || `step_${idx + 1}`,
      stepName: step.name || `Step ${idx + 1}`,
      keys: cleanVarKeysList(Array.from(stepKeySets[idx] || []))
    }));

    // Update config.json
    const updatedConfig = {
      ...config,
      baseNumUsers: numUsers,
      baseArrivalRate: arrRate,
      baseSteps,
      baseSavedKeys: savedKeysList,
      baseStepSavedKeys,
      baseStepResponses,
      basePreparedCount: baseUserSessions.length,
      basePreparedAt: new Date().toISOString(),
    };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));

    res.json({
      success: true,
      message: `Executed Base API Chain for ${numUsers} users at ${arrRate}/s arrival rate: ${successUserCount} succeeded, ${failedUserCount} failed.`,
      preparedCount: baseUserSessions.length,
      successUserCount,
      failedUserCount,
      savedKeys: savedKeysList,
      baseStepSavedKeys,
      baseStepResponses,
      errorDetails: errorDetails.slice(0, 5),
      config: updatedConfig
    });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;

