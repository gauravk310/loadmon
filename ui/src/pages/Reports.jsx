import { useState, useEffect, useMemo } from 'react'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js'

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title, Tooltip, Legend, Filler
)

import { API } from '../api.js'

const CHART_BASE = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#64748b', usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'rgba(13,17,23,0.95)',
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      titleColor: '#f1f5f9',
      bodyColor: '#94a3b8',
      padding: 12,
    }
  },
  scales: {
    x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 10 } } },
    y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 10 } }, beginAtZero: true }
  }
}

function fmt(v) { return v !== undefined && v !== null ? Math.round(v) : 'N/A' }

function statusBadgeClass(code) {
  if (String(code).startsWith('2')) return 'badge-success'
  if (String(code).startsWith('3')) return 'badge-cyan'
  if (String(code).startsWith('4')) return 'badge-warning'
  return 'badge-danger'
}

export default function Reports() {
  const [data, setData]     = useState(null)
  const [errors, setErrors] = useState([])
  const [loading, setLoading] = useState(true)
  const [noData, setNoData] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`${API}/results`).then(r => r.json()),
      fetch(`${API}/results/errors`).then(r => r.json()),
    ]).then(([res, errRes]) => {
      if (res.success && res.exists) {
        setData(res.data)
      } else {
        setNoData(true)
      }
      if (errRes.success) setErrors(errRes.errors || [])
      setLoading(false)
    }).catch(() => { setLoading(false); setNoData(true) })
  }, [])

  const handleRefresh = () => {
    setLoading(true)
    setData(null)
    setNoData(false)
    Promise.all([
      fetch(`${API}/results`).then(r => r.json()),
      fetch(`${API}/results/errors`).then(r => r.json()),
    ]).then(([res, errRes]) => {
      if (res.success && res.exists) setData(res.data)
      else setNoData(true)
      if (errRes.success) setErrors(errRes.errors || [])
      setLoading(false)
    })
  }

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `loadmon-results-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="page-wrapper">
        <div className="empty-state">
          <div className="empty-icon">⏳</div>
          <div className="empty-title">Loading results…</div>
        </div>
      </div>
    )
  }

  if (noData || !data) {
    return (
      <div className="page-wrapper animate-fade-in">
        <div className="page-header">
          <div>
            <h1 className="page-title">Reports</h1>
            <p className="page-subtitle">Last test run analysis</p>
          </div>
          <button className="btn btn-ghost" onClick={handleRefresh}>🔄 Refresh</button>
        </div>
        <div className="card">
          <div className="empty-state" style={{ padding: '4rem' }}>
            <div className="empty-icon">📊</div>
            <div className="empty-title">No results yet</div>
            <div className="empty-desc">Run a load test from the Dashboard to generate a report.</div>
          </div>
        </div>
      </div>
    )
  }

  const agg = data.aggregate || {}
  const counters = agg.counters || {}
  const summaries = agg.summaries || {}
  const intermediate = data.intermediate || []

  // Core metrics
  const totalRequests  = counters['http.requests'] || 0
  const totalResponses = counters['http.responses'] || 0
  const vusFailed      = counters['vusers.failed'] || 0
  const vusCompleted   = counters['vusers.completed'] || 0
  const vusCreated     = counters['vusers.created'] || 0

  // Status codes
  const statusCodes = {}
  Object.keys(counters).forEach(k => {
    const m = k.match(/^http\.codes\.(\d+)$/)
    if (m) statusCodes[m[1]] = counters[k]
  })

  const success2xx = Object.entries(statusCodes)
    .filter(([c]) => c.startsWith('2'))
    .reduce((s, [, v]) => s + v, 0)
  const totalFailed = totalRequests - success2xx
  const successRate = totalRequests > 0 ? ((success2xx / totalRequests) * 100).toFixed(1) : '0.0'

  // Errors
  const errorCounters = {}
  Object.keys(counters).forEach(k => {
    const m = k.match(/^errors\.(.+)$/)
    if (m) errorCounters[m[1]] = counters[k]
  })

  // Response times
  const rt = summaries['http.response_time'] || {}

  // Timeline
  const timelineLabels = []
  const timelineMean = []
  const timelineP95 = []
  const timelineSuccess = []
  const timelineFail = []

  intermediate.forEach(entry => {
    const d = new Date(parseInt(entry.period))
    timelineLabels.push(d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    const ert = (entry.summaries?.['http.response_time']) || {}
    timelineMean.push(ert.mean != null ? Math.round(ert.mean) : null)
    timelineP95.push(ert.p95 != null ? Math.round(ert.p95) : null)
    const ec = entry.counters || {}
    timelineSuccess.push(Object.keys(ec).filter(k => k.match(/^http\.codes\.2/)).reduce((s,k)=>s+ec[k],0))
    timelineFail.push(ec['vusers.failed'] || 0)
  })

  // Duration
  let durationStr = 'N/A'
  if (agg.firstMetricAt && agg.lastMetricAt) {
    const secs = Math.round((agg.lastMetricAt - agg.firstMetricAt) / 1000)
    durationStr = secs >= 60 ? `${Math.floor(secs/60)}m ${secs%60}s` : `${secs}s`
  }

  const testDate = agg.firstMetricAt
    ? new Date(agg.firstMetricAt).toLocaleString()
    : 'Unknown'

  return (
    <div className="page-wrapper animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">
            {testDate} · Duration: {durationStr}
          </p>
        </div>
        <div className="flex gap-1">
          <button className="btn btn-ghost" onClick={handleRefresh}>🔄 Refresh</button>
          <button id="btn-download-results" className="btn btn-primary" onClick={handleDownload}>⬇ Download JSON</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="metric-grid mb-3 stagger">
        <MetricCard label="Total Requests" value={totalRequests.toLocaleString()} color="default" />
        <MetricCard label="Success Rate"
          value={`${successRate}%`}
          color={parseFloat(successRate) >= 95 ? 'success' : parseFloat(successRate) >= 50 ? 'warning' : 'danger'} />
        <MetricCard label="VUs Created"   value={vusCreated.toLocaleString()}   color="accent" />
        <MetricCard label="VUs Completed" value={vusCompleted.toLocaleString()} color="success" />
        <MetricCard label="VUs Failed"    value={vusFailed.toLocaleString()}    color={vusFailed > 0 ? 'danger' : 'default'} />
        <MetricCard label="Avg Response"  value={fmt(rt.mean)}  unit="ms" color="cyan" />
      </div>

      {/* Response Time Breakdown */}
      <div className="card card-p mb-3">
        <div className="section-title mb-2">Response Time Distribution</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.75rem' }}>
          {[
            ['Min',    rt.min],
            ['Median', rt.median],
            ['Mean',   rt.mean],
            ['P75',    rt.p75],
            ['P90',    rt.p90],
            ['P95',    rt.p95],
            ['P99',    rt.p99],
            ['Max',    rt.max],
          ].map(([label, val]) => (
            <div key={label} style={{
              textAlign: 'center',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-md)',
              padding: '0.85rem 0.5rem',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)' }}>{fmt(val)}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>ms</div>
            </div>
          ))}
        </div>
      </div>

      {/* Charts row */}
      <div className="grid-2 mb-3">
        <div className="card" style={{ padding: '1.25rem' }}>
          <div className="section-title mb-2">Response Times</div>
          <div style={{ height: 200 }}>
            <Bar
              data={{
                labels: ['Min', 'Mean', 'P95', 'P99', 'Max'],
                datasets: [{
                  data: [rt.min, rt.mean, rt.p95, rt.p99, rt.max].map(v => v != null ? parseFloat(v.toFixed(1)) : 0),
                  backgroundColor: ['#86efac','#93c5fd','#fcd34d','#fca5a5','#f87171'],
                  borderRadius: 6,
                  barPercentage: 0.6,
                }]
              }}
              options={{ ...CHART_BASE, plugins: { ...CHART_BASE.plugins, legend: { display: false } }, scales: { ...CHART_BASE.scales, y: { ...CHART_BASE.scales.y, ticks: { ...CHART_BASE.scales.y.ticks, callback: v => v + ' ms' } } } }}
            />
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <div className="section-title mb-2">Request Outcome</div>
          <div style={{ height: 200 }}>
            <Doughnut
              data={{
                labels: ['Success (2xx)', 'Failed / Errors'],
                datasets: [{
                  data: [success2xx, totalFailed],
                  backgroundColor: ['rgba(16,185,129,0.8)', 'rgba(239,68,68,0.8)'],
                  borderColor: ['var(--bg-base)', 'var(--bg-base)'],
                  borderWidth: 3,
                  hoverOffset: 6,
                }]
              }}
              options={{
                responsive: true, maintainAspectRatio: false, cutout: '65%',
                plugins: {
                  legend: { position: 'bottom', labels: { color: '#64748b', padding: 16, usePointStyle: true, pointStyle: 'circle' } },
                  tooltip: CHART_BASE.plugins.tooltip,
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Timeline charts */}
      {timelineLabels.length > 1 && (
        <>
          <div className="card mb-3" style={{ padding: '1.25rem' }}>
            <div className="section-title mb-2">Response Time Over Time</div>
            <div style={{ height: 220 }}>
              <Line
                data={{
                  labels: timelineLabels,
                  datasets: [
                    { label: 'Mean', data: timelineMean, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.08)', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 },
                    { label: 'P95', data: timelineP95, borderColor: '#f59e0b', backgroundColor: 'transparent', borderDash: [5,3], tension: 0.3, pointRadius: 0, borderWidth: 2 },
                  ]
                }}
                options={{ ...CHART_BASE, scales: { ...CHART_BASE.scales, y: { ...CHART_BASE.scales.y, ticks: { ...CHART_BASE.scales.y.ticks, callback: v => v + ' ms' } } } }}
              />
            </div>
          </div>

          <div className="card mb-3" style={{ padding: '1.25rem' }}>
            <div className="section-title mb-2">Throughput Over Time</div>
            <div style={{ height: 220 }}>
              <Bar
                data={{
                  labels: timelineLabels,
                  datasets: [
                    { label: 'Success', data: timelineSuccess, backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 3 },
                    { label: 'Failed',  data: timelineFail,   backgroundColor: 'rgba(239,68,68,0.7)',   borderRadius: 3 },
                  ]
                }}
                options={{ ...CHART_BASE, scales: { ...CHART_BASE.scales, x: { ...CHART_BASE.scales.x, stacked: true }, y: { ...CHART_BASE.scales.y, stacked: true } } }}
              />
            </div>
          </div>
        </>
      )}

      {/* Status Codes */}
      <div className="card mb-3">
        <div className="card-header"><h3>HTTP Status Codes</h3></div>
        {Object.keys(statusCodes).length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Status</th><th>Count</th><th>% of Total</th></tr></thead>
              <tbody>
                {Object.entries(statusCodes).sort(([a],[b]) => a-b).map(([code, count]) => (
                  <tr key={code}>
                    <td><span className={`badge ${statusBadgeClass(code)}`}>{code}</span></td>
                    <td className="mono">{count.toLocaleString()}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{totalRequests > 0 ? (count/totalRequests*100).toFixed(1) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state"><div className="empty-icon">📭</div><div className="empty-desc">No HTTP responses</div></div>
        )}
      </div>

      {/* Errors */}
      {Object.keys(errorCounters).length > 0 && (
        <div className="card mb-3">
          <div className="card-header"><h3 style={{ color: 'var(--danger)' }}>Errors</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Error Type</th><th>Count</th><th>% of Requests</th></tr></thead>
              <tbody>
                {Object.entries(errorCounters).sort(([,a],[,b]) => b-a).map(([name, count]) => (
                  <tr key={name}>
                    <td><code className="mono" style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>{name}</code></td>
                    <td className="mono">{count.toLocaleString()}</td>
                    <td>{totalRequests > 0 ? (count/totalRequests*100).toFixed(1) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detailed error logs */}
      {errors.length > 0 && (
        <div className="card mb-3">
          <div className="card-header">
            <h3 style={{ color: 'var(--danger)' }}>Detailed Error Logs</h3>
            <span className="badge badge-danger">{errors.length} errors</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Status</th><th>Response / Error</th></tr></thead>
              <tbody>
                {errors.slice(-100).reverse().map((err, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                      {new Date(err.timestamp).toLocaleTimeString()}
                    </td>
                    <td><span className={`badge ${err.status >= 200 && err.status < 300 ? 'badge-success' : 'badge-danger'}`}>{err.status}</span></td>
                    <td style={{ maxWidth: 320, wordBreak: 'break-all', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{err.body}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {errors.length > 100 && (
            <p className="text-xs text-muted" style={{ padding: '0.75rem 1rem' }}>Showing latest 100 of {errors.length}</p>
          )}
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, unit, color = 'default' }) {
  return (
    <div className={`metric-card animate-fade-up ${color}`}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${color}`}>
        {value}
        {unit && <span className="metric-unit">{unit}</span>}
      </div>
    </div>
  )
}
