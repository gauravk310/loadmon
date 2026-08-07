import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { API } from '../api.js'

export default function DataManager() {
  const [activeTab, setActiveTab]     = useState('authenticated') // 'authenticated' | 'uploaded'
  const [dragging, setDragging]       = useState(false)
  const [preview, setPreview]         = useState(null)
  const [baseSessions, setBaseSessions] = useState(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [message, setMessage]         = useState(null)
  const [error, setError]             = useState(null)
  const [searchTerm, setSearchTerm]   = useState('')
  const [inspectSession, setInspectSession] = useState(null)

  const fileInputRef = useRef(null)

  // Load existing uploaded preview on mount
  useEffect(() => {
    fetch(`${API}/upload/preview`)
      .then(r => r.json())
      .then(d => { if (d.success && d.exists) setPreview(d) })
      .catch(() => {})
  }, [])

  // Load base user sessions on mount
  const fetchBaseSessions = useCallback(() => {
    setLoadingSessions(true)
    fetch(`${API}/config/base-sessions`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.exists) {
          setBaseSessions(d)
        } else {
          setBaseSessions(null)
        }
      })
      .catch(() => setBaseSessions(null))
      .finally(() => setLoadingSessions(false))
  }, [])

  useEffect(() => {
    fetchBaseSessions()
  }, [fetchBaseSessions])

  const processFile = async (file) => {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['xlsx', 'xls', 'json'].includes(ext)) {
      setError('Only .xlsx, .xls, or .json files are supported.')
      return
    }

    setLoading(true)
    setError(null)
    setMessage(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const endpoint = ext === 'json' ? '/upload/json' : '/upload/excel'
      const res = await fetch(`${API}${endpoint}`, { method: 'POST', body: formData })
      const data = await res.json()

      if (data.success) {
        setPreview(data)
        setMessage(`✅ ${data.message}`)
        setActiveTab('uploaded')
      } else {
        setError(data.error)
      }
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    processFile(file)
  }, [])

  const handleDragOver = (e) => { e.preventDefault(); setDragging(true) }
  const handleDragLeave = () => setDragging(false)

  const handleFileSelect = (e) => {
    processFile(e.target.files[0])
    e.target.value = ''
  }

  const handleClearUploaded = async () => {
    if (!confirm('Clear the current uploaded dataset?')) return
    await fetch(`${API}/upload/clear`, { method: 'DELETE' })
    setPreview(null)
    setMessage('Uploaded dataset cleared.')
  }

  // Filter base sessions by search term
  const filteredSessions = useMemo(() => {
    if (!baseSessions || !Array.isArray(baseSessions.sessions)) return []
    if (!searchTerm.trim()) return baseSessions.sessions

    const term = searchTerm.toLowerCase()
    return baseSessions.sessions.filter(sess => {
      if (!sess || typeof sess !== 'object') return false
      const emailStr = String(sess.email || sess['user.email'] || sess.user?.email || '').toLowerCase()
      const idStr = String(sess['user.id'] || sess.id || sess._id || sess.studentId || '').toLowerCase()
      const cookieStr = String(sess.authCookie || sess.token || sess.authorization || '').toLowerCase()
      return emailStr.includes(term) || idStr.includes(term) || cookieStr.includes(term)
    })
  }, [baseSessions, searchTerm])

  return (
    <div className="page-wrapper animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Data Manager</h1>
          <p className="page-subtitle">View authenticated base user sessions &amp; manage custom virtual user datasets</p>
        </div>
        {preview && activeTab === 'uploaded' && (
          <button id="btn-clear-data" className="btn btn-ghost" onClick={handleClearUploaded}>
            🗑 Clear Uploaded Data
          </button>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 mb-3 border-b border-border pb-2">
        <button
          type="button"
          className={`btn btn-sm ${activeTab === 'authenticated' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('authenticated')}
          style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          🔐 Authenticated User Sessions
          {baseSessions?.rowCount > 0 && (
            <span className="badge badge-accent" style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
              {baseSessions.rowCount}
            </span>
          )}
        </button>

        <button
          type="button"
          className={`btn btn-sm ${activeTab === 'uploaded' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('uploaded')}
          style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          📂 Uploaded Dataset
          {preview?.rowCount > 0 && (
            <span className="badge badge-accent" style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
              {preview.rowCount}
            </span>
          )}
        </button>
      </div>

      {/* Messages */}
      {message && (
        <div className="card card-p mb-2" style={{ borderColor: 'var(--success)', background: 'var(--success-dim)', color: 'var(--success)' }}>
          {message}
        </div>
      )}
      {error && (
        <div className="card card-p mb-2" style={{ borderColor: 'var(--danger)', background: 'var(--danger-dim)', color: 'var(--danger)' }}>
          ❌ {error}
        </div>
      )}

      {/* ── TAB 1: Authenticated User Sessions ────────────────────────────── */}
      {activeTab === 'authenticated' && (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card card-p" style={{ background: 'var(--bg-card)' }}>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
              <div>
                <h3 style={{ color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🔑 Base Config Pre-Authenticated Users
                </h3>
                <p className="text-sm text-muted">
                  Saved user sessions, cookies, tokens, and response variables captured from Base API Chain execution.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={fetchBaseSessions}
                  disabled={loadingSessions}
                  title="Refresh Sessions"
                >
                  🔄 {loadingSessions ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>

            {baseSessions && baseSessions.rowCount > 0 ? (
              <div className="flex items-center justify-between flex-wrap gap-2 mt-2 pt-2 border-t border-border">
                <input
                  type="text"
                  className="form-input"
                  style={{ maxWidth: '320px', fontSize: '0.82rem' }}
                  placeholder="🔍 Search by email, user ID, or cookie..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
                <span className="text-xs text-muted">
                  Showing {filteredSessions.length} of {baseSessions.rowCount} sessions
                  {baseSessions.preparedAt && ` · Authenticated at ${new Date(baseSessions.preparedAt).toLocaleTimeString()}`}
                </span>
              </div>
            ) : null}
          </div>

          {baseSessions && baseSessions.rowCount > 0 ? (
            <div className="card animate-fade-up">
              <div className="table-wrap" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', zIndex: 5 }}>
                    <tr>
                      <th style={{ width: '45px' }}>#</th>
                      <th>User Account / Email</th>
                      <th>User ID (`user.id`)</th>
                      <th>Auth Cookie / Token</th>
                      <th>Captured IDs &amp; Variables</th>
                      <th style={{ width: '90px', textAlign: 'center' }}>Inspect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSessions.map((session, idx) => {
                      const email = session.email || session['user.email'] || session.user?.email || `User #${idx + 1}`
                      const userId = session['user.id'] || session.id || session._id || session.user?.id || '—'
                      const cookieOrToken = session.authCookie || session.token || session.authorization || session.access_token || '—'

                      const isAuthKey = k => /token|cookie|auth|email|password/i.test(k)
                      const extraKeys = Object.keys(session).filter(k => !isAuthKey(k) && !k.startsWith('[0].') && k !== 'user' && k !== 'class' && k !== 'course' && k !== 'period')

                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                            {idx + 1}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                              {email}
                            </div>
                            {session.user?.firstName && (
                              <div className="text-xs text-muted">
                                {session.user.firstName} {session.user.lastName || ''}
                              </div>
                            )}
                          </td>
                          <td className="mono" style={{ fontSize: '0.78rem', color: 'var(--cyan)' }}>
                            {userId}
                          </td>
                          <td style={{ maxWidth: '280px' }}>
                            {cookieOrToken !== '—' ? (
                              <span
                                className="mono"
                                style={{
                                  fontSize: '0.72rem',
                                  background: 'rgba(99,102,241,0.1)',
                                  color: 'var(--accent-light)',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  display: 'inline-block',
                                  maxWidth: '260px',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis'
                                }}
                                title={String(cookieOrToken)}
                              >
                                {String(cookieOrToken)}
                              </span>
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', maxWidth: '300px' }}>
                              {session.classId && (
                                <span className="badge badge-accent mono" style={{ fontSize: '0.68rem' }}>
                                  classId: {String(session.classId).slice(-6)}
                                </span>
                              )}
                              {session.testId && (
                                <span className="badge badge-accent mono" style={{ fontSize: '0.68rem' }}>
                                  testId: {String(session.testId).slice(-6)}
                                </span>
                              )}
                              {extraKeys.slice(0, 3).map(k => (
                                <span key={k} className="badge mono text-muted" style={{ fontSize: '0.68rem', background: 'rgba(255,255,255,0.05)' }}>
                                  {k}
                                </span>
                              ))}
                              {extraKeys.length > 3 && (
                                <span className="text-xs text-muted">+{extraKeys.length - 3} more</span>
                              )}
                            </div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              style={{ color: 'var(--accent-light)' }}
                              onClick={() => setInspectSession({ index: idx + 1, data: session })}
                            >
                              🔍 View
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="empty-state">
                <div className="empty-icon">🔐</div>
                <div className="empty-title">No Authenticated Sessions Saved</div>
                <div className="empty-desc">
                  Go to <strong style={{ color: 'var(--accent-light)' }}>Configure &gt; Base API Configuration Chain</strong> and click ⚡ <strong>Run &amp; Save Data</strong> to pre-authenticate users and capture response data.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: Uploaded Dataset ────────────────────────────────────────── */}
      {activeTab === 'uploaded' && (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Drop zone */}
          <div
            id="drop-zone"
            className={`drop-zone mb-2 ${dragging ? 'drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="drop-icon">{loading ? '⏳' : '📂'}</div>
            <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
              {loading ? 'Processing file…' : 'Drop your data file here'}
            </h3>
            <p className="text-sm text-muted">
              Supports <strong style={{ color: 'var(--accent-light)' }}>.xlsx</strong> (auto-converts to JSON) and{' '}
              <strong style={{ color: 'var(--accent-light)' }}>.json</strong> files
            </p>
            <button className="btn btn-primary mt-2" style={{ marginTop: '1rem' }} onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}>
              Choose File
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.json" onChange={handleFileSelect} style={{ display: 'none' }} />
          </div>

          {/* Format help */}
          <div className="grid-2 mb-2">
            <div className="card card-p">
              <h4 style={{ marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>📊 Excel Format</h4>
              <p className="text-sm text-muted mb-2">
                First row must be column headers. Each subsequent row is one virtual user.
              </p>
              <table style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th>email</th>
                    <th>password</th>
                    <th>any_other_field</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td style={{ color: 'var(--text-secondary)' }}>user1@app.com</td><td style={{ color: 'var(--text-secondary)' }}>pass123</td><td style={{ color: 'var(--text-secondary)' }}>value</td></tr>
                  <tr><td style={{ color: 'var(--text-secondary)' }}>user2@app.com</td><td style={{ color: 'var(--text-secondary)' }}>pass456</td><td style={{ color: 'var(--text-secondary)' }}>value</td></tr>
                </tbody>
              </table>
            </div>

            <div className="card card-p">
              <h4 style={{ marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>🗂 JSON Format</h4>
              <p className="text-sm text-muted mb-2">
                Must be an array of objects. All keys become available as template variables.
              </p>
              <pre className="mono" style={{ fontSize: '0.78rem', color: 'var(--accent-light)', background: 'var(--bg-base)', padding: '0.75rem', borderRadius: 'var(--radius-md)', overflow: 'auto' }}>
{`[
  { "email": "u1@app.com",
    "password": "pass1" },
  { "email": "u2@app.com",
    "password": "pass2" }
]`}
              </pre>
            </div>
          </div>

          {/* Data preview */}
          {preview ? (
            <div className="card animate-fade-up">
              <div className="card-header">
                <div>
                  <h3>📋 Loaded Dataset</h3>
                  <p className="text-xs text-muted mt-1">
                    {preview.rowCount.toLocaleString()} rows · {preview.columns?.length} columns
                  </p>
                </div>
                <div className="flex gap-1">
                  {preview.columns?.map(col => (
                    <span key={col} className="badge badge-accent">{col}</span>
                  ))}
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      {preview.columns?.map(col => <th key={col}>{col}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview?.map((row, i) => (
                      <tr key={i}>
                        <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                          {i + 1}
                        </td>
                        {preview.columns?.map(col => (
                          <td key={col} className="mono" style={{ fontSize: '0.8rem' }}>
                            {row[col] !== undefined ? String(row[col]) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rowCount > 20 && (
                <p className="text-xs text-muted" style={{ padding: '0.75rem 1rem' }}>
                  Showing first 20 of {preview.rowCount.toLocaleString()} rows
                </p>
              )}
            </div>
          ) : !loading && (
            <div className="card">
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <div className="empty-title">No Custom File Dataset Loaded</div>
                <div className="empty-desc">Upload an Excel or JSON file to use custom user credentials in your load tests.</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Modal to Inspect Session ────────────────────────────────────── */}
      {inspectSession && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
          }}
          onClick={() => setInspectSession(null)}
        >
          <div
            className="card card-p animate-fade-in"
            style={{ width: '100%', maxWidth: '650px', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-border">
              <div>
                <h3 style={{ color: 'var(--accent-light)' }}>
                  🔍 User Session Context #{inspectSession.index}
                </h3>
                <p className="text-xs text-muted mt-1">
                  {inspectSession.data?.email || inspectSession.data?.['user.email'] || 'Authenticated Session'}
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setInspectSession(null)}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <pre
                className="mono"
                style={{
                  fontSize: '0.78rem',
                  background: 'var(--bg-base)',
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}
              >
                {JSON.stringify(inspectSession.data, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
