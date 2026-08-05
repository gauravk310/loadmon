'use strict';

const fs = require('fs');
const path = require('path');

// Reset error logs at test start
const errorLogPath = path.join(__dirname, 'error-logs.json');
fs.writeFileSync(errorLogPath, '');

// ── Load user data ────────────────────────────────────────
// Supports USERDATA_PATH env var (set by backend) or falls back to local uploads/
const userDataFile = process.env.USERDATA_PATH
  || path.join(__dirname, '..', 'uploads', 'userData.json');

let userData = [];
try {
  userData = JSON.parse(fs.readFileSync(userDataFile, 'utf-8'));
  console.log(`\n📋 Loaded ${userData.length} rows from userData.json`);
  console.log(`🔄 VUs exceeding ${userData.length} will cycle through rows\n`);
} catch (e) {
  console.error(`\n❌ Could not load userData: ${e.message}\n`);
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
  if (!userData.length) return done(new Error('No user data loaded'));

  const index = userIndex % userData.length;
  const user = userData[index];
  userIndex++;

  // Map all fields from userData row to template vars
  Object.entries(user).forEach(([key, val]) => {
    userContext.vars[key] = val;
  });

  // Random IP to bypass rate limiting (requires trust proxy on target)
  userContext.vars.randomIP = randomPublicIPv4();

  return done();
}

// ── logResponse ───────────────────────────────────────────
function logResponse(requestParams, response, context, ee, next) {
  const status = response.statusCode;
  const isSuccess = status >= 200 && status < 300;

  if (isSuccess) {
    successCount++;
  } else {
    failCount++;
    const body = (typeof response.body === 'string'
      ? response.body
      : JSON.stringify(response.body || '')
    ).substring(0, 200);

    // Log to console (streamed to UI via SSE)
    console.log(`❌ FAILED | Status: ${status} | ${body}`);

    // Persist error for report
    const errorLog = {
      timestamp: new Date().toISOString(),
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

module.exports = { assignUser, logResponse };
