const fs = require('fs');
const https = require('https');
const path = require('path');

// ══════════════════════════════════════════════════
// 1. DATA SETUP
// ══════════════════════════════════════════════════
const studentData = JSON.parse(fs.readFileSync(path.join(__dirname, 'studentData.json'), 'utf8'));

// ══════════════════════════════════════════════════
// 2. CONFIGURATION
// ══════════════════════════════════════════════════
const options = {
    vus: 100,             // Number of concurrent users
    durationSeconds: 30,  // How long the test should run
};

const agent = new https.Agent({
    keepAlive: true,
    maxSockets: options.vus + 100,
    timeout: 30000 // 30 seconds
});

// Store every single request for the report
const allRequests = [];

// Reset error logs file at start of test
fs.writeFileSync(path.join(__dirname, 'error-logs.json'), '');

// ══════════════════════════════════════════════════
// 3. THE SCENARIO
// ══════════════════════════════════════════════════
async function scenario(vuId) {
    const user = studentData[vuId % studentData.length];
    const payload = JSON.stringify({ email: user.email, password: user.password });

    const randomIP = `${Math.floor(Math.random() * 254) + 1}.${Math.floor(
        Math.random() * 255
    )}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;

    const requestOptions = {
        hostname: process.env.HOSTNAME,
        path: '/api/auth/signin',
        method: 'POST',
        agent: agent,
        headers: {
            'Content-Type': 'application/json',
            'Origin': process.env.APP_URL,
            'X-Forwarded-For': randomIP,
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    return new Promise((resolve) => {
        const startTime = Date.now();
        
        const req = https.request(requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const responseTime = Date.now() - startTime;
                const passed = res.statusCode === 200 || res.statusCode === 201;
                const result = { 
                    timestamp: new Date(startTime).toISOString(),
                    email: user.email,
                    status: res.statusCode,
                    responseTime,
                    passed,
                    error: passed ? null : data.substring(0, 150)
                };
                if (!passed) {
                    fs.appendFileSync(path.join(__dirname, 'error-logs.json'), JSON.stringify(result) + '\n');
                }
                resolve(result);
            });
        });

        req.on('error', (e) => {
            const responseTime = Date.now() - startTime;
            const errLog = { 
                timestamp: new Date(startTime).toISOString(),
                email: user.email,
                status: 'NETWORK_ERROR',
                responseTime,
                passed: false,
                error: e.code || e.message
            };
            fs.appendFileSync(path.join(__dirname, 'error-logs.json'), JSON.stringify(errLog) + '\n');
            resolve(errLog);
        });
        
        req.setTimeout(30000, () => {
            req.destroy(new Error('ERR_SOCKET_TIMEOUT'));
        });

        req.write(payload);
        req.end();
    });
}

// ══════════════════════════════════════════════════
// 4. THE RUNNER ENGINE
// ══════════════════════════════════════════════════
async function runTest() {
    console.log(`\n🚀 Starting Custom Load Test`);
    console.log(`👥 VUs: ${options.vus} | ⏱️ Duration: ${options.durationSeconds}s\n`);

    const endTime = Date.now() + (options.durationSeconds * 1000);
    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;
    let lastLogTime = Date.now();

    async function startVU(vuId) {
        while (Date.now() < endTime) {
            totalRequests++;
            const result = await scenario(vuId);
            allRequests.push(result);
            
            if (result.passed) successfulRequests++;
            else failedRequests++;

            if (Date.now() - lastLogTime > 2000) {
                lastLogTime = Date.now();
                const rate = totalRequests > 0 ? ((successfulRequests / totalRequests) * 100).toFixed(1) : 0;
                console.log(`📊 Progress: ${totalRequests} requests | ✅ ${successfulRequests} passed | ❌ ${failedRequests} failed | Rate: ${rate}%`);
            }
            await new Promise(r => setTimeout(r, 100)); // Sleep between requests
        }
    }

    const vus = [];
    for (let i = 0; i < options.vus; i++) {
        vus.push(startVU(i));
    }
    await Promise.all(vus);

    console.log(`\n✅ Test Complete! Generating Detailed HTML Report...`);
    generateHTMLReport();
}

// ══════════════════════════════════════════════════
// 5. GENERATE HTML REPORT
// ══════════════════════════════════════════════════
function generateHTMLReport() {
    const totalRequests = allRequests.length;
    const successfulRequests = allRequests.filter(r => r.passed).length;
    const failedRequests = totalRequests - successfulRequests;
    const successRate = totalRequests > 0 ? ((successfulRequests / totalRequests) * 100).toFixed(1) : '0.0';

    // Calculate Response Times
    const responseTimes = allRequests.map(r => r.responseTime).sort((a, b) => a - b);
    const min = responseTimes.length ? responseTimes[0] : 0;
    const max = responseTimes.length ? responseTimes[responseTimes.length - 1] : 0;
    const mean = responseTimes.length ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;
    const p95 = responseTimes.length ? responseTimes[Math.floor(responseTimes.length * 0.95)] : 0;

    // Detailed Error Logs HTML from error-logs.json
    let detailedErrorRows = '';
    const errorLogPath = path.join(__dirname, 'error-logs.json');
    if (fs.existsSync(errorLogPath)) {
        const errorLines = fs.readFileSync(errorLogPath, 'utf8').trim().split('\n').filter(Boolean);
        const latestErrors = errorLines.slice(-500).reverse();
        detailedErrorRows = latestErrors.map(line => {
            try {
                const err = JSON.parse(line);
                const timeStr = new Date(err.timestamp).toLocaleTimeString('en-IN', { hour12: false });
                return `
            <tr>
              <td style="white-space:nowrap">${timeStr}</td>
              <td><code>${err.email}</code></td>
              <td><span class="badge badge-error">${err.status}</span></td>
              <td class="errors-cell">${err.responseTime}ms</td>
              <td class="errors-cell">${(err.error || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
            </tr>`;
            } catch(e) {
                return '';
            }
        }).join('');
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GradeMeAI — Detailed Load Test Report</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #f8f9fb; color: #1e293b; line-height: 1.6; padding: 2.5rem 1.5rem; }
    .container { max-width: 1200px; margin: 0 auto; }
    header { margin-bottom: 2.5rem; }
    h1 { font-size: 1.75rem; font-weight: 800; color: #0f172a; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem 1.5rem; }
    .kpi-label { font-size: 0.7rem; text-transform: uppercase; font-weight: 600; color: #94a3b8; margin-bottom: 0.3rem; }
    .kpi-value { font-size: 1.85rem; font-weight: 700; color: #0f172a; }
    .kpi-value.success { color: #16a34a; }
    .kpi-value.danger { color: #dc2626; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; font-size: 0.85rem; }
    th { background: #f8fafc; font-weight: 600; color: #64748b; text-align: left; padding: 0.75rem 1rem; border-bottom: 1px solid #e2e8f0; }
    td { padding: 0.7rem 1rem; border-bottom: 1px solid #f1f5f9; }
    .badge-error { background: #fee2e2; color: #dc2626; padding: 2px 8px; border-radius: 12px; font-weight: 600; }
    .section-title { font-size: 1.1rem; font-weight: 700; color: #dc2626; margin-bottom: 1rem; }
  </style>
</head>
<body>
<div class="container">
  <header><h1>GradeMeAI - Detailed Custom Load Test Report</h1></header>
  
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Total Requests</div><div class="kpi-value">${totalRequests}</div></div>
    <div class="kpi"><div class="kpi-label">Success Rate</div><div class="kpi-value ${parseFloat(successRate) >= 95 ? 'success' : 'danger'}">${successRate}%</div></div>
    <div class="kpi"><div class="kpi-label">Mean RT</div><div class="kpi-value">${mean}ms</div></div>
    <div class="kpi"><div class="kpi-label">P95 RT</div><div class="kpi-value">${p95}ms</div></div>
    <div class="kpi"><div class="kpi-label">Total Failed</div><div class="kpi-value danger">${failedRequests}</div></div>
  </div>

  <div style="margin-top: 3rem;">
    <div class="section-title">Complete Failed Request Log (Latest 500)</div>
    ${detailedErrorRows.length > 0 ? `
    <div style="overflow-x:auto;">
    <table>
      <thead><tr><th>Time</th><th>User Email</th><th>Status</th><th>Response Time</th><th>Exact Error Reason / Body</th></tr></thead>
      <tbody>${detailedErrorRows}</tbody>
    </table>
    </div>` : '<div style="background:#fff;padding:2rem;text-align:center;border-radius:12px;border:1px solid #e2e8f0;">No failed requests! 🎉</div>'}
  </div>
</div>
</body>
</html>`;

    const reportPath = path.join(__dirname, 'results.html');
    fs.writeFileSync(reportPath, html);
    console.log(`✨ Detailed Report generated → ${reportPath}`);
}

runTest();
