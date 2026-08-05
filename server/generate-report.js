const fs = require('fs');
const path = require('path');

const resultsPath = path.join(__dirname, 'results.json');
const htmlPath = path.join(__dirname, 'results.html');

if (!fs.existsSync(resultsPath)) {
  console.error("❌ results.json not found! Run a test first (e.g. npm run test:quick)");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const agg = data.aggregate;
const counters = agg.counters || {};
const summaries = agg.summaries || {};
const intermediate = data.intermediate || [];

// ── Core metrics ──────────────────────────────────────────
const totalRequests = counters['http.requests'] || 0;
const totalResponses = counters['http.responses'] || 0;
const vusFailed = counters['vusers.failed'] || 0;
const vusCompleted = counters['vusers.completed'] || 0;
const vusCreated = counters['vusers.created'] || 0;
const downloadedBytes = counters['http.downloaded_bytes'] || 0;

// ── Status codes breakdown ────────────────────────────────
const statusCodes = {};
for (const key of Object.keys(counters)) {
  const match = key.match(/^http\.codes\.(\d+)$/);
  if (match) statusCodes[match[1]] = counters[key];
}

const successCount = Object.entries(statusCodes)
  .filter(([code]) => code.startsWith('2'))
  .reduce((sum, [, count]) => sum + count, 0);

const failedResponses = totalResponses - successCount;
const noResponseCount = totalRequests - totalResponses; // requests that got errors before receiving any HTTP response
const totalFailed = failedResponses + noResponseCount;
const successRate = totalRequests > 0 ? ((successCount / totalRequests) * 100).toFixed(1) : '0.0';

// ── Errors breakdown ─────────────────────────────────────
const errors = {};
for (const key of Object.keys(counters)) {
  const match = key.match(/^errors\.(.+)$/);
  if (match) errors[match[1]] = counters[key];
}

// ── Per-endpoint breakdown ───────────────────────────────
const endpoints = {};
for (const key of Object.keys(counters)) {
  const codeMatch = key.match(/^plugins\.metrics-by-endpoint\.(.+?)\.codes\.(\d+)$/);
  if (codeMatch) {
    const ep = codeMatch[1];
    const code = codeMatch[2];
    if (!endpoints[ep]) endpoints[ep] = { codes: {}, errors: {}, responseTimes: null };
    endpoints[ep].codes[code] = counters[key];
  }
  const errMatch = key.match(/^plugins\.metrics-by-endpoint\.(.+?)\.errors\.(.+)$/);
  if (errMatch) {
    const ep = errMatch[1];
    const errName = errMatch[2];
    if (!endpoints[ep]) endpoints[ep] = { codes: {}, errors: {}, responseTimes: null };
    endpoints[ep].errors[errName] = counters[key];
  }
}
// Attach response time summaries to endpoints
for (const key of Object.keys(summaries)) {
  const rtMatch = key.match(/^plugins\.metrics-by-endpoint\.response_time\.(.+)$/);
  if (rtMatch) {
    const ep = rtMatch[1];
    if (endpoints[ep]) endpoints[ep].responseTimes = summaries[key];
  }
}

// ── Response times ───────────────────────────────────────
const rt = summaries['http.response_time'] || {};
const fmt = (v) => v !== undefined && v !== null ? v.toFixed(0) : 'N/A';
const fmtMs = (v) => v !== undefined && v !== null ? (v / 1000).toFixed(2) + 's' : 'N/A';

// ── Timeline data from intermediate ──────────────────────
const timelineLabels = [];
const timelineMean = [];
const timelineP95 = [];
const timelineSuccessPerPeriod = [];
const timelineFailPerPeriod = [];

for (const entry of intermediate) {
  const periodTs = parseInt(entry.period);
  const d = new Date(periodTs);
  const label = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  timelineLabels.push(label);

  const entryRt = (entry.summaries && entry.summaries['http.response_time']) || {};
  timelineMean.push(entryRt.mean !== undefined ? Math.round(entryRt.mean) : null);
  timelineP95.push(entryRt.p95 !== undefined ? Math.round(entryRt.p95) : null);

  const entryCodes = entry.counters || {};
  const periodSuccess = Object.keys(entryCodes)
    .filter(k => k.match(/^http\.codes\.2\d{2}$/))
    .reduce((s, k) => s + entryCodes[k], 0);
  const periodFail = (entryCodes['vusers.failed'] || 0);
  timelineSuccessPerPeriod.push(periodSuccess);
  timelineFailPerPeriod.push(periodFail);
}

// ── Test duration ────────────────────────────────────────
const firstMetric = data.aggregate.firstMetricAt || agg.firstMetricAt;
const lastMetric = data.aggregate.lastMetricAt || agg.lastMetricAt;
let durationStr = 'N/A';
if (firstMetric && lastMetric) {
  const secs = Math.round((lastMetric - firstMetric) / 1000);
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  durationStr = mins > 0 ? `${mins}m ${remSecs}s` : `${secs}s`;
}

const testDate = firstMetric ? new Date(firstMetric).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown';

// ── Build status code rows ───────────────────────────────
function statusCodeClass(code) {
  if (code.startsWith('2')) return 'badge-success';
  if (code.startsWith('3')) return 'badge-info';
  if (code.startsWith('4')) return 'badge-warn';
  return 'badge-error';
}

const statusCodeRows = Object.entries(statusCodes)
  .sort(([a], [b]) => a - b)
  .map(([code, count]) => `
    <tr>
      <td><span class="badge ${statusCodeClass(code)}">${code}</span></td>
      <td>${count.toLocaleString()}</td>
      <td>${(count / totalRequests * 100).toFixed(1)}%</td>
    </tr>`).join('');

// ── Build error rows ─────────────────────────────────────
const totalErrors = Object.values(errors).reduce((s, v) => s + v, 0);
const errorRows = Object.entries(errors)
  .sort(([, a], [, b]) => b - a)
  .map(([name, count]) => `
    <tr>
      <td><code>${name}</code></td>
      <td>${count.toLocaleString()}</td>
      <td>${(count / totalRequests * 100).toFixed(1)}%</td>
    </tr>`).join('');

// ── Build endpoint rows ──────────────────────────────────
const endpointRows = Object.entries(endpoints).map(([ep, info]) => {
  const totalEp = Object.values(info.codes).reduce((s, v) => s + v, 0) + Object.values(info.errors).reduce((s, v) => s + v, 0);
  const successEp = Object.entries(info.codes).filter(([c]) => c.startsWith('2')).reduce((s, [, v]) => s + v, 0);
  const epRate = totalEp > 0 ? ((successEp / totalEp) * 100).toFixed(1) : '0.0';
  const rt = info.responseTimes || {};
  const codesStr = Object.entries(info.codes).map(([c, v]) => `<span class="badge ${statusCodeClass(c)}">${c}</span> ×${v}`).join(' &nbsp;');
  const errsStr = Object.entries(info.errors).map(([e, v]) => `<code>${e}</code> ×${v}`).join(', ') || '—';

  return `
    <tr>
      <td><code>${ep}</code></td>
      <td>${codesStr || '—'}</td>
      <td class="errors-cell">${errsStr}</td>
      <td>${fmt(rt.mean)} ms</td>
      <td>${fmt(rt.p95)} ms</td>
      <td><span class="rate-pill ${parseFloat(epRate) >= 95 ? 'rate-good' : 'rate-bad'}">${epRate}%</span></td>
    </tr>`;
}).join('');

// ── Detailed Error Logs ─────────────────────────────────
const errorLogPath = path.join(__dirname, 'error-logs.json');
let detailedErrorRows = '';

if (fs.existsSync(errorLogPath)) {
  const errorLines = fs.readFileSync(errorLogPath, 'utf8').trim().split('\\n').filter(Boolean);
  
  // Show up to the last 100 errors to avoid freezing the browser with massive tables
  const latestErrors = errorLines.slice(-100).reverse();
  
  detailedErrorRows = latestErrors.map(line => {
    try {
      const err = JSON.parse(line);
      const timeStr = new Date(err.timestamp).toLocaleTimeString('en-IN', { hour12: false });
      return `
        <tr>
          <td style="white-space:nowrap">${timeStr}</td>
          <td><code>${err.email}</code></td>
          <td><span class="badge ${err.status == 200 || err.status == 201 ? 'badge-success' : 'badge-error'}">${err.status}</span></td>
          <td class="errors-cell">${err.body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
        </tr>`;
    } catch(e) {
      return '';
    }
  }).join('');
}

// ── HTML ─────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GradeMeAI — Load Test Report</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: #f8f9fb;
      color: #1e293b;
      line-height: 1.6;
      padding: 2.5rem 1.5rem;
    }
    .container { max-width: 1100px; margin: 0 auto; }

    /* ── Header ─────────────────────────────── */
    header { margin-bottom: 2.5rem; }
    h1 {
      font-size: 1.75rem;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
    }
    .meta {
      color: #64748b;
      font-size: 0.85rem;
      margin-top: 0.35rem;
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
    }
    .meta span::before {
      content: '';
      display: inline-block;
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #cbd5e1;
      margin-right: 6px;
      vertical-align: middle;
    }

    /* ── KPI Cards ──────────────────────────── */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .kpi {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      transition: box-shadow 0.2s;
    }
    .kpi:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
    .kpi-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 0.3rem;
    }
    .kpi-value {
      font-size: 1.85rem;
      font-weight: 700;
      color: #0f172a;
    }
    .kpi-unit { font-size: 0.8rem; font-weight: 400; color: #94a3b8; }
    .kpi-value.success { color: #16a34a; }
    .kpi-value.danger { color: #dc2626; }
    .kpi-value.warning { color: #d97706; }

    /* ── Section ────────────────────────────── */
    .section { margin-bottom: 2rem; }
    .section-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #334155;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #f1f5f9;
    }

    /* ── Tables ──────────────────────────────── */
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      font-size: 0.85rem;
    }
    th {
      background: #f8fafc;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-size: 0.7rem;
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    td {
      padding: 0.7rem 1rem;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafbfd; }
    .errors-cell { max-width: 280px; word-break: break-all; }

    /* ── Badges ──────────────────────────────── */
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.3px;
    }
    .badge-success { background: #dcfce7; color: #15803d; }
    .badge-info { background: #dbeafe; color: #1d4ed8; }
    .badge-warn { background: #fef3c7; color: #b45309; }
    .badge-error { background: #fee2e2; color: #dc2626; }

    .rate-pill {
      display: inline-block;
      padding: 2px 12px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .rate-good { background: #dcfce7; color: #15803d; }
    .rate-bad { background: #fee2e2; color: #dc2626; }

    /* ── Charts ──────────────────────────────── */
    .chart-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin-bottom: 2rem;
    }
    @media (max-width: 768px) { .chart-grid { grid-template-columns: 1fr; } }
    .chart-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 1.25rem;
    }
    .chart-card h3 {
      font-size: 0.8rem;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 1rem;
    }
    .chart-wrap { position: relative; height: 250px; }

    .full-width { grid-column: 1 / -1; }

    /* ── Response Time Grid ──────────────────── */
    .rt-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 0.75rem;
    }
    .rt-item {
      text-align: center;
      background: #f8fafc;
      border-radius: 10px;
      padding: 1rem 0.5rem;
    }
    .rt-item .rt-label { font-size: 0.7rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
    .rt-item .rt-val { font-size: 1.35rem; font-weight: 700; color: #0f172a; margin-top: 0.25rem; }
    .rt-item .rt-unit { font-size: 0.7rem; color: #94a3b8; }

    /* ── No-errors state ────────────────────── */
    .empty-state {
      text-align: center;
      padding: 2rem;
      color: #94a3b8;
      font-size: 0.9rem;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
    }
    .empty-state .icon { font-size: 2rem; margin-bottom: 0.5rem; }

    /* ── Animation ──────────────────────────── */
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .kpi, .chart-card, .section table, .empty-state, .rt-grid { animation: fadeIn 0.5s ease-out backwards; }
    .kpi:nth-child(1) { animation-delay: 0.05s; }
    .kpi:nth-child(2) { animation-delay: 0.1s; }
    .kpi:nth-child(3) { animation-delay: 0.15s; }
    .kpi:nth-child(4) { animation-delay: 0.2s; }
    .kpi:nth-child(5) { animation-delay: 0.25s; }
    .kpi:nth-child(6) { animation-delay: 0.3s; }
  </style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <header>
    <h1>GradeMeAI - Load Test Report</h1>
    <div class="meta">
      <span>${testDate}</span>
      <span>Duration: ${durationStr}</span>
      <span>Target: ${data.aggregate.counters ? process.env.SERVER_URL : 'Unknown'}</span>
    </div>
  </header>

  <!-- KPI Cards -->
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Total Requests</div>
      <div class="kpi-value">${totalRequests.toLocaleString()}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Success Rate</div>
      <div class="kpi-value ${parseFloat(successRate) >= 95 ? 'success' : (parseFloat(successRate) >= 50 ? 'warning' : 'danger')}">${successRate}%</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Avg Response</div>
      <div class="kpi-value">${fmt(rt.mean)} <span class="kpi-unit">ms</span></div>
    </div>
    <div class="kpi">
      <div class="kpi-label">VUs Created</div>
      <div class="kpi-value">${vusCreated.toLocaleString()}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Completed</div>
      <div class="kpi-value success">${vusCompleted.toLocaleString()}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Failed</div>
      <div class="kpi-value ${vusFailed > 0 ? 'danger' : ''}">${vusFailed.toLocaleString()}</div>
    </div>
  </div>

  <!-- Response Time Breakdown -->
  <div class="section">
    <div class="section-title">Response Time Distribution</div>
    <div class="rt-grid">
      <div class="rt-item"><div class="rt-label">Min</div><div class="rt-val">${fmt(rt.min)}</div><div class="rt-unit">ms</div></div>
      <div class="rt-item"><div class="rt-label">Median</div><div class="rt-val">${fmt(rt.median)}</div><div class="rt-unit">ms</div></div>
      <div class="rt-item"><div class="rt-label">Mean</div><div class="rt-val">${fmt(rt.mean)}</div><div class="rt-unit">ms</div></div>
      <div class="rt-item"><div class="rt-label">P75</div><div class="rt-val">${fmt(rt.p75)}</div><div class="rt-unit">ms</div></div>
      <div class="rt-item"><div class="rt-label">P90</div><div class="rt-val">${fmt(rt.p90)}</div><div class="rt-unit">ms</div></div>
      <div class="rt-item"><div class="rt-label">P95</div><div class="rt-val">${fmt(rt.p95)}</div><div class="rt-unit">ms</div></div>
      <div class="rt-item"><div class="rt-label">P99</div><div class="rt-val">${fmt(rt.p99)}</div><div class="rt-unit">ms</div></div>
      <div class="rt-item"><div class="rt-label">Max</div><div class="rt-val">${fmt(rt.max)}</div><div class="rt-unit">ms</div></div>
    </div>
  </div>

  <!-- Charts -->
  <div class="chart-grid">
    <div class="chart-card">
      <h3>Response Times</h3>
      <div class="chart-wrap"><canvas id="rtChart"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>Request Outcome</h3>
      <div class="chart-wrap"><canvas id="outcomeChart"></canvas></div>
    </div>
    ${timelineLabels.length > 1 ? `
    <div class="chart-card full-width">
      <h3>Response Time Over Time</h3>
      <div class="chart-wrap"><canvas id="timelineChart"></canvas></div>
    </div>
    <div class="chart-card full-width">
      <h3>Throughput Over Time (per 10s window)</h3>
      <div class="chart-wrap"><canvas id="throughputChart"></canvas></div>
    </div>` : ''}
  </div>

  <!-- Status Codes -->
  <div class="section">
    <div class="section-title">HTTP Status Codes</div>
    ${Object.keys(statusCodes).length > 0 ? `
    <table>
      <thead><tr><th>Status Code</th><th>Count</th><th>% of Total</th></tr></thead>
      <tbody>${statusCodeRows}</tbody>
    </table>` : '<div class="empty-state"><div class="icon">📭</div>No HTTP responses received</div>'}
  </div>

  <!-- Errors -->
  <div class="section">
    <div class="section-title">Errors</div>
    ${errorRows.length > 0 ? `
    <table>
      <thead><tr><th>Error Type</th><th>Count</th><th>% of Total Requests</th></tr></thead>
      <tbody>${errorRows}</tbody>
    </table>` : '<div class="empty-state"><div class="icon">✅</div>No errors recorded — all requests succeeded!</div>'}
  </div>

  <!-- Per-Endpoint -->
  <div class="section">
    <div class="section-title">Per-Endpoint Breakdown</div>
    ${Object.keys(endpoints).length > 0 ? `
    <div style="overflow-x:auto;">
    <table>
      <thead><tr><th>Endpoint</th><th>Status Codes</th><th>Errors</th><th>Mean RT</th><th>P95 RT</th><th>Success Rate</th></tr></thead>
      <tbody>${endpointRows}</tbody>
    </table>
    </div>` : '<div class="empty-state"><div class="icon">📊</div>No per-endpoint data available</div>'}
  </div>

  <!-- Detailed Error Logs -->
  ${detailedErrorRows.length > 0 ? 
  '<div class="section" style="margin-top: 3rem;">' +
    '<div class="section-title" style="color: #dc2626; border-bottom-color: #fee2e2;">Detailed Error Logs (Latest 100)</div>' +
    '<div style="overflow-x:auto;">' +
    '<table>' +
      '<thead><tr><th>Time</th><th>User Email</th><th>Status</th><th>Response Body / Error</th></tr></thead>' +
      '<tbody>' + detailedErrorRows + '</tbody>' +
    '</table>' +
    '</div>' +
  '</div>' : ''}

</div>

<script>
  Chart.defaults.font.family = 'Inter';
  Chart.defaults.color = '#64748b';

  // Response Time Bar
  new Chart(document.getElementById('rtChart'), {
    type: 'bar',
    data: {
      labels: ['Min', 'Mean', 'P95', 'P99', 'Max'],
      datasets: [{
        data: [${[rt.min, rt.mean, rt.p95, rt.p99, rt.max].map(v => v !== undefined ? v.toFixed(1) : 0).join(',')}],
        backgroundColor: ['#86efac','#93c5fd','#fcd34d','#fca5a5','#f87171'],
        borderRadius: 6,
        barPercentage: 0.6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { callback: v => v + ' ms' } },
        x: { grid: { display: false } }
      }
    }
  });

  // Outcome Doughnut
  new Chart(document.getElementById('outcomeChart'), {
    type: 'doughnut',
    data: {
      labels: ['Success (2xx)', 'Failed / Errors'],
      datasets: [{
        data: [${successCount}, ${totalFailed}],
        backgroundColor: ['#86efac','#fca5a5'],
        borderColor: ['#fff','#fff'],
        borderWidth: 3,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, pointStyle: 'circle' } }
      }
    }
  });

  ${timelineLabels.length > 1 ? `
  // Response Time Timeline
  new Chart(document.getElementById('timelineChart'), {
    type: 'line',
    data: {
      labels: ${JSON.stringify(timelineLabels)},
      datasets: [
        { label: 'Mean', data: ${JSON.stringify(timelineMean)}, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', fill: true, tension: 0.3, pointRadius: 2 },
        { label: 'P95', data: ${JSON.stringify(timelineP95)}, borderColor: '#f59e0b', backgroundColor: 'transparent', borderDash: [5,3], tension: 0.3, pointRadius: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle' } } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { callback: v => v + ' ms' } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }
      }
    }
  });

  // Throughput Timeline
  new Chart(document.getElementById('throughputChart'), {
    type: 'bar',
    data: {
      labels: ${JSON.stringify(timelineLabels)},
      datasets: [
        { label: 'Success', data: ${JSON.stringify(timelineSuccessPerPeriod)}, backgroundColor: '#86efac', borderRadius: 4 },
        { label: 'Failed', data: ${JSON.stringify(timelineFailPerPeriod)}, backgroundColor: '#fca5a5', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle' } } },
      scales: {
        y: { beginAtZero: true, stacked: true, grid: { color: '#f1f5f9' } },
        x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 12 } }
      }
    }
  });` : ''}
</script>
</body>
</html>`;

fs.writeFileSync(htmlPath, html);
console.log(`\n✨ Report generated → ${htmlPath}`);
console.log(`🚀 Open it in your browser!\n`);
