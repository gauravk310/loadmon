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
  return (
    <div className="var-dropdown" onMouseDown={e => e.stopPropagation()}>
      <div className="var-dropdown-header">💡 Available Variables</div>
      {suggestions.map((s, i) => (
        <div
          key={i}
          className="var-dropdown-item"
          onMouseDown={() => { onSelect(s.key); onClose() }}
        >
          <span className="var-key">{`{{${s.key}}}`}</span>
          <span className="var-source">← Step {s.stepNum}: {s.stepName}</span>
        </div>
      ))}
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
  const [selectedAppId, setSelectedAppId] = useState('')
  const [steps, setSteps] = useState([newStep(0)])
  const [expandedStepId, setExpandedStepId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [editingChainId, setEditingChainId] = useState(null)

  // Initialize app selection from config
  useEffect(() => {
    if (config && config.applications && config.applications.length > 0 && !selectedAppId) {
      setSelectedAppId(config.selectedAppId || config.applications[0].id)
    }
  }, [config, selectedAppId])

  // Auto expand first step
  useEffect(() => {
    if (steps.length > 0 && !expandedStepId) {
      setExpandedStepId(steps[0].id)
    }
  }, [])

  // ── Derived: selected app info ────────────────────────────
  const selectedApp = config?.applications?.find(a => a.id === selectedAppId) || null
  const serverUrl = selectedApp?.serverUrl || config?.serverUrl || ''
  const appUrl = selectedApp?.appUrl || config?.appUrl || ''

  // ── Collect all variable suggestions from previous steps ──
  const getAllVarSuggestions = useCallback((upToStepIndex) => {
    const suggestions = []
    for (let i = 0; i < upToStepIndex; i++) {
      const step = steps[i]
      if (step.responseKeys && step.responseKeys.length > 0) {
        step.responseKeys.forEach(key => {
          suggestions.push({ key, stepNum: i + 1, stepName: step.name })
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
            resolvedUrl: result.resolvedUrl || null,
            responseKeys: result.responseKeys || next[idx].responseKeys || [],
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
      appId: selectedAppId,
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
    setSelectedAppId(chain.appId || config?.selectedAppId || '')
    setSteps(chain.steps.map(s => ({
      ...s,
      runStatus: null, runError: null
    })))
    setExpandedStepId(chain.steps[0]?.id || null)
  }

  const startNewChain = () => {
    setEditingChainId(null)
    setChainName('My API Chain')
    setSelectedAppId(config?.selectedAppId || config?.applications?.[0]?.id || '')
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
            <div className="grid-2" style={{ gap: '1rem' }}>
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
              <div className="form-group">
                <label className="form-label" htmlFor="chain-app-select">Target Application</label>
                <select
                  id="chain-app-select"
                  className="form-select"
                  value={selectedAppId}
                  onChange={e => setSelectedAppId(e.target.value)}
                >
                  {(config?.applications || []).map(app => (
                    <option key={app.id} value={app.id}>
                      {app.name} {app.serverUrl ? `(${app.serverUrl})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {serverUrl && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                🌐 Target Server: <code style={{ color: 'var(--cyan)', fontSize: '0.78rem' }}>{serverUrl}</code>
              </div>
            )}
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

                        {/* Response display */}
                        {step.runStatus === 'error' && step.runError && (
                          <div className="chain-response-panel error" style={{ marginTop: '0.75rem' }}>
                            <div className="chain-response-title">❌ Error</div>
                            <div style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>{step.runError}</div>
                          </div>
                        )}

                        {step.runStatus === 'success' && (
                          <div className="chain-response-panel success" style={{ marginTop: '0.75rem' }}>
                            <div className="chain-response-title">
                              ✅ Response
                              {step.resolvedUrl && (
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', marginLeft: '0.75rem', color: 'var(--cyan)' }}>
                                  {step.resolvedUrl}
                                </span>
                              )}
                            </div>

                            {/* Extracted keys */}
                            {step.responseKeys && step.responseKeys.length > 0 && (
                              <div style={{ marginBottom: '0.75rem' }}>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 600 }}>
                                  📦 Extracted Variables (available in next steps):
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                  {step.responseKeys.map((key, ki) => (
                                    <span key={ki} className="response-key-chip">
                                      {`{{${key}}}`}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* JSON response */}
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Response JSON:</div>
                            <pre className="chain-response-json">
                              {JSON.stringify(step.responseJson, null, 2) || step.responseBody || 'No response body'}
                            </pre>
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
