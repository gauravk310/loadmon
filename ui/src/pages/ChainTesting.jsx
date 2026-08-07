import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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

  if (!Array.isArray(suggestions) || !suggestions.length) return null

  // Group suggestions by stepLabel / stepName
  const groupsMap = new Map()

  suggestions.forEach(s => {
    if (!s || typeof s !== 'object') return
    const rawLabel = String(s.stepLabel || (s.stepNum ? `Step ${s.stepNum}: ${s.stepName}` : s.stepName) || 'Saved Variables')
    const labelLower = rawLabel.toLowerCase()
    if (!groupsMap.has(rawLabel)) {
      groupsMap.set(rawLabel, {
        label: rawLabel,
        stepNum: typeof s.stepNum === 'number' ? s.stepNum : 999,
        isCredential: labelLower.includes('credential') || labelLower.includes('initial'),
        items: []
      })
    }
    groupsMap.get(rawLabel).items.push(s)
  })

  const groupList = Array.from(groupsMap.values()).sort((a, b) => a.stepNum - b.stepNum)

  return (
    <div className="var-dropdown" onMouseDown={e => e.stopPropagation()}>
      <div className="var-dropdown-header">💡 Available Variables</div>
      {groupList.map((g, gIdx) => (
        <div key={gIdx} className="var-dropdown-group">
          <div style={{
            padding: '4px 8px',
            fontSize: '0.68rem',
            fontWeight: 700,
            color: g.isCredential ? 'var(--success)' : 'var(--cyan)',
            background: g.isCredential ? 'rgba(16,185,129,0.08)' : 'rgba(34,211,238,0.08)',
            borderTop: gIdx > 0 ? '1px solid var(--border)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span>{g.isCredential ? '🔑 ' : '📌 '}{String(g.label).toUpperCase()}</span>
            <span style={{ opacity: 0.7, fontSize: '0.62rem', fontWeight: 500 }}>({g.items.length})</span>
          </div>
          {g.items.map((s, i) => (
            <div
              key={`${gIdx}-${i}`}
              className="var-dropdown-item"
              onMouseDown={() => { onSelect(s.key); onClose() }}
            >
              <span className="var-key" style={{ color: s.isAuth ? 'var(--success)' : 'var(--cyan)' }}>
                {`{{${s.key}}}`}
              </span>
              <span className="var-source">← {g.label}</span>
            </div>
          ))}
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
    const cursor = e.target.selectionStart
    const textBefore = val.substring(0, cursor)
    const match = textBefore.match(/\{\{([\w.]*)$/)
    if (match) {
      const typed = match[1].toLowerCase()
      const filtered = (allVarSuggestions || []).filter(s => s && s.key && s.key.toLowerCase().includes(typed))
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
    const textBefore = (value || '').substring(0, cursor)
    const textAfter = (value || '').substring(cursor)
    const openIdx = textBefore.lastIndexOf('{{')
    if (openIdx === -1) return
    const newVal = (value || '').substring(0, openIdx) + `{{${key}}}` + textAfter
    onChange(newVal)
    setShowDropdown(false)
  }

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <input
        ref={inputRef}
        className={className || 'form-input'}
        value={value || ''}
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
      const filtered = (allVarSuggestions || []).filter(s => s && s.key && s.key.toLowerCase().includes(typed))
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
    const textBefore = (value || '').substring(0, cursor)
    const textAfter = (value || '').substring(cursor)
    const openIdx = textBefore.lastIndexOf('{{')
    if (openIdx === -1) return
    const newVal = (value || '').substring(0, openIdx) + `{{${key}}}` + textAfter
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

export default function ChainTesting() {
  const { config, saveChain, deleteChain, chains, startTest, stopTest, testStatus, stepLogs, setStepLogs, API } = useApp()

  const [activeTab, setActiveTab] = useState('config') // 'config' | 'executor'

  // ── Chain Config State ─────────────────────────────────────
  const [chainName, setChainName] = useState('My API Chain')
  const [steps, setSteps] = useState([newStep(0)])
  const [expandedStepId, setExpandedStepId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [editingChainId, setEditingChainId] = useState(null)

  // ── JSON Data Extraction & Sequential Execution State ───────
  const [jsonInput, setJsonInput] = useState('')
  const [extractedObjects, setExtractedObjects] = useState([])
  const [extractedCount, setExtractedCount] = useState(0)
  const [extractError, setExtractError] = useState(null)
  const [objectLimit, setObjectLimit] = useState(5)
  const [dataDuration, setDataDuration] = useState(5)
  const [dataArrivalRate, setDataArrivalRate] = useState(1)
  const [dataDrivenRunning, setDataDrivenRunning] = useState(false)
  const [dataDrivenError, setDataDrivenError] = useState(null)
  const [reportCard, setReportCard] = useState(null)
  const [dataResults, setDataResults] = useState([])
  const [dataSearch, setDataSearch] = useState('')
  const [dataFilter, setDataFilter] = useState('ALL')

  // ── Chain Executor State ──────────────────────────────────
  const [selectedChainId, setSelectedChainId] = useState('')
  const [numUsers, setNumUsers] = useState(1)
  const [duration, setDuration] = useState(3)
  const [arrivalRate, setArrivalRate] = useState(1)
  const [availableUsersCount, setAvailableUsersCount] = useState(0)
  const [executing, setExecuting] = useState(false)
  const [execError, setExecError] = useState(null)

  const handleLoadUserDataJson = async () => {
    setExtractError(null)
    try {
      const res = await fetch(`${API}/upload/raw`)
      const data = await res.json()
      if (data.success && Array.isArray(data.data)) {
        const jsonStr = JSON.stringify(data.data, null, 2)
        setJsonInput(jsonStr)
        setExtractedObjects(data.data)
        setExtractedCount(data.data.length)
        if (!objectLimit || objectLimit > data.data.length) {
          setObjectLimit(Math.min(5, data.data.length))
        }
      } else {
        setExtractError(data.error || 'No uploaded user data found in backend.')
      }
    } catch (err) {
      setExtractError(`Failed to load uploaded data: ${err.message}`)
    }
  }

  const handleExtractData = () => {
    setExtractError(null)
    setReportCard(null)
    setDataResults([])
    try {
      const raw = jsonInput.trim()
      if (!raw) {
        setExtractError('Please enter or paste JSON body array')
        return
      }
      const parsed = JSON.parse(raw)
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      if (arr.length === 0) {
        setExtractError('Extracted JSON array is empty')
        return
      }
      setExtractedObjects(arr)
      setExtractedCount(arr.length)
      if (!objectLimit || objectLimit > arr.length) {
        setObjectLimit(Math.min(5, arr.length))
      }
    } catch (e) {
      setExtractError(`Invalid JSON format: ${e.message}`)
    }
  }

  const handleRunDataDrivenChain = async () => {
    let objs = extractedObjects
    if (objs.length === 0 && jsonInput.trim()) {
      try {
        const parsed = JSON.parse(jsonInput.trim())
        objs = Array.isArray(parsed) ? parsed : [parsed]
        setExtractedObjects(objs)
        setExtractedCount(objs.length)
      } catch {}
    }

    if (!objs || objs.length === 0) {
      setDataDrivenError('Please extract JSON data objects before running the chain.')
      return
    }

    if (!serverUrl) {
      setDataDrivenError('Target server URL is missing. Please select/configure a target application.')
      return
    }

    const totalToRun = (Number(dataDuration) || 0) * (Number(dataArrivalRate) || 0)
    if (totalToRun > Number(objectLimit)) {
      setDataDrivenError(`Duration (${dataDuration}s) × Arrival /s (${dataArrivalRate}) = ${totalToRun} objects exceeds limit of ${objectLimit}.`)
      return
    }

    setDataDrivenError(null)
    setDataDrivenRunning(true)

    try {
      const stepsPayload = steps.map(s => ({
        name: s.name,
        method: s.method,
        endpoint: s.endpoint,
        headers: s.headers || {},
        body: s.body || ''
      }))

      const res = await fetch(`${API}/chains/run-data-driven`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverUrl,
          appUrl,
          steps: stepsPayload,
          objects: objs,
          limit: Number(objectLimit) || objs.length,
          duration: Number(dataDuration),
          arrivalRate: Number(dataArrivalRate)
        })
      })

      const contentType = res.headers.get('content-type') || ''
      let data = null
      if (contentType.includes('application/json')) {
        data = await res.json()
      } else {
        const textText = await res.text()
        throw new Error(`Server returned HTTP ${res.status}: ${textText.substring(0, 100)}`)
      }

      setDataDrivenRunning(false)

      if (data.success) {
        setReportCard(data.reportCard)
        setDataResults(data.objectResults || [])
      } else {
        setDataDrivenError(data.error || 'Failed to run data-driven chain')
      }
    } catch (err) {
      setDataDrivenRunning(false)
      setDataDrivenError(err.message)
    }
  }

  // Auto expand first step on mount
  useEffect(() => {
    if (steps.length > 0 && !expandedStepId) {
      setExpandedStepId(steps[0].id)
    }
  }, [])

  // Auto select first chain if available for executor and sync steps
  useEffect(() => {
    if (chains.length > 0 && !selectedChainId) {
      const firstChain = chains[0]
      setSelectedChainId(firstChain.id)
      setEditingChainId(firstChain.id)
      setChainName(firstChain.name)
      if (firstChain.steps && firstChain.steps.length > 0) {
        setSteps(firstChain.steps.map(s => ({ ...s, runStatus: null, runError: null })))
      }
    }
  }, [chains, selectedChainId])

  // Fetch available data manager users
  useEffect(() => {
    fetch(`${API}/upload/preview`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.exists && typeof d.rowCount === 'number') {
          setAvailableUsersCount(d.rowCount)
        }
      })
      .catch(() => {})
  }, [API])

  const selectedApp = config?.applications?.find(a => a.id === config?.selectedAppId) || config?.applications?.[0] || null
  const serverUrl = selectedApp?.serverUrl || config?.serverUrl || ''
  const appUrl = selectedApp?.appUrl || config?.appUrl || ''

  const activeConfigChain = useMemo(() => ({
    id: editingChainId || 'active_config',
    name: chainName || 'My API Chain',
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
      responseKeys: s.responseKeys || []
    }))
  }), [editingChainId, chainName, serverUrl, appUrl, steps])

  // Selected chain object for executor tab
  const executorChain = useMemo(() => {
    if (!selectedChainId || selectedChainId === 'active_config') {
      return activeConfigChain
    }
    const found = chains.find(c => c.id === selectedChainId)
    return found || activeConfigChain
  }, [selectedChainId, chains, activeConfigChain])

  // Collect variable suggestions from previous steps
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

  // Header helpers
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

  // ── Run Step (Always executes linked steps from Step 1 down to Step X) ──────
  const runStep = async (stepId) => {
    const stepIndex = steps.findIndex(s => s.id === stepId)
    if (stepIndex === -1 || !serverUrl) return

    // Mark all steps up to this step as running
    setSteps(prev => prev.map((s, i) => i <= stepIndex
      ? { ...s, runStatus: 'running', runError: null }
      : s
    ))

    try {
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

      setSteps(prev => {
        const next = [...prev]
        data.results.forEach(result => {
          const idx = result.stepIndex
          if (next[idx]) {
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
      if (!selectedChainId) setSelectedChainId(result.chain.id)
      setTimeout(() => setSaved(false), 3000)
    } else {
      setSaveError(result.error || 'Failed to save chain')
    }
  }

  // Load existing chain into Config Editor
  const loadChainForEdit = (chain) => {
    if (!chain) return
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

  // ── Executor Handlers ─────────────────────────────────────
  const handleExecuteChain = async () => {
    if (!executorChain) {
      setExecError('Please select a saved chain to execute')
      return
    }
    setExecError(null)
    setExecuting(true)

    const phases = [{
      duration: Number(duration) || 3,
      arrivalRate: Number(arrivalRate) || 1,
      maxVusers: Number(numUsers) || 1,
      name: `Chain Test: ${executorChain.name}`
    }]

    const res = await startTest({
      environment: 'custom',
      phases,
      chain: executorChain
    })

    setExecuting(false)
    if (!res.success) {
      setExecError(res.error || 'Failed to start chain execution')
    }
  }

  const handleStopExecution = async () => {
    setExecuting(true)
    await stopTest()
    setExecuting(false)
  }

  return (
    <div className="page-wrapper animate-fade-in">
      {/* Header */}
      <div className="page-header mb-2">
        <div>
          <h1 className="page-title">🔗 Chain Testing</h1>
          <p className="page-subtitle">Build, test, and execute multi-step API chains with live node visualizers</p>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex gap-2 mb-3" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
        <button
          className={`btn ${activeTab === 'config' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('config')}
          style={{ fontSize: '0.9rem', fontWeight: 600 }}
        >
          ⚙️ Chain Config
        </button>
        <button
          className={`btn ${activeTab === 'executor' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('executor')}
          style={{ fontSize: '0.9rem', fontWeight: 600 }}
        >
          ▶️ Chain Executor
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════ */}
      {/* SECTION 1: CHAIN CONFIG TAB                                 */}
      {/* ════════════════════════════════════════════════════════════ */}
      {activeTab === 'config' && (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Top Chain Configuration Header with Dropdown */}
          <div className="card card-p">
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: '1.2rem' }}>⚙️</span>
                <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.05rem', fontWeight: 700 }}>
                  Chain Configuration
                </h3>
              </div>

              {/* Horizontal Dropdown of Saved Chains */}
              <div className="flex items-center gap-2 flex-wrap">
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Saved Chains:</span>
                <select
                  className="form-select"
                  style={{ width: 'auto', minWidth: 200, fontSize: '0.85rem' }}
                  value={editingChainId || ''}
                  onChange={e => {
                    const found = chains.find(c => c.id === e.target.value)
                    if (found) loadChainForEdit(found)
                    else startNewChain()
                  }}
                >
                  <option value="">✨ Create New Chain...</option>
                  {chains.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.steps?.length || 0} steps)
                    </option>
                  ))}
                </select>

                <button className="btn btn-ghost btn-sm" onClick={startNewChain}>
                  ✨ New
                </button>

                {editingChainId && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)' }}
                    onClick={() => handleDeleteChain(editingChainId)}
                  >
                    🗑 Delete
                  </button>
                )}

                <button
                  id="btn-save-chain"
                  className="btn btn-primary btn-md"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? '⏳ Saving…' : saved ? '✅ Saved!' : '💾 Save Chain'}
                </button>
              </div>
            </div>

            {saveError && (
              <div className="card card-p mb-2 mt-2" style={{ borderColor: 'var(--danger)', background: 'var(--danger-dim)', color: 'var(--danger)', padding: '0.5rem 1rem', fontSize: '0.82rem' }}>
                ❌ {saveError}
              </div>
            )}

            <div className="form-group mt-2">
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
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════ */}
          {/* JSON DATA EXTRACTION & DATA-DRIVEN CHAIN RUNNER              */}
          {/* ════════════════════════════════════════════════════════════ */}
          <div className="card card-p style-glass mb-2" style={{ border: '1px solid rgba(99, 102, 241, 0.3)' }}>
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <div>
                <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>📦</span> JSON Body Input & Data Extraction
                </h3>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  Extract virtual user objects from JSON array input (e.g., 2,000 objects from <code>userData.json</code>) and execute the chain sequentially.
                </p>
              </div>

              <button
                className="btn btn-ghost btn-sm"
                onClick={handleLoadUserDataJson}
                style={{ color: 'var(--accent-light)', borderColor: 'rgba(99, 102, 241, 0.4)' }}
              >
                📂 Auto-Load from uploaded userData.json
              </button>
            </div>

            {extractError && (
              <div className="card card-p mb-2" style={{ borderColor: 'var(--danger)', background: 'var(--danger-dim)', color: 'var(--danger)', padding: '0.5rem 1rem', fontSize: '0.82rem' }}>
                ❌ {extractError}
              </div>
            )}

            <div className="form-group mb-3">
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>JSON Body Input (Array of Objects)</span>
                {extractedCount > 0 && (
                  <span className="badge badge-success" style={{ fontSize: '0.75rem' }}>
                    ✅ {extractedCount.toLocaleString()} Objects Extracted
                  </span>
                )}
              </label>
              <textarea
                className="form-textarea"
                rows={5}
                value={jsonInput}
                onChange={e => setJsonInput(e.target.value)}
                placeholder={'[\n  {\n    "email": "student0001@loadtesting.com",\n    "password": "GradeMeAI"\n  },\n  {\n    "email": "student0002@loadtesting.com",\n    "password": "GradeMeAI"\n  }\n]'}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
              />
            </div>

            {(() => {
              const calcCount = (Number(dataDuration) || 0) * (Number(dataArrivalRate) || 0)
              const isExceeded = calcCount > (Number(objectLimit) || 0)
              return (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      className="btn btn-primary"
                      onClick={handleExtractData}
                    >
                      🔍 Extract Data
                    </button>

                    <div className="flex items-center gap-2">
                      <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                        Limit Objects to Run:
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        style={{ width: 85, padding: '0.35rem 0.6rem', fontSize: '0.82rem' }}
                        value={objectLimit}
                        onChange={e => setObjectLimit(Math.max(1, Number(e.target.value)))}
                        min={1}
                        max={extractedCount || undefined}
                      />
                      {extractedCount > 0 && (
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          out of {extractedCount.toLocaleString()}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                        Duration (s):
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        style={{ width: 75, padding: '0.35rem 0.6rem', fontSize: '0.82rem' }}
                        value={dataDuration}
                        onChange={e => setDataDuration(Math.max(1, Number(e.target.value)))}
                        min={1}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                        Arrival /s:
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        style={{ width: 75, padding: '0.35rem 0.6rem', fontSize: '0.82rem' }}
                        value={dataArrivalRate}
                        onChange={e => setDataArrivalRate(Math.max(1, Number(e.target.value)))}
                        min={1}
                      />
                    </div>

                    <div style={{
                      fontSize: '0.78rem',
                      padding: '0.35rem 0.65rem',
                      borderRadius: 'var(--radius-sm)',
                      background: isExceeded ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.12)',
                      border: `1px solid ${isExceeded ? 'var(--danger)' : 'rgba(16, 185, 129, 0.3)'}`,
                      color: isExceeded ? 'var(--danger)' : 'var(--success)',
                      fontWeight: 600
                    }}>
                      {isExceeded
                        ? `⚠️ ${dataDuration}s × ${dataArrivalRate}/s = ${calcCount} > Limit (${objectLimit})`
                        : `Total: ${dataDuration}s × ${dataArrivalRate}/s = ${calcCount} / ${objectLimit} max`}
                    </div>
                  </div>

                  <button
                    className="btn btn-success btn-lg"
                    onClick={handleRunDataDrivenChain}
                    disabled={dataDrivenRunning || (!extractedObjects.length && !jsonInput.trim()) || isExceeded}
                    style={{ minWidth: 200 }}
                  >
                    {dataDrivenRunning ? '⏳ Executing Objects…' : '▶️ Run Data-Driven Chain'}
                  </button>
                </div>
              )
            })()}

            {dataDrivenError && (
              <div className="card card-p mt-3" style={{ borderColor: 'var(--danger)', background: 'var(--danger-dim)', color: 'var(--danger)', padding: '0.6rem 1rem', fontSize: '0.82rem' }}>
                ❌ {dataDrivenError}
              </div>
            )}

            {/* Extracted Objects Sample Preview */}
            {extractedCount > 0 && !reportCard && (
              <div className="mt-3" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                  Preview First {Math.min(3, extractedCount)} Extracted Objects:
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', overflowX: 'auto', paddingBottom: '0.4rem' }}>
                  {extractedObjects.slice(0, 3).map((obj, i) => (
                    <div key={i} style={{ background: 'var(--bg-elevated)', padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', minWidth: 220 }}>
                      <div style={{ color: 'var(--accent-light)', fontWeight: 700, marginBottom: 3 }}>Object #{i + 1}</div>
                      <div>{JSON.stringify(obj, null, 2)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Linked Step Editor Cards */}
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
                            🔁 Linked Variables Available from Previous Steps
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

                      {/* Run Step Button (Runs steps 1..idx linked sequentially) */}
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
                              ? `⏳ Running Steps 1–${idx + 1}…`
                              : step.runStatus === 'success'
                                ? `🔄 Re-run Steps 1–${idx + 1}`
                                : `▶ Run Step ${idx + 1}`}
                          </button>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            🔗 Chained execution: starts from Step 1 down to Step {idx + 1}
                          </span>
                        </div>

                        {/* Response Panel */}
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
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: '0.75rem',
                              padding: '0.6rem 0.9rem',
                              borderBottom: '1px solid var(--border)',
                              background: 'var(--bg-elevated)',
                              flexWrap: 'wrap',
                            }}>
                              <span style={{
                                padding: '2px 10px', borderRadius: 20, fontWeight: 700, fontSize: '0.8rem',
                                background: step.runStatus === 'success' ? 'var(--success)' : 'var(--danger)',
                                color: '#fff',
                              }}>
                                {step.responseStatus ?? (step.runStatus === 'success' ? '2xx' : 'ERR')}
                              </span>
                              {step.resolvedUrl && (
                                <code style={{ fontSize: '0.72rem', color: 'var(--cyan)', flex: 1, wordBreak: 'break-all' }}>
                                  {step.resolvedUrl}
                                </code>
                              )}
                              {step.responseDuration != null && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                                  ⏱ {step.responseDuration} ms
                                </span>
                              )}
                            </div>

                            <div style={{ padding: '0.75rem 0.9rem' }}>
                              {step.runError && !step.responseStatus && (
                                <div style={{ color: 'var(--danger)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                                  ❌ {step.runError}
                                </div>
                              )}

                              {step.runStatus === 'success' && step.capturedData && (
                                <div style={{
                                  marginBottom: '0.85rem',
                                  padding: '0.65rem 0.85rem',
                                  borderRadius: 'var(--radius-sm)',
                                  background: 'rgba(16,185,129,0.08)',
                                  border: '1px solid rgba(16,185,129,0.25)',
                                }}>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--success)', fontWeight: 700, marginBottom: '0.4rem' }}>
                                    🔒 Captured Session Data (auto-linked to next steps)
                                  </div>
                                  {step.capturedData.cookies && (
                                    <div style={{ marginBottom: '0.4rem', fontSize: '0.75rem' }}>
                                      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>🍪 Cookie Header: </span>
                                      <code style={{ color: 'var(--success)', background: 'var(--bg-base)', padding: '2px 6px', borderRadius: 4, fontSize: '0.72rem' }}>
                                        {step.capturedData.cookies}
                                      </code>
                                    </div>
                                  )}
                                  {(step.capturedData.tokens?.authorization || step.capturedData.tokens?.token || step.capturedData.tokens?.access_token) && (
                                    <div style={{ marginBottom: '0.4rem', fontSize: '0.75rem' }}>
                                      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>🔑 Bearer / Auth Token: </span>
                                      <code style={{ color: 'var(--cyan)', background: 'var(--bg-base)', padding: '2px 6px', borderRadius: 4, fontSize: '0.72rem' }}>
                                        {step.capturedData.tokens.authorization || `Bearer ${step.capturedData.tokens.token || step.capturedData.tokens.access_token}`}
                                      </code>
                                    </div>
                                  )}
                                </div>
                              )}

                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>
                                RESPONSE BODY
                              </div>
                              <pre className="chain-response-json" style={{
                                maxHeight: 240, overflowY: 'auto', margin: 0, fontSize: '0.78rem',
                                color: step.runStatus === 'success' ? 'var(--text-primary)' : 'var(--danger)',
                              }}>
                                {step.responseJson
                                  ? JSON.stringify(step.responseJson, null, 2)
                                  : step.responseBody || '(no response body)'}
                              </pre>
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

          <button
            id="btn-add-chain-step"
            className="btn btn-ghost"
            onClick={addStep}
            style={{ alignSelf: 'flex-start', borderStyle: 'dashed', color: 'var(--accent-light)' }}
          >
            ➕ Add Step
          </button>

          {/* ════════════════════════════════════════════════════════════ */}
          {/* REPORT CARD & SUMMARY TABLE                                  */}
          {/* ════════════════════════════════════════════════════════════ */}
          {reportCard && (
            <div className="card card-p animate-fade-in style-glass mt-3" style={{ border: '1px solid rgba(16, 185, 129, 0.4)' }}>
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div>
                  <h3 style={{ margin: 0, color: 'var(--success)', fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>🎓</span> Chain Execution Report Card
                  </h3>
                  <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    Execution summary for {reportCard.totalExecuted || 0} objects executed sequentially
                  </p>
                </div>

                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify({ reportCard, objectResults: dataResults }, null, 2)], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `chain-report-card-${Date.now()}.json`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  style={{ color: 'var(--cyan)' }}
                >
                  📥 Export Report Card JSON
                </button>
              </div>

              {/* Metric Cards Grid */}
              <div className="grid-4 mb-3" style={{ gap: '1rem' }}>
                <div className="card card-p" style={{ background: 'var(--bg-elevated)', borderLeft: '4px solid var(--accent-light)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Total Objects Run</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
                    {(reportCard.totalExecuted || 0).toLocaleString()}
                  </div>
                </div>

                <div className="card card-p" style={{ background: 'var(--bg-elevated)', borderLeft: '4px solid var(--success)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Passed Objects</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--success)', marginTop: 4 }}>
                    {(reportCard.passedObjects || 0).toLocaleString()} <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>({reportCard.successRate || 0}%)</span>
                  </div>
                </div>

                <div className="card card-p" style={{ background: 'var(--bg-elevated)', borderLeft: '4px solid var(--danger)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Failed Objects</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--danger)', marginTop: 4 }}>
                    {(reportCard.failedObjects || 0).toLocaleString()}
                  </div>
                </div>

                <div className="card card-p" style={{ background: 'var(--bg-elevated)', borderLeft: '4px solid var(--cyan)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Avg Chain Response Time</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--cyan)', marginTop: 4 }}>
                    {reportCard.avgChainDurationMs || 0} <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>ms</span>
                  </div>
                </div>
              </div>

              {/* Per Step Aggregate Breakdown */}
              {reportCard.stepStats && reportCard.stepStats.length > 0 && (
                <div className="mb-3" style={{ background: 'var(--bg-elevated)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    📊 Step-by-Step Aggregate Summary
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(200px, 1fr))`, gap: '0.75rem' }}>
                    {reportCard.stepStats.map((st, i) => (
                      <div key={i} style={{ background: 'var(--bg-base)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{st.stepName || `Step ${i + 1}`}</span>
                          <span className={`method-badge method-${(st.method || 'GET').toLowerCase()}`} style={{ fontSize: '0.62rem', padding: '1px 5px' }}>{st.method || 'GET'}</span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--cyan)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{st.endpoint}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          <span>✅ {st.passCount || 0} pass</span>
                          <span>❌ {st.failCount || 0} fail</span>
                          <span>⏱ {st.avgDurationMs || 0} ms</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Objects Summary Table */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h4 style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    📋 Objects Detailed Execution Table
                  </h4>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="🔍 Search object/email..."
                      value={dataSearch}
                      onChange={e => setDataSearch(e.target.value)}
                      style={{ width: 180, fontSize: '0.78rem', padding: '0.35rem 0.6rem' }}
                    />
                    <select
                      className="form-select"
                      value={dataFilter}
                      onChange={e => setDataFilter(e.target.value)}
                      style={{ width: 'auto', fontSize: '0.78rem', padding: '0.35rem 0.6rem' }}
                    >
                      <option value="ALL">All Objects ({dataResults.length})</option>
                      <option value="PASSED">✅ Passed Only</option>
                      <option value="FAILED">❌ Failed Only</option>
                    </select>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                        <th style={{ padding: '0.6rem 0.75rem', width: 50 }}>#</th>
                        <th style={{ padding: '0.6rem 0.75rem', minWidth: 200 }}>👤 Object Identifier</th>
                        {steps.map((st, i) => (
                          <th key={i} style={{ padding: '0.6rem 0.75rem', minWidth: 160 }}>
                            Step {i + 1}: {st.name}
                          </th>
                        ))}
                        <th style={{ padding: '0.6rem 0.75rem', minWidth: 100 }}>Total Time</th>
                        <th style={{ padding: '0.6rem 0.75rem', minWidth: 110 }}>Overall Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataResults
                        .filter(r => {
                          const ident = String(r.identifier || '').toLowerCase()
                          if (dataSearch && !ident.includes(dataSearch.toLowerCase())) return false
                          if (dataFilter === 'PASSED' && !r.success) return false
                          if (dataFilter === 'FAILED' && r.success) return false
                          return true
                        })
                        .map((res, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {res.objectIndex || (i + 1)}
                            </td>
                            <td style={{ padding: '0.55rem 0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {res.identifier || `Object #${i + 1}`}
                            </td>
                            {steps.map((st, stepIdx) => {
                              const stepRes = res.stepResults?.find(sr => sr.stepIndex === stepIdx) || res.stepResults?.[stepIdx]
                              if (!stepRes) {
                                return (
                                  <td key={stepIdx} style={{ padding: '0.55rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                                    — Skipped
                                  </td>
                                )
                              }
                              return (
                                <td key={stepIdx} style={{ padding: '0.55rem 0.75rem' }}>
                                  <div style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    padding: '3px 8px', borderRadius: 'var(--radius-sm)',
                                    background: stepRes.success ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                    border: `1px solid ${stepRes.success ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                                    fontSize: '0.74rem'
                                  }}>
                                    <span style={{ fontWeight: 700, color: stepRes.success ? 'var(--success)' : 'var(--danger)' }}>
                                      {stepRes.success ? `HTTP ${stepRes.status || 200}` : `ERR ${stepRes.status || ''}`}
                                    </span>
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>⏱ {stepRes.durationMs || 0}ms</span>
                                  </div>
                                </td>
                              )
                            })}
                            <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              ⏱ {res.totalDurationMs || 0} ms
                            </td>
                            <td style={{ padding: '0.55rem 0.75rem' }}>
                              {res.success ? (
                                <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>✅ PASSED</span>
                              ) : (
                                <span className="badge badge-danger" style={{ fontSize: '0.72rem' }}>❌ FAILED</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════ */}
      {/* SECTION 2: CHAIN EXECUTOR TAB                              */}
      {/* ════════════════════════════════════════════════════════════ */}
      {activeTab === 'executor' && (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Top Saved Chain Dropdown */}
          <div className="card card-p">
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: '1.2rem' }}>▶️</span>
                <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.05rem', fontWeight: 700 }}>
                  Chain Executor
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Select Saved Chain:</span>
                <select
                  className="form-select"
                  style={{ width: 'auto', minWidth: 220, fontSize: '0.85rem' }}
                  value={selectedChainId || 'active_config'}
                  onChange={e => {
                    const cid = e.target.value
                    setSelectedChainId(cid)
                    if (cid !== 'active_config') {
                      const found = chains.find(c => c.id === cid)
                      if (found) loadChainForEdit(found)
                    }
                  }}
                >
                  <option value="active_config">
                    ⚡ Current Chain in Config ({steps.length} {steps.length === 1 ? 'step' : 'steps'})
                  </option>
                  {chains.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.steps?.length || 0} steps)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {execError && (
              <div className="card card-p mb-2 mt-2" style={{ borderColor: 'var(--danger)', background: 'var(--danger-dim)', color: 'var(--danger)', padding: '0.5rem 1rem', fontSize: '0.82rem' }}>
                ❌ {execError}
              </div>
            )}
          </div>

          {/* Executor Configuration Form */}
          <div className="card card-p mb-2">
            <h4 style={{ margin: 0, marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              ⚙️ Executor Configuration
            </h4>

            <div className="grid-3" style={{ gap: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="num-users-input">
                  Number of Users
                </label>
                <input
                  id="num-users-input"
                  type="number"
                  className="form-input"
                  value={numUsers}
                  onChange={e => setNumUsers(Number(e.target.value))}
                  min={1}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  👥 Available users in Data Manager: <strong>{availableUsersCount}</strong>
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="duration-input">
                  Duration (seconds)
                </label>
                <input
                  id="duration-input"
                  type="number"
                  className="form-input"
                  value={duration}
                  onChange={e => setDuration(Number(e.target.value))}
                  min={5}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="arrival-rate-input">
                  Arrival Rate (users / second)
                </label>
                <input
                  id="arrival-rate-input"
                  type="number"
                  className="form-input"
                  value={arrivalRate}
                  onChange={e => setArrivalRate(Number(e.target.value))}
                  min={1}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  Arrival rate = {arrivalRate} creates {arrivalRate} parallel user streams
                </span>
              </div>
            </div>

            <div style={{ marginTop: '1.25rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
              {testStatus.running ? (
                <button
                  className="btn btn-danger btn-lg"
                  onClick={handleStopExecution}
                  disabled={executing}
                >
                  ⏹ Stop Chain Execution
                </button>
              ) : (
                <button
                  className="btn btn-success btn-lg"
                  onClick={handleExecuteChain}
                  disabled={executing || !executorChain}
                  style={{ minWidth: 180 }}
                >
                  {executing ? '⏳ Starting…' : '▶️ Execute Chain Test'}
                </button>
              )}
              {testStatus.running && (
                <span className="badge badge-success animate-pulse" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                  🟢 Chain Test Executing Live...
                </span>
              )}
            </div>
          </div>

          {/* Connected Step Node Flow Visualizer */}
          {executorChain && executorChain.steps?.length > 0 ? (
            <div className="card card-p mb-1">
              <h4 style={{ margin: 0, marginBottom: '0.75rem', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                🔗 Connected Step Node Diagram ({executorChain.name})
              </h4>

              {/* Render parallel streams based on Arrival Rate */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
                {Array.from({ length: Math.min(Math.max(1, Number(arrivalRate) || 1), 6) }).map((_, streamIdx) => (
                  <div key={streamIdx} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {Number(arrivalRate) > 1 && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--accent-light)', fontWeight: 700 }}>
                        ⚡ Parallel User Stream #{streamIdx + 1}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                      {executorChain.steps.map((step, idx) => {
                        const isLastStep = idx === executorChain.steps.length - 1
                        const methodClass = `method-${(step.method || 'GET').toLowerCase()}`

                        // Determine if this step is actively executing during live test
                        const recentStepLog = [...stepLogs].reverse().find(l => testStatus.running)
                        const isExecutingStep = testStatus.running && (
                          recentStepLog?.stepName === step.name ||
                          recentStepLog?.url?.includes(step.endpoint) ||
                          (recentStepLog && idx === 0)
                        )

                        return (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center' }}>
                            {/* Step Node Box */}
                            <div className={`chain-node-box ${isExecutingStep ? 'active-executing' : ''}`}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: 4 }}>
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                                  Step {idx + 1}
                                </span>
                                <span className={`method-badge ${methodClass}`} style={{ fontSize: '0.65rem', padding: '1px 5px' }}>
                                  {step.method || 'GET'}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 160 }}>
                                {step.name || `Step ${idx + 1}`}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--cyan)', fontFamily: 'var(--font-mono)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 160 }}>
                                {step.endpoint}
                              </div>

                              {/* Display executing user email */}
                              {(() => {
                                const matchingLog = [...stepLogs].reverse().find(l => 
                                  l.stepName === step.name ||
                                  (l.url && step.endpoint && l.url.includes(step.endpoint.split('?')[0]))
                                )
                                const userEmail = matchingLog?.student || matchingLog?.studentDetails?.email
                                if (userEmail) {
                                  return (
                                    <div style={{
                                      marginTop: 5,
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      background: 'rgba(99,102,241,0.14)',
                                      border: '1px solid rgba(99,102,241,0.3)',
                                      fontSize: '0.68rem',
                                      color: 'var(--accent-light)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 4,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      maxWidth: 160
                                    }} title={`Executing User: ${userEmail}`}>
                                      <span>👤</span>
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                                        {userEmail}
                                      </span>
                                    </div>
                                  )
                                }
                                return null
                              })()}
                            </div>

                            {/* Connecting Arrow between nodes */}
                            {!isLastStep && (
                              <div style={{ display: 'flex', alignItems: 'center', padding: '0 0.5rem' }}>
                                <svg width="36" height="20" viewBox="0 0 36 20">
                                  <line
                                    x1="0" y1="10" x2="28" y2="10"
                                    stroke={testStatus.running ? 'var(--accent-light)' : 'var(--border)'}
                                    strokeWidth="2"
                                    className={testStatus.running ? 'connecting-arrow-line' : ''}
                                  />
                                  <polygon
                                    points="28,5 35,10 28,15"
                                    fill={testStatus.running ? 'var(--accent-light)' : 'var(--border)'}
                                  />
                                </svg>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card card-p text-center text-muted" style={{ padding: '2rem' }}>
              No chain selected or chain has no steps. Select or build a chain first.
            </div>
          )}

          {/* Live Progress Table (ticker & user matrix) */}
          <div className="card card-p mb-2">
            <LiveProgressTicker
              stepLogs={stepLogs}
              testStatus={testStatus}
              isChainMode={true}
              selectedChain={executorChain}
            />
          </div>

          <div className="card card-p style-glass">
            <RealtimeUserStepTable
              config={config}
              stepLogs={stepLogs}
              setStepLogs={setStepLogs}
              testStatus={testStatus}
              API={API}
              selectedChain={executorChain}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Live Progress Ticker Component ─────────────────────────────
function LiveProgressTicker({ stepLogs, testStatus, isChainMode, selectedChain }) {
  const recentLogs = useMemo(() => {
    return [...stepLogs].reverse().slice(0, 50)
  }, [stepLogs])

  const isEmpty = stepLogs.length === 0

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            🔗 Live Progress
          </h2>
          {testStatus.running ? (
            <span className="badge badge-success flex items-center gap-1" style={{ fontSize: '0.7rem' }}>
              <span className="status-dot running" style={{ width: 6, height: 6 }} /> LIVE
            </span>
          ) : (
            <span className="badge" style={{ fontSize: '0.7rem', background: 'var(--bg-overlay)', color: 'var(--text-muted)' }}>
              {isEmpty ? 'IDLE' : 'COMPLETED'}
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{stepLogs.length} events</span>
      </div>

      {isEmpty ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <div style={{ fontSize: '1.5rem', opacity: 0.3, marginBottom: '0.5rem' }}>📡</div>
          {testStatus.running
            ? 'Waiting for first request to complete…'
            : 'Execute a chain to see live progress here'}
        </div>
      ) : (
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1.6fr 0.7fr',
            gap: '0.5rem',
            padding: '0.5rem 0.75rem',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '0.25rem',
            fontSize: '0.72rem',
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}>
            <span>👤 User</span>
            <span>🌐 API Endpoint</span>
            <span style={{ textAlign: 'right' }}>Status</span>
          </div>

          {recentLogs.map((log, i) => {
            const isSuccess = log.success
            const path = log.url ? extractPath(log.url) : (log.endpoint || '')
            const student = log.student || log.studentDetails?.email || log.vuId || 'Unknown User'

            return (
              <div
                key={i}
                className="progress-ticker-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1.6fr 0.7fr',
                  gap: '0.5rem',
                  padding: '0.45rem 0.75rem',
                  borderBottom: '1px solid var(--border)',
                  fontSize: '0.78rem',
                }}
              >
                <div style={{ color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {student}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.url || path}>
                  <span style={{
                    display: 'inline-block',
                    marginRight: '0.35rem',
                    padding: '1px 5px',
                    borderRadius: 3,
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    background: log.method === 'POST' ? 'rgba(245,158,11,0.2)' : log.method === 'GET' ? 'rgba(16,185,129,0.2)' : 'rgba(99,102,241,0.2)',
                    color: log.method === 'POST' ? '#f59e0b' : log.method === 'GET' ? '#10b981' : '#818cf8',
                  }}>
                    {log.method || 'GET'}
                  </span>
                  {path || log.url || '—'}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {isSuccess ? (
                    <span className="badge badge-success" style={{ fontSize: '0.68rem', padding: '2px 7px' }}>
                      ✅ {log.status || '200'}
                    </span>
                  ) : (
                    <span className="badge badge-danger" style={{ fontSize: '0.68rem', padding: '2px 7px' }}>
                      ❌ {log.status || 'ERR'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function extractPath(urlStr) {
  if (!urlStr) return ''
  try {
    const u = new URL(urlStr)
    return u.pathname + u.search
  } catch {
    return urlStr
  }
}

// ── Realtime User Step Table Component ────────────────────────
function RealtimeUserStepTable({ config, stepLogs, setStepLogs, testStatus, API, selectedChain }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  useEffect(() => {
    let isMounted = true
    if (!testStatus.running) {
      fetch(`${API}/results/students`)
        .then(r => r.json())
        .then(res => {
          if (isMounted && res.success && Array.isArray(res.rawLogs)) {
            setStepLogs(res.rawLogs)
          }
        })
        .catch(() => {})
    }
    return () => { isMounted = false }
  }, [API, testStatus.running, setStepLogs])

  // Derive step columns from selectedChain or stepLogs
  const stepColumns = useMemo(() => {
    if (selectedChain && Array.isArray(selectedChain.steps) && selectedChain.steps.length > 0) {
      return selectedChain.steps.map((s, idx) => ({
        id: s.id || `step_${idx}`,
        name: s.name || `Step ${idx + 1}`,
        method: s.method || 'GET',
        endpoint: s.endpoint || '/api',
        index: idx
      }))
    }
    const uniqueSteps = new Map()
    stepLogs.forEach(l => {
      if (l.stepName && !uniqueSteps.has(l.stepName)) {
        uniqueSteps.set(l.stepName, {
          id: l.stepName,
          name: l.stepName,
          method: l.method || 'GET',
          endpoint: l.url ? extractPath(l.url) : '',
        })
      }
    })
    if (uniqueSteps.size > 0) {
      return Array.from(uniqueSteps.values())
    }
    return [{
      id: 'default_step',
      name: config?.scenarioName || 'Default Request',
      method: config?.method || 'POST',
      endpoint: config?.targetEndpoint || '/api'
    }]
  }, [selectedChain, stepLogs, config])

  const userMap = useMemo(() => {
    const map = {}
    stepLogs.forEach(log => {
      const userKey = log.student || log.studentDetails?.email || log.vuId || 'Unknown VU'
      if (!map[userKey]) {
        map[userKey] = {
          student: userKey,
          vuId: log.vuId,
          stepsByName: {},
          stepsList: [],
          hasFailure: false,
          executedCount: 0,
        }
      }
      map[userKey].stepsByName[log.stepName] = log
      if (log.url) {
        map[userKey].stepsByName[extractPath(log.url)] = log
      }
      map[userKey].stepsList.push(log)
      map[userKey].executedCount++
      if (!log.success) map[userKey].hasFailure = true
    })
    return map
  }, [stepLogs])

  const userList = useMemo(() => {
    let list = Object.values(userMap)
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      list = list.filter(u => u.student.toLowerCase().includes(term))
    }
    if (statusFilter === 'FAILED') list = list.filter(u => u.hasFailure)
    else if (statusFilter === 'SUCCESS') list = list.filter(u => !u.hasFailure && u.executedCount > 0)
    return list
  }, [userMap, searchTerm, statusFilter])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>👥 User Step Execution Matrix</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 2 }}>
            Real-time step execution status per user loaded from Data Manager
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="text"
            className="form-input"
            placeholder="🔍 Search user..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ width: 180, fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
          />
          <select
            className="form-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ width: 'auto', fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
          >
            <option value="ALL">All Users ({userList.length})</option>
            <option value="SUCCESS">✅ Passed Only</option>
            <option value="FAILED">❌ Failed Only</option>
          </select>
        </div>
      </div>

      {userList.length === 0 ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No user execution logs found yet.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                <th style={{ padding: '0.65rem 0.8rem', minWidth: 190 }}>👤 User Email</th>
                {stepColumns.map((col, idx) => (
                  <th key={col.id || idx} style={{ padding: '0.65rem 0.8rem', minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className={`method-badge method-${(col.method || 'GET').toLowerCase()}`} style={{ fontSize: '0.65rem', padding: '1px 5px' }}>
                        {col.method}
                      </span>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{col.name}</span>
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--cyan)', fontFamily: 'var(--font-mono)', marginTop: 2, fontWeight: 400 }}>
                      {col.endpoint}
                    </div>
                  </th>
                ))}
                <th style={{ padding: '0.65rem 0.8rem', minWidth: 110 }}>Overall Status</th>
              </tr>
            </thead>
            <tbody>
              {userList.map((u, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.6rem 0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {u.student}
                  </td>
                  {stepColumns.map((col, colIdx) => {
                    const log = u.stepsByName[col.name]
                      || u.stepsByName[col.endpoint]
                      || u.stepsByName[extractPath(col.endpoint)]
                      || u.stepsList[colIdx]

                    if (!log) {
                      return (
                        <td key={col.id || colIdx} style={{ padding: '0.6rem 0.8rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                          <span style={{ opacity: 0.45 }}>— Pending</span>
                        </td>
                      )
                    }

                    const methodClass = `method-${(log.method || col.method || 'GET').toLowerCase()}`
                    const displayPath = extractPath(log.url || col.endpoint)

                    return (
                      <td key={col.id || colIdx} style={{ padding: '0.6rem 0.8rem' }}>
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          padding: '5px 8px',
                          borderRadius: 'var(--radius-sm)',
                          background: log.success ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                          border: `1px solid ${log.success ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <span className={`method-badge ${methodClass}`} style={{ fontSize: '0.62rem', padding: '1px 4px' }}>
                              {log.method || col.method}
                            </span>
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              color: log.success ? 'var(--success)' : 'var(--danger)'
                            }}>
                              {log.success ? `✅ ${log.status || 200}` : `❌ ${log.status || 'ERR'}`}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--cyan)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                            {displayPath}
                          </div>
                          {log.durationMs != null && (
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                              ⏱ {log.durationMs} ms
                            </div>
                          )}
                        </div>
                      </td>
                    )
                  })}
                  <td style={{ padding: '0.6rem 0.8rem' }}>
                    {u.hasFailure ? (
                      <span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>❌ FAILED</span>
                    ) : (
                      <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>✅ PASSED</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
