'use strict';

const fs = require('fs');
const path = require('path');

// Reset error logs file at start of test
fs.writeFileSync(path.join(__dirname, 'error-logs.json'), '');

// ══════════════════════════════════════════════════
//  Load student data once at startup
// ══════════════════════════════════════════════════

const studentData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'studentData.json'), 'utf-8')
);

console.log('\n╔══════════════════════════════════════════════════╗');
console.log(`║  📋 Loaded ${String(studentData.length).padStart(4)} students from studentData.json  ║`);
console.log(`║  🔄 VUs exceeding ${String(studentData.length).padStart(4)} will cycle through users   ║`);
console.log('╚══════════════════════════════════════════════════╝\n');

let userIndex = 0;
let successCount = 0;
let failCount = 0;

// ══════════════════════════════════════════════════
//  assignUser — Assigns a unique student to each VU
// ══════════════════════════════════════════════════
//  Cycles through studentData if total VUs exceed
//  the number of available students.

function assignUser(userContext, events, done) {
  const index = userIndex % studentData.length;
  const user = studentData[index];
  userIndex++;

  userContext.vars.email = user.email;
  userContext.vars.password = user.password;

  // Generate a random IP per VU to bypass single-IP rate limits (requires trust proxy on server)
  const randomIP = `${Math.floor(Math.random() * 254) + 1}.${Math.floor(
    Math.random() * 255
  )}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;
  userContext.vars.randomIP = randomIP;

  return done();
}

// ══════════════════════════════════════════════════
//  logResponse — Logs results & tracks metrics
// ══════════════════════════════════════════════════

function logResponse(requestParams, response, context, ee, next) {
  const status = response.statusCode;
  const email = context.vars.email;

  if (status === 200 || status === 201) {
    successCount++;
  } else {
    failCount++;
    // Truncate response body to avoid flooding the console
    const body = typeof response.body === 'string'
      ? response.body.substring(0, 150)
      : JSON.stringify(response.body || '').substring(0, 150);
    console.log(`❌ FAILED | ${email} | Status: ${status} | ${body}`);
    
    // Save error details to a file for the HTML report
    const errorLog = {
      timestamp: new Date().toISOString(),
      email,
      status: status || 'NETWORK_ERROR',
      body: body || 'Timeout or connection error'
    };
    fs.appendFileSync(path.join(__dirname, 'error-logs.json'), JSON.stringify(errorLog) + '\\n');
  }

  // Log progress every 10 requests
  const total = successCount + failCount;
  if (total % 10 === 0 && total > 0) {
    const successRate = ((successCount / total) * 100).toFixed(1);
    console.log(
      `📊 Progress: ${total} total | ✅ ${successCount} passed | ❌ ${failCount} failed | Rate: ${successRate}%`
    );
  }

  // Emit custom metrics that Artillery will track
  ee.emit('counter', 'custom.logins.success', status === 200 || status === 201 ? 1 : 0);
  ee.emit('counter', 'custom.logins.failure', status !== 200 && status !== 201 ? 1 : 0);

  return next();
}

module.exports = {
  assignUser,
  logResponse,
};
