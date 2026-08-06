import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../context/AppContext.jsx'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function flattenObjectKeys(obj, prefix = '') {
  const keys = []
  if (!obj || typeof obj !== 'object') return keys
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object') {
      keys.push(...flattenObjectKeys(obj[0], prefix))
    }
    return keys
  }
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    keys.push(fullKey)
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys.push(...flattenObjectKeys(v, fullKey))
    } else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      keys.push(...flattenObjectKeys(v[0], `${fullKey}[0]`))
    }
  }
  return keys
}

function newStep(index) {
  return {
    id: `step_${Date.now()}_${index}`,
    name: `Step ${index + 1}`,
    method: index === 0 ? 'POST' : 'GET',
    endpoint: '/api/',
    headers: index === 0 ? { 'Content-Type': 'application/json' } : {},
    body: '',
    think: 1,
    responseKeys: [],
    responseJson: null,
    runStatus: null, // null | 'running' | 'success' | 'error'
    runError: null,
    resolvedUrl: null,
  }
}

// ── Variable Autocomplete Dropdown ─────────────────────────
function VarDropdown({ suggestions, onSelect, onClose }) {
  useEffect(() => {
    const handler = () => onClose()
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  if (!suggestions.length) return null

  const authVars = suggestions.filter(s => s.isAuth)
  const dataVars = suggestions.filter(s => !s.isAuth)

  return (
    <div className="var-dropdown" onMouseDown={e => e.stopPropagation()}>
      <div className="var-dropdown-header">💡 Available Variables</div>
      {authVars.length > 0 && (
        <>
          <div style={{ padding: '4px 8px', fontSize: '0.68rem', fontWeight: 700, color: 'var(--success)', background: 'rgba(16,185,129,0.08)' }}>
            🔑 SESSION & AUTH TOKENS
          </div>
          {authVars.map((s, i) => (
            <div
              key={`auth-${i}`}
              className="var-dropdown-item"
              onMouseDown={() => { onSelect(s.key); onClose() }}
            >
              <span className="var-key" style={{ color: 'var(--success)' }}>{`{{${s.key}}}`}</span>
              <span className="var-source">← Step {s.stepNum}: {s.stepName}</span>
            </div>
          ))}
        </>
      )}

      {dataVars.length > 0 && (
        <>
          {authVars.length > 0 && (
            <div style={{ padding: '4px 8px', fontSize: '0.68rem', fontWeight: 700, color: 'var(--cyan)', background: 'rgba(34,211,238,0.08)' }}>
              📦 RESPONSE VARIABLES
            </div>
          )}
          {dataVars.map((s, i) => (
            <div
              key={`data-${i}`}
              className="var-dropdown-item"
              onMouseDown={() => { onSelect(s.key); onClose() }}
            >
              <span className="var-key">{`{{${s.key}}}`}</span>
              <span className="var-source">← Step {s.stepNum}: {s.stepName}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ── Smart Input with {{ autocomplete ──────────────────────
function SmartInput({ value, onChange, placeholder, style, allVarSuggestions, className }) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [filteredSuggestions, setFilteredSuggestions] = useState([])
  const inputRef = useRef(null)

  const handleChange = (e) => {
    const val = e.target.value
    onChange(val)
    // Check if we just typed {{
    const cursor = e.target.selectionStart
    const textBefore = val.substring(0, cursor)
    const match = textBefore.match(/\{\{([\w.]*)$/)
    if (match) {
      const typed = match[1].toLowerCase()
      const filtered = allVarSuggestions.filter(s =>
        s.key.toLowerCase().includes(typed)
      )
      setFilteredSuggestions(filtered)
      setShowDropdown(filtered.length > 0)
    } else {
      setShowDropdown(false)
    }
  }

  const handleSelect = (key) => {
    if (!inputRef.current) return
    const el = inputRef.current
    const cursor = el.selectionStart
    const textBefore = value.substring(0, cursor)
    const textAfter = value.substring(cursor)
    // Find the {{ opener before cursor
    const openIdx = textBefore.lastIndexOf('{{')
    if (openIdx === -1) return
    const newVal = value.substring(0, openIdx) + `{{${key}}}` + textAfter
    onChange(newVal)
    setShowDropdown(false)
  }

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <input
        ref={inputRef}
        className={className || 'form-input'}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        style={style}
      />
      {showDropdown && (
        <VarDropdown
          suggestions={filteredSuggestions}
          onSelect={handleSelect}
          onClose={() => setShowDropdown(false)}
        />
      )}
    </div>
  )
}

// ── Smart Textarea with {{ autocomplete ──────────────────
function SmartTextarea({ value, onChange, placeholder, rows, style, allVarSuggestions }) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [filteredSuggestions, setFilteredSuggestions] = useState([])
  const textareaRef = useRef(null)

  const handleChange = (e) => {
    const val = e.target.value
    onChange(val)
    const cursor = e.target.selectionStart
    const textBefore = val.substring(0, cursor)
    const match = textBefore.match(/\{\{([\w.]*)$/)
    if (match) {
      const typed = match[1].toLowerCase()
      const filtered = allVarSuggestions.filter(s => s.key.toLowerCase().includes(typed))
      setFilteredSuggestions(filtered)
      setShowDropdown(filtered.length > 0)
    } else {
      setShowDropdown(false)
    }
  }

  const handleSelect = (key) => {
    if (!textareaRef.current) return
    const el = textareaRef.current
    const cursor = el.selectionStart
    const textBefore = value.substring(0, cursor)
    const textAfter = value.substring(cursor)
    const openIdx = textBefore.lastIndexOf('{{')
    if (openIdx === -1) return
    const newVal = value.substring(0, openIdx) + `{{${key}}}` + textAfter
    onChange(newVal)
    setShowDropdown(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={textareaRef}
        className="form-textarea"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        rows={rows || 4}
        style={style}
      />
      {showDropdown && (
        <VarDropdown
          suggestions={filteredSuggestions}
          onSelect={handleSelect}
          onClose={() => setShowDropdown(false)}
        />
      )}
    </div>
  )
}

export default function ChainBuilder() {
  const { config, saveChain, deleteChain, chains, fetchChains, API } = useApp()

  const [chainName, setChainName] = useState('My API Chain')
  const [steps, setSteps] = useState([newStep(0)])
  const [expandedStepId, setExpandedStepId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [editingChainId, setEditingChainId] = useState(null)

  // Auto expand first step
  useEffect(() => {
    if (steps.length > 0 && !expandedStepId) {
      setExpandedStepId(steps[0].id)
    }
  }, [])

  // ── Always use the globally selected app from Configure page ──
  const selectedApp = config?.applications?.find(a => a.id === config?.selectedAppId) || config?.applications?.[0] || null
  const serverUrl = selectedApp?.serverUrl || config?.serverUrl || ''
  const appUrl = selectedApp?.appUrl || config?.appUrl || ''

  // ── Collect all variable suggestions from previous steps ──
  const getAllVarSuggestions = useCallback((upToStepIndex) => {
    const suggestions = []
    for (let i = 0; i < upToStepIndex; i++) {
      const step = steps[i]
      if (step.capturedData) {
        if (step.capturedData.cookies) {
          suggestions.push({ key: 'authCookie', stepNum: i + 1, stepName: step.name, isAuth: true })
        }
        if (step.capturedData.tokens?.access_token) {
          suggestions.push({ key: 'access_token', stepNum: i + 1, stepName: step.name, isAuth: true })
        }
        if (step.capturedData.tokens?.token) {
          suggestions.push({ key: 'token', stepNum: i + 1, stepName: step.name, isAuth: true })
        }
        if (step.capturedData.tokens?.authorization) {
          suggestions.push({ key: 'authorization', stepNum: i + 1, stepName: step.name, isAuth: true })
        }
      }
      if (step.responseKeys && step.responseKeys.length > 0) {
        step.responseKeys.forEach(key => {
          if (!suggestions.some(s => s.key === key)) {
            const isAuth = ['token', 'access_token', 'jwt', 'authCookie', 'authorization', 'bearerToken'].includes(key)
            suggestions.push({ key, stepNum: i + 1, stepName: step.name, isAuth })
          }
        })
      }
    }
    return suggestions
  }, [steps])

  // ── Step CRUD ─────────────────────────────────────────────
  const updateStep = (stepId, updates) => {
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, ...updates } : s))
  }

  const addStep = () => {
    const s = newStep(steps.length)
    setSteps(prev => [...prev, s])
    setExpandedStepId(s.id)
  }

  const removeStep = (stepId) => {
    if (steps.length <= 1) return
    setSteps(prev => {
      const filtered = prev.filter(s => s.id !== stepId)
      return filtered.map((s, i) => ({ ...s, name: s.name.match(/^Step \d+$/) ? `Step ${i + 1}` : s.name }))
    })
    if (expandedStepId === stepId) setExpandedStepId(null)
  }

  const moveStep = (stepId, dir) => {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.id === stepId)
      const target = idx + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const temp = next[idx]
      next[idx] = next[target]
      next[target] = temp
      return next
    })
  }

  const duplicateStep = (stepId) => {
    const src = steps.find(s => s.id === stepId)
    if (!src) return
    const dup = {
      ...JSON.parse(JSON.stringify(src)),
      id: `step_${Date.now()}`,
      name: `${src.name} (Copy)`,
      runStatus: null, runError: null, responseJson: null, resolvedUrl: null
    }
    setSteps(prev => {
      const idx = prev.findIndex(s => s.id === stepId)
      const next = [...prev]
      next.splice(idx + 1, 0, dup)
      return next
    })
    setExpandedStepId(dup.id)
  }

  // ── Header helpers ────────────────────────────────────────
  const setStepHeader = (stepId, hIdx, key, val) => {
    const step = steps.find(s => s.id === stepId)
    const entries = Object.entries(step?.headers || {})
    entries[hIdx] = [key, val]
    updateStep(stepId, { headers: Object.fromEntries(entries) })
  }

  const addStepHeader = (stepId) => {
    const step = steps.find(s => s.id === stepId)
    updateStep(stepId, { headers: { ...(step?.headers || {}), '': '' } })
  }

  const removeStepHeader = (stepId, hIdx) => {
    const step = steps.find(s => s.id === stepId)
    const entries = Object.entries(step?.headers || {}).filter((_, i) => i !== hIdx)
    updateStep(stepId, { headers: Object.fromEntries(entries) })
  }

  // ── Run Step (proxy through backend) ─────────────────────
  const runStep = async (stepId) => {
    const stepIndex = steps.findIndex(s => s.id === stepId)
    if (stepIndex === -1 || !serverUrl) return

    // Mark all steps up to this one as running
    setSteps(prev => prev.map((s, i) => i <= stepIndex
      ? { ...s, runStatus: 'running', runError: null }
      : s
    ))

    try {
      // Build steps payload (only up to stepIndex)
      const stepsPayload = steps.slice(0, stepIndex + 1).map(s => ({
        name: s.name,
        method: s.method,
        endpoint: s.endpoint,
        headers: s.headers || {},
        body: s.body ? (() => { try { return JSON.parse(s.body) } catch { return s.body } })() : null,
      }))

      const res = await fetch(`${API}/chains/run-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverUrl,
          appUrl,
          steps: stepsPayload,
          stepIndex,
          context: {}
        })
      })

      const data = await res.json()

      if (!data.success) {
        setSteps(prev => prev.map((s, i) => i <= stepIndex
          ? { ...s, runStatus: 'error', runError: data.error || 'Request failed' }
          : s
        ))
        return
      }

      // Update each run result
      setSteps(prev => {
        const next = [...prev]
        data.results.forEach(result => {
          const idx = result.stepIndex
          next[idx] = {
            ...next[idx],
            runStatus: result.success ? 'success' : 'error',
            runError: result.error || null,
            responseJson: result.json || null,
            responseBody: result.body || null,
            responseStatus: result.status || null,
            responseDuration: result.durationMs || null,
            resolvedUrl: result.resolvedUrl || null,
            sentOrigin: result.sentOrigin || null,
            responseKeys: result.responseKeys || next[idx].responseKeys || [],
            capturedData: result.capturedData || null,
          }
        })
        return next
      })

    } catch (err) {
      setSteps(prev => prev.map((s, i) => i <= stepIndex
        ? { ...s, runStatus: 'error', runError: err.message }
        : s
      ))
    }
  }

  // ── Save chain ────────────────────────────────────────────
  const handleSave = async () => {
    if (!chainName.trim()) { setSaveError('Chain name is required'); return }
    setSaving(true); setSaveError(null); setSaved(false)

    const payload = {
      id: editingChainId || undefined,
      name: chainName.trim(),
      appId: config?.selectedAppId || selectedApp?.id,
      serverUrl,
      appUrl,
      steps: steps.map(s => ({
        id: s.id,
        name: s.name,
        method: s.method,
        endpoint: s.endpoint,
        headers: s.headers || {},
        body: s.body || '',
        think: s.think ?? 1,
        responseKeys: s.responseKeys || [],
      }))
    }

    const result = await saveChain(payload)
    setSaving(false)
    if (result.success) {
      setSaved(true)
      setEditingChainId(result.chain.id)
      setTimeout(() => setSaved(false), 3000)
    } else {
      setSaveError(result.error || 'Failed to save chain')
    }
  }

  // ── Load an existing chain for editing ────────────────────
  const loadChainForEdit = (chain) => {
    setEditingChainId(chain.id)
    setChainName(chain.name)
    setSteps(chain.steps.map(s => ({
      ...s,
      runStatus: null, runError: null
    })))
    setExpandedStepId(chain.steps[0]?.id || null)
  }

  const startNewChain = () => {
    setEditingChainId(null)
    setChainName('My API Chain')
    const s = newStep(0)
    setSteps([s])
    setExpandedStepId(s.id)
    setSaved(false); setSaveError(null)
  }

  const handleDeleteChain = async (chainId) => {
    if (!window.confirm('Delete this chain?')) return
    await deleteChain(chainId)
    if (editingChainId === chainId) startNewChain()
  }

  return (
    <div className="page-wrapper animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">🔗 Chain Builder</h1>
          <p className="page-subtitle">Build multi-step API chains with live test execution and variable extraction</p>
        </div>
        <div className="flex gap-2 items-center">
          <button className="btn btn-ghost btn-sm" onClick={startNewChain}>
            ✨ New Chain
          </button>
          <button
            id="btn-save-chain"
            className="btn btn-primary btn-lg"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '⏳ Saving…' : saved ? '✅ Saved!' : '💾 Save Chain'}
          </button>
        </div>
      </div>

      {saveError && (
        <div className="card card-p mb-3" style={{ borderColor: 'var(--danger)', background: 'var(--danger-dim)', color: 'var(--danger)' }}>
          ❌ {saveError}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

        {/* ── LEFT: Saved Chains sidebar ─────────────────── */}
        <div style={{ width: 220, flexShrink: 0 }}>
          <div className="card card-p" style={{ padding: '1rem' }}>
            <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
              📋 Saved Chains
            </div>
            {chains.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontStyle: 'italic' }}>
                No chains yet. Build one and save it!
              </div>
            ) : (
              chains.map(chain => (
                <div
                  key={chain.id}
                  className={`chain-list-item ${editingChainId === chain.id ? 'active' : ''}`}
                  onClick={() => loadChainForEdit(chain)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                      {chain.name}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {chain.steps?.length || 0} step{chain.steps?.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)', padding: '2px 6px', fontSize: '0.7rem' }}
                    onClick={e => { e.stopPropagation(); handleDeleteChain(chain.id) }}
                    title="Delete chain"
                  >✕</button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT: Chain editor ───────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Chain identity */}
          <div className="card card-p">
            <h3 style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>⚙️ Chain Configuration</h3>
            <div className="form-group">
              <label className="form-label" htmlFor="chain-name-input">Chain Name</label>
              <input
                id="chain-name-input"
                className="form-input"
                value={chainName}
                onChange={e => setChainName(e.target.value)}
                placeholder="e.g. Student Login Flow"
                style={{ fontWeight: 600 }}
              />
            </div>
            <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              {selectedApp ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>🎯 Target Application:</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{selectedApp.name}</span>
                </div>
              ) : null}
              {serverUrl && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>🌐 Target Server:</span>
                  <code style={{ color: 'var(--cyan)', fontSize: '0.78rem' }}>{serverUrl}</code>
                </div>
              )}
              {appUrl && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>🔗 App URL (Origin):</span>
                  <code style={{ color: 'var(--accent-light)', fontSize: '0.78rem' }}>{appUrl}</code>
                </div>
              )}
              {!serverUrl && (
                <div style={{ fontSize: '0.8rem', color: 'var(--warning)' }}>
                  ⚠ No target server configured. Please set one in the <strong>Configure</strong> page.
                </div>
              )}
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                To change the target, update it in the <strong>Configure</strong> page.
              </span>
            </div>
          </div>

          {/* Step cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {steps.map((step, idx) => {
              const isExpanded = expandedStepId === step.id
              const varSuggestions = getAllVarSuggestions(idx)
              const methodClass = `method-${step.method.toLowerCase()}`

              return (
                <div key={step.id} className={`step-card chain-step-card ${isExpanded ? 'expanded active-step' : ''} ${step.runStatus === 'success' ? 'step-ran-success' : ''} ${step.runStatus === 'error' ? 'step-ran-error' : ''}`}>

                  {/* Step Header Bar */}
                  <div className="step-header" onClick={() => setExpandedStepId(isExpanded ? null : step.id)}>
                    <div className="step-title-group">
                      <span className="step-num">Step {idx + 1}</span>
                      <span className={`method-badge ${methodClass}`}>{step.method}</span>
                      <span className="step-endpoint-preview">{step.endpoint}</span>
                      <span className="step-name-preview">— {step.name}</span>
                      {step.runStatus === 'success' && (
                        <span style={{ color: 'var(--success)', fontSize: '0.75rem', marginLeft: '0.5rem' }}>✅ Tested</span>
                      )}
                      {step.runStatus === 'error' && (
                        <span style={{ color: 'var(--danger)', fontSize: '0.75rem', marginLeft: '0.5rem' }}>❌ Failed</span>
                      )}
                      {step.runStatus === 'running' && (
                        <span style={{ color: 'var(--accent-light)', fontSize: '0.75rem', marginLeft: '0.5rem' }} className="animate-pulse">⏳ Running…</span>
                      )}
                    </div>
                    <div className="step-actions" onClick={e => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-sm" disabled={idx === 0} onClick={() => moveStep(step.id, -1)} title="Move Up">⬆</button>
                      <button className="btn btn-ghost btn-sm" disabled={idx === steps.length - 1} onClick={() => moveStep(step.id, 1)} title="Move Down">⬇</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => duplicateStep(step.id)} title="Duplicate">📋</button>
                      {steps.length > 1 && (
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeStep(step.id)} title="Delete">✕</button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setExpandedStepId(isExpanded ? null : step.id)}>
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    </div>
                  </div>

                  {/* Step Form Body */}
                  {isExpanded && (
                    <div className="step-body-content">
                      <div className="grid-2" style={{ gap: '1rem' }}>
                        <div className="form-group">
                          <label className="form-label">Step Name</label>
                          <input
                            className="form-input"
                            value={step.name}
                            onChange={e => updateStep(step.id, { name: e.target.value })}
                            placeholder="e.g. Student Login"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Think Time (s delay after request)</label>
                          <input
                            type="number" className="form-input"
                            value={step.think ?? 1}
                            onChange={e => updateStep(step.id, { think: Number(e.target.value) })}
                            min={0} max={60}
                          />
                        </div>
                      </div>

                      {/* Method + Endpoint */}
                      <div className="flex gap-2" style={{ alignItems: 'flex-end' }}>
                        <div className="form-group" style={{ minWidth: 130 }}>
                          <label className="form-label">Method</label>
                          <select
                            className="form-select"
                            value={step.method}
                            onChange={e => updateStep(step.id, { method: e.target.value })}
                          >
                            {HTTP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div className="form-group flex-1">
                          <label className="form-label">
                            Endpoint Path — type <code style={{ color: 'var(--accent-light)' }}>{'{{'}</code> to insert a variable from previous steps
                          </label>
                          <SmartInput
                            value={step.endpoint}
                            onChange={val => updateStep(step.id, { endpoint: val })}
                            placeholder="/api/resource/{{user.id}}"
                            style={{ fontFamily: 'var(--font-mono)' }}
                            allVarSuggestions={varSuggestions}
                          />
                        </div>
                      </div>

                      {/* Headers */}
                      <div>
                        <div className="flex gap-1 mb-2" style={{ alignItems: 'center' }}>
                          <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', flex: 1 }}>Request Headers</h4>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addStepHeader(step.id)}>
                            + Add Header
                          </button>
                        </div>
                        {Object.entries(step.headers || {}).map(([k, v], hIdx) => (
                          <div key={hIdx} className="kv-row mb-1">
                            <input
                              className="form-input"
                              placeholder="Header-Name"
                              value={k}
                              onChange={e => setStepHeader(step.id, hIdx, e.target.value, v)}
                              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
                            />
                            <SmartInput
                              value={v}
                              onChange={val => setStepHeader(step.id, hIdx, k, val)}
                              placeholder="Header Value (e.g. {{authCookie}})"
                              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
                              allVarSuggestions={varSuggestions}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--danger)' }}
                              onClick={() => removeStepHeader(step.id, hIdx)}
                            >✕</button>
                          </div>
                        ))}
                      </div>

                      {/* Body */}
                      {['POST', 'PUT', 'PATCH'].includes(step.method) && (
                        <div className="form-group">
                          <label className="form-label">
                            JSON Body — type <code style={{ color: 'var(--accent-light)' }}>{'{{'}</code> to reference variables
                          </label>
                          <SmartTextarea
                            value={step.body}
                            onChange={val => updateStep(step.id, { body: val })}
                            rows={4}
                            placeholder={'{\n  "email": "{{email}}",\n  "password": "{{password}}"\n}'}
                            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
                            allVarSuggestions={varSuggestions}
                          />
                        </div>
                      )}

                      {/* Variable preview from previous steps */}
                      {idx > 0 && varSuggestions.length > 0 && (
                        <div className="chain-vars-preview">
                          <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--cyan)', marginBottom: '0.5rem' }}>
                            🔁 Available Variables from Previous Steps
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {varSuggestions.map((s, i) => (
                              <span key={i} className="var-chip" title={`From Step ${s.stepNum}: ${s.stepName}`}>
                                {`{{${s.key}}}`}
                                <span className="var-chip-source">S{s.stepNum}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Run Step button */}
                      <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                        <div className="flex items-center gap-2">
                          <button
                            id={`btn-run-step-${idx + 1}`}
                            className={`btn btn-lg ${step.runStatus === 'success' ? 'btn-success' : step.runStatus === 'error' ? 'btn-danger' : 'btn-primary'}`}
                            onClick={() => runStep(step.id)}
                            disabled={step.runStatus === 'running' || !serverUrl}
                            style={{ minWidth: 160 }}
                          >
                            {step.runStatus === 'running'
                              ? `⏳ Running Step ${idx + 1}…`
                              : step.runStatus === 'success'
                                ? `🔄 Re-run Step ${idx + 1}`
                                : `▶ Run Step ${idx + 1}`}
                          </button>
                          {!serverUrl && (
                            <span style={{ fontSize: '0.78rem', color: 'var(--warning)' }}>
                              ⚠ Select an application with a Server URL first
                            </span>
                          )}
                          {idx > 0 && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Will execute steps 1–{idx + 1} sequentially
                            </span>
                          )}
                        </div>

                        {/* ── Unified Response Panel (shown after any run attempt) ── */}
                        {(step.runStatus === 'success' || step.runStatus === 'error') && (
                          <div
                            className="chain-response-panel"
                            style={{
                              marginTop: '0.75rem',
                              border: `1px solid ${step.runStatus === 'success' ? 'var(--success)' : 'var(--danger)'}`,
                              borderRadius: 'var(--radius-md)',
                              background: step.runStatus === 'success'
                                ? 'rgba(16,185,129,0.06)'
                                : 'rgba(239,68,68,0.06)',
                              overflow: 'hidden',
                            }}
                          >
                            {/* Header bar */}
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: '0.75rem',
                              padding: '0.6rem 0.9rem',
                              borderBottom: '1px solid var(--border)',
                              background: 'var(--bg-elevated)',
                              flexWrap: 'wrap',
                            }}>
                              {/* Status badge */}
                              <span style={{
                                padding: '2px 10px', borderRadius: 20, fontWeight: 700, fontSize: '0.8rem',
                                background: step.runStatus === 'success' ? 'var(--success)' : 'var(--danger)',
                                color: '#fff',
                              }}>
                                {step.responseStatus ?? (step.runStatus === 'success' ? '2xx' : 'ERR')}
                              </span>
                              {/* URL */}
                              {step.resolvedUrl && (
                                <code style={{ fontSize: '0.72rem', color: 'var(--cyan)', flex: 1, wordBreak: 'break-all' }}>
                                  {step.resolvedUrl}
                                </code>
                              )}
                              {/* Duration */}
                              {step.responseDuration != null && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                                  ⏱ {step.responseDuration} ms
                                </span>
                              )}
                            </div>

                            <div style={{ padding: '0.75rem 0.9rem' }}>
                              {/* Connection error (no HTTP response) */}
                              {step.runError && !step.responseStatus && (
                                <div style={{ color: 'var(--danger)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                                  ❌ {step.runError}
                                </div>
                              )}

                              {/* ── Captured Session & Authentication Data Card ── */}
                              {step.runStatus === 'success' && step.capturedData && (
                                <div style={{
                                  marginBottom: '0.85rem',
                                  padding: '0.65rem 0.85rem',
                                  borderRadius: 'var(--radius-sm)',
                                  background: 'rgba(16,185,129,0.08)',
                                  border: '1px solid rgba(16,185,129,0.25)',
                                }}>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--success)', fontWeight: 700, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    🔒 Captured Session & Authentication Data
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400 }}>(auto-stored for next steps)</span>
                                  </div>

                                  {/* Captured Cookies */}
                                  {step.capturedData.cookies && (
                                    <div style={{ marginBottom: '0.4rem', fontSize: '0.75rem' }}>
                                      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>🍪 Cookie Header: </span>
                                      <code style={{ color: 'var(--success)', background: 'var(--bg-base)', padding: '2px 6px', borderRadius: 4, fontSize: '0.72rem', wordBreak: 'break-all' }}>
                                        {step.capturedData.cookies}
                                      </code>
                                      <span className="response-key-chip" style={{ marginLeft: '0.4rem', color: 'var(--success)', borderColor: 'rgba(16,185,129,0.4)' }}>
                                        {'{{authCookie}}'}
                                      </span>
                                    </div>
                                  )}

                                  {/* Captured Auth / Bearer Token */}
                                  {(step.capturedData.tokens?.authorization || step.capturedData.tokens?.token || step.capturedData.tokens?.access_token) && (
                                    <div style={{ marginBottom: '0.4rem', fontSize: '0.75rem' }}>
                                      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>🔑 Bearer / Auth Token: </span>
                                      <code style={{ color: 'var(--cyan)', background: 'var(--bg-base)', padding: '2px 6px', borderRadius: 4, fontSize: '0.72rem', wordBreak: 'break-all' }}>
                                        {step.capturedData.tokens.authorization || `Bearer ${step.capturedData.tokens.token || step.capturedData.tokens.access_token}`}
                                      </code>
                                      <span className="response-key-chip" style={{ marginLeft: '0.4rem' }}>
                                        {'{{access_token}}'}
                                      </span>
                                    </div>
                                  )}

                                  {/* Extracted Variables Grid */}
                                  {step.capturedData.vars && Object.keys(step.capturedData.vars).length > 0 && (
                                    <div style={{ marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px dashed rgba(16,185,129,0.2)' }}>
                                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.3rem' }}>
                                        📦 EXTRACTED DATA VALUES
                                      </div>
                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.35rem' }}>
                                        {Object.entries(step.capturedData.vars).slice(0, 10).map(([k, v], vi) => (
                                          <div key={vi} style={{ background: 'var(--bg-base)', padding: '3px 7px', borderRadius: 4, fontSize: '0.7rem', display: 'flex', gap: '0.35rem', overflow: 'hidden' }}>
                                            <span style={{ color: 'var(--cyan)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{`{{${k}}}`}:</span>
                                            <span style={{ color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{String(v)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Auto-injected headers notice for Step 2+ */}
                              {idx > 0 && step.capturedData?.autoInjectedHeaders && (step.capturedData.autoInjectedHeaders.cookie || step.capturedData.autoInjectedHeaders.authorization) && (
                                <div style={{ marginBottom: '0.65rem', padding: '0.4rem 0.75rem', borderRadius: 4, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', fontSize: '0.73rem', color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  ⚡ <strong>Auto-Inherited Session:</strong>
                                  {step.capturedData.autoInjectedHeaders.cookie && <span>Cookie Attached</span>}
                                  {step.capturedData.autoInjectedHeaders.cookie && step.capturedData.autoInjectedHeaders.authorization && <span>•</span>}
                                  {step.capturedData.autoInjectedHeaders.authorization && <span>Authorization: Bearer Token Attached</span>}
                                </div>
                              )}

                              {/* Response body */}
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>
                                RESPONSE BODY
                              </div>
                              <pre className="chain-response-json" style={{
                                maxHeight: 280,
                                overflowY: 'auto',
                                margin: 0,
                                fontSize: '0.78rem',
                                color: step.runStatus === 'success' ? 'var(--text-primary)' : 'var(--danger)',
                              }}>
                                {step.responseJson
                                  ? JSON.stringify(step.responseJson, null, 2)
                                  : step.responseBody || '(no response body)'}
                              </pre>

                              {/* Request Origin footer */}
                              {step.sentOrigin && (
                                <div style={{
                                  marginTop: '0.75rem',
                                  paddingTop: '0.6rem',
                                  borderTop: '1px solid var(--border)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.5rem',
                                  flexWrap: 'wrap',
                                }}>
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>ORIGIN SENT</span>
                                  <code style={{
                                    fontSize: '0.72rem',
                                    color: step.runStatus === 'success' ? 'var(--success)' : 'var(--warning)',
                                    background: 'var(--bg-base)',
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                  }}>
                                    {step.sentOrigin}
                                  </code>
                                  {step.runStatus === 'error' && step.responseStatus && (
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>
                                      ← make sure this domain is in the target server&apos;s CORS allowed origins
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add Step */}
          <button
            id="btn-add-chain-step"
            className="btn btn-ghost"
            onClick={addStep}
            style={{ alignSelf: 'flex-start', borderStyle: 'dashed', color: 'var(--accent-light)' }}
          >
            ➕ Add Step
          </button>
        </div>
      </div>
    </div>
  )
}
