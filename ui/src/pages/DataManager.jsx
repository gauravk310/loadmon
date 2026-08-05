import { useState, useEffect, useRef, useCallback } from 'react'

const API = '/api'

export default function DataManager() {
  const [dragging, setDragging]   = useState(false)
  const [preview,  setPreview]    = useState(null)
  const [loading,  setLoading]    = useState(false)
  const [message,  setMessage]    = useState(null)
  const [error,    setError]      = useState(null)
  const fileInputRef = useRef(null)

  // Load existing preview on mount
  useEffect(() => {
    fetch(`${API}/upload/preview`)
      .then(r => r.json())
      .then(d => { if (d.success && d.exists) setPreview(d) })
      .catch(() => {})
  }, [])

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

  const handleClear = async () => {
    if (!confirm('Clear the current dataset?')) return
    await fetch(`${API}/upload/clear`, { method: 'DELETE' })
    setPreview(null)
    setMessage('Dataset cleared.')
  }

  return (
    <div className="page-wrapper animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Data Manager</h1>
          <p className="page-subtitle">Upload test data (Excel or JSON) to use as virtual user credentials</p>
        </div>
        {preview && (
          <button id="btn-clear-data" className="btn btn-ghost" onClick={handleClear}>
            🗑 Clear Data
          </button>
        )}
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

      {/* Drop zone */}
      <div
        id="drop-zone"
        className={`drop-zone mb-3 ${dragging ? 'drag-over' : ''}`}
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
      <div className="grid-2 mb-3">
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
      {preview && (
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
      )}

      {!preview && !loading && (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <div className="empty-title">No data loaded</div>
            <div className="empty-desc">Upload an Excel or JSON file to get started. Each row becomes a virtual user in the load test.</div>
          </div>
        </div>
      )}
    </div>
  )
}
