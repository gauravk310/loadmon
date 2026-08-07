'use strict';

const fs = require('fs');
const path = require('path');

// Reset error and student logs at test start
const errorLogPath = path.join(__dirname, 'error-logs.json');
const studentLogPath = path.join(__dirname, 'student-logs.json');
fs.writeFileSync(errorLogPath, '');
fs.writeFileSync(studentLogPath, '');

// ── Load user data ────────────────────────────────────────
// Supports USERDATA_PATH env var (set by backend) or falls back to local uploads/
const userDataFile = process.env.USERDATA_PATH
  || path.join(__dirname, '..', 'uploads', 'userData.json');
const baseSessionsFile = process.env.BASE_SESSIONS_PATH
  || path.join(__dirname, '..', 'uploads', 'baseUserSessions.json');
const configPath = path.join(__dirname, '..', 'config.json');

let userData = [];
try {
  userData = JSON.parse(fs.readFileSync(userDataFile, 'utf-8'));
  console.log(`\n📋 Loaded ${userData.length} rows from userData.json`);
} catch (e) {
  console.error(`\n❌ Could not load userData: ${e.message}\n`);
}

let baseUserSessions = [];
try {
  if (fs.existsSync(baseSessionsFile)) {
    baseUserSessions = JSON.parse(fs.readFileSync(baseSessionsFile, 'utf-8'));
    console.log(`🔑 Loaded ${baseUserSessions.length} base user sessions from baseUserSessions.json\n`);
  }
} catch (e) {
  console.error(`\n❌ Could not load baseUserSessions: ${e.message}\n`);
}

let userIndex = 0;
let successCount = 0;
let failCount = 0;

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

// ── assignUser ────────────────────────────────────────────
function assignUser(userContext, events, done) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
  const useBaseConfig = cfg.useBaseConfig || process.env.USE_BASE_CONFIG === 'true';

  if (!userData.length && (!useBaseConfig || !baseUserSessions.length)) {
    return done(new Error('No user data loaded. Upload user data or run Base API Configuration.'));
  }

  userIndex++;

  if (userData.length > 0) {
    const index = (userIndex - 1) % userData.length;
    const user = userData[index];
    Object.entries(user).forEach(([key, val]) => {
      userContext.vars[key] = val;
    });

    const idVal = user.id || user._id || user.studentId || user.userId || user.user_id || user['user.id'];
    if (idVal !== undefined) {
      userContext.vars['id'] = userContext.vars['id'] || idVal;
      userContext.vars['user.id'] = userContext.vars['user.id'] || idVal;
      userContext.vars['user_id'] = userContext.vars['user_id'] || idVal;
      userContext.vars['studentId'] = userContext.vars['studentId'] || idVal;
      userContext.vars['userId'] = userContext.vars['userId'] || idVal;
    }
  }

  if (useBaseConfig && baseUserSessions.length > 0) {
    const bIndex = (userIndex - 1) % baseUserSessions.length;
    const baseSession = baseUserSessions[bIndex];
    Object.entries(baseSession).forEach(([key, val]) => {
      if (val !== undefined && val !== null) {
        userContext.vars[key] = val;
      }
    });
  }

  // Random IP to bypass rate limiting (requires trust proxy on target)
  userContext.vars.randomIP = randomPublicIPv4();
  if (!userContext.vars._vuId) {
    userContext.vars._vuId = userContext.uuid || `VU-${userIndex}`;
  }

  return done();
}

// ── beforeStep ────────────────────────────────────────────
function beforeStep(requestParams, context, ee, next) {
  requestParams._startTime = Date.now();
  if (requestParams.name) {
    requestParams._stepName = requestParams.name;
  }

  const resolveValue = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/\{\{\s*([\w.\[\]]+)\s*\}\}/g, (match, key) => {
      // 1. Direct match
      if (context.vars && context.vars[key] !== undefined && context.vars[key] !== '') {
        return context.vars[key];
      }
      // 2. Underscore alias (user.id -> user_id)
      const underscoreKey = key.replace(/\./g, '_');
      if (context.vars && context.vars[underscoreKey] !== undefined && context.vars[underscoreKey] !== '') {
        return context.vars[underscoreKey];
      }
      // 3. Dot alias (user_id -> user.id)
      const dotKey = key.replace(/_/g, '.');
      if (context.vars && context.vars[dotKey] !== undefined && context.vars[dotKey] !== '') {
        return context.vars[dotKey];
      }
      // 4. User ID fallbacks
      if (/^(user\.id|user_id|userId|studentId|id|student\.id)$/i.test(key)) {
        const idVal = context.vars?.['user.id'] || context.vars?.['user_id'] || context.vars?.['id'] || context.vars?.['_id'] || context.vars?.['userId'] || context.vars?.['studentId'];
        if (idVal !== undefined && idVal !== '') return idVal;
      }
      // 5. Token fallbacks
      if (/^(token|access_token|jwt|authorization)$/i.test(key)) {
        const tokenVal = context.vars?.['access_token'] || context.vars?.['token'] || context.vars?.['jwt'] || context.vars?.['authorization'];
        if (tokenVal !== undefined && tokenVal !== '') return tokenVal;
      }

      // 6. Nested object resolution
      const parts = key.split('.');
      let val = context.vars;
      for (const p of parts) {
        if (val && typeof val === 'object') val = val[p];
        else { val = undefined; break; }
      }
      if (val !== undefined && val !== '') return val;

      return match;
    });
  };

  // Resolve URL placeholders (e.g. {{user.id}} or {{user._id}})
  if (requestParams.url) {
    let resolvedUrl = resolveValue(requestParams.url);
    if (/\{\{\s*[\w.\[\]]+\s*\}\}/.test(resolvedUrl)) {
      const fallbackId = context.vars?.['user.id']
        || context.vars?.['user._id']
        || context.vars?.['user_id']
        || context.vars?.['id']
        || context.vars?.['_id']
        || context.vars?.['studentId']
        || context.vars?.['userId']
        || context.vars?.user?.id
        || context.vars?.user?._id;
      if (fallbackId && fallbackId !== 'undefined') {
        resolvedUrl = resolvedUrl.replace(/\{\{\s*[\w.\[\]]+\s*\}\}/g, fallbackId);
      }
    }
    requestParams.url = resolvedUrl;
  }

  // Resolve headers placeholders & strip invalid/unresolved header entries
  requestParams.headers = requestParams.headers || {};
  for (const [hk, hv] of Object.entries(requestParams.headers)) {
    if (typeof hv === 'string') {
      const resolved = resolveValue(hv);
      if (!resolved || resolved === 'undefined' || resolved === 'null' || /^\{\{.*\}\}$/.test(resolved.trim())) {
        delete requestParams.headers[hk];
      } else {
        requestParams.headers[hk] = resolved;
      }
    }
  }

  // Auto-propagate Cookie header if missing and authCookie is available
  const hasCookieHeader = Object.keys(requestParams.headers).some(h => h.toLowerCase() === 'cookie');
  if (!hasCookieHeader && context.vars?.authCookie && context.vars.authCookie !== 'undefined') {
    requestParams.headers['Cookie'] = context.vars.authCookie;
  }

  // Auto-propagate Authorization header if missing and token is available
  const hasAuthHeader = Object.keys(requestParams.headers).some(h => h.toLowerCase() === 'authorization');
  if (!hasAuthHeader) {
    const tokenVal = context.vars?.authorization || context.vars?.access_token || context.vars?.token || context.vars?.jwt;
    if (tokenVal && tokenVal !== 'undefined') {
      requestParams.headers['Authorization'] = tokenVal.startsWith('Bearer ') ? tokenVal : `Bearer ${tokenVal}`;
    }
  }

  // Resolve JSON body placeholders
  if (requestParams.json && typeof requestParams.json === 'object') {
    const jsonStr = JSON.stringify(requestParams.json);
    const resolvedStr = resolveValue(jsonStr);
    try {
      requestParams.json = JSON.parse(resolvedStr);
    } catch {
      // keep original if parse fails
    }
  }

  return next();
}

// ── logResponse ───────────────────────────────────────────
function logResponse(requestParams, response, context, ee, next) {
  const status = response ? response.statusCode : 0;
  const isSuccess = status >= 200 && status < 300;
  const url = requestParams.url || requestParams.uri || 'Unknown URL';
  const method = (requestParams.method || 'GET').toUpperCase();
  const startTime = requestParams._startTime || Date.now();
  const durationMs = Math.max(0, Date.now() - startTime);

  // Auto-extract common variables from response JSON into context.vars for subsequent steps
  if (response && response.body) {
    try {
      const resJson = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      if (resJson && typeof resJson === 'object') {
        const userObj = resJson.user || resJson.data?.user || resJson.data || resJson;
        const idVal = userObj.id || userObj._id || resJson.id || resJson._id || resJson.studentId || resJson.userId;
        if (idVal && context.vars) {
          context.vars['user.id'] = idVal;
          context.vars['user_id'] = idVal;
          context.vars['user._id'] = idVal;
          context.vars['id'] = idVal;
          context.vars['studentId'] = idVal;
          context.vars['userId'] = idVal;

          context.vars.user = context.vars.user || {};
          context.vars.user.id = idVal;
          context.vars.user._id = idVal;
        }

        const tokenCandidate = resJson.access_token || resJson.token || resJson.jwt || resJson.authorization || userObj.token || userObj.access_token;
        if (tokenCandidate && typeof tokenCandidate === 'string' && context.vars) {
          context.vars['token'] = tokenCandidate;
          context.vars['access_token'] = tokenCandidate;
          context.vars['authorization'] = tokenCandidate.startsWith('Bearer ') ? tokenCandidate : `Bearer ${tokenCandidate}`;
          if (context.vars.user) {
            context.vars.user.token = tokenCandidate;
            context.vars.user.access_token = tokenCandidate;
          }
        }
      }
    } catch {}
  }

  const studentIdentifier = (context.vars && (context.vars.email || context.vars.username || context.vars.studentId || context.vars.name)) || `VU ${context.vars?._vuId || 'Unknown'}`;
  const stepName = requestParams.name || requestParams._stepName || `${method} ${url}`;

  const body = response ? (typeof response.body === 'string'
    ? response.body
    : JSON.stringify(response.body || '')
  ).substring(0, 250) : 'No response / network error';

  // Record student step log entry
  const stepLog = {
    timestamp: new Date().toISOString(),
    vuId: context.vars?._vuId || context.uuid,
    student: studentIdentifier,
    studentDetails: {
      email: context.vars?.email || null,
      name: context.vars?.name || context.vars?.fullName || null,
      id: context.vars?.id || context.vars?.studentId || null,
    },
    stepName: stepName,
    method: method,
    url: url,
    status: status || 'NETWORK_ERROR',
    success: isSuccess,
    executed: true,
    durationMs: durationMs,
    error: isSuccess ? null : body
  };

  try {
    fs.appendFileSync(studentLogPath, JSON.stringify(stepLog) + '\n');
    console.log('[STEP_LOG] ' + JSON.stringify(stepLog));
  } catch (err) {
    console.error('Failed to append student log:', err.message);
  }

  if (isSuccess) {
    successCount++;
  } else {
    failCount++;
    const emailTag = studentIdentifier ? ` | VU: ${studentIdentifier}` : '';
    // Log to console (streamed to UI via SSE)
    console.log(`❌ Step Failed [${status}] | URL: ${url}${emailTag} | Response: ${body}`);

    // Persist error for report
    const errorLog = {
      timestamp: new Date().toISOString(),
      url: url,
      vars: context.vars,
      status: status || 'NETWORK_ERROR',
      body: body || 'Timeout or connection error'
    };
    fs.appendFileSync(errorLogPath, JSON.stringify(errorLog) + '\n');
  }

  const total = successCount + failCount;
  if (total % 25 === 0 && total > 0) {
    const rate = ((successCount / total) * 100).toFixed(1);
    console.log(`📊 Progress: ${total} total | ✅ ${successCount} ok | ❌ ${failCount} failed | ${rate}% success`);
  }

  ee.emit('counter', 'custom.requests.success', isSuccess ? 1 : 0);
  ee.emit('counter', 'custom.requests.failure', !isSuccess ? 1 : 0);

  return next();
}

module.exports = { assignUser, beforeStep, logResponse };
