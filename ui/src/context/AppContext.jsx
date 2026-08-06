import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { API } from '../api.js'

const AppContext = createContext(null)

const STORAGE_KEY = 'loadmon_user_config'

export function AppProvider({ children }) {
  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return null
      const parsed = JSON.parse(saved)
      if (parsed) delete parsed.steps
      return parsed
    } catch {
      return null
    }
  })

  const [testStatus, setTestStatus] = useState({ running: false })
  const [liveMetrics, setLiveMetrics] = useState([])
  const [logs, setLogs] = useState([])
  const [stepLogs, setStepLogs] = useState([])
  const [lastSummary, setLastSummary] = useState(null)

  // ── Chain state ───────────────────────────────────────────
  const [chains, setChains] = useState([])
  const [selectedChainId, setSelectedChainId] = useState(null)

  const sseRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const intentionalClose = useRef(false)

  // ── Always sync config from backend server ────────────────
  useEffect(() => {
    fetch(`${API}/config`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.config) {
          const cleanConfig = { ...d.config, steps: [] }
          setConfig(cleanConfig)
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanConfig)) } catch {}
        }
      })
      .catch(console.error)
  }, [])

  // ── Load chains from backend ──────────────────────────────
  const fetchChains = useCallback(async () => {
    try {
      const res = await fetch(`${API}/chains`)
      const data = await res.json()
      if (data.success && Array.isArray(data.chains)) {
        setChains(data.chains)
      }
    } catch (e) {
      console.error('Failed to fetch chains:', e)
    }
  }, [])

  useEffect(() => { fetchChains() }, [fetchChains])

  const saveChain = useCallback(async (chainData) => {
    const res = await fetch(`${API}/chains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chainData)
    })
    const data = await res.json()
    if (data.success) {
      await fetchChains()
    }
    return data
  }, [fetchChains])

  const deleteChain = useCallback(async (chainId) => {
    const res = await fetch(`${API}/chains/${chainId}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.success) {
      await fetchChains()
      if (selectedChainId === chainId) setSelectedChainId(null)
    }
    return data
  }, [fetchChains, selectedChainId])

  // ── SSE connection ────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
    }

    intentionalClose.current = false
    const es = new EventSource(`${API}/tests/stream`)
    sseRef.current = es

    es.addEventListener('status', e => {
      const data = JSON.parse(e.data)
      setTestStatus(data)
      if (data.type === 'started') {
        setStepLogs([])
      }
    })

    es.addEventListener('metrics', e => {
      const data = JSON.parse(e.data)
      setLiveMetrics(prev => [...prev.slice(-120), { ...data, _ts: Date.now() }])
    })

    es.addEventListener('log', e => {
      const data = JSON.parse(e.data)
      setLogs(prev => [...prev.slice(-200), data])
    })

    es.addEventListener('stepLog', e => {
      const data = JSON.parse(e.data)
      setStepLogs(prev => [...prev, data])
    })

    es.addEventListener('summary', e => {
      const data = JSON.parse(e.data)
      setLastSummary(data)
    })

    es.onerror = () => {
      if (intentionalClose.current) return
      if (!reconnectTimerRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          connectSSE()
        }, 3000)
      }
    }
  }, [])

  useEffect(() => {
    connectSSE()
    return () => {
      intentionalClose.current = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      sseRef.current?.close()
    }
  }, [connectSSE])

  // ── Save user config to localStorage & sync server ────────
  const saveConfig = useCallback(async (updates) => {
    const merged = { ...(config || {}), ...updates }
    setConfig(merged)

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    } catch (e) {
      console.error('Failed to save user config to localStorage:', e)
    }

    // Sync to backend asynchronously
    fetch(`${API}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    }).catch(() => {})

    return { success: true, config: merged }
  }, [config])

  // ── Start test — supports simple and chain modes ──────────
  const startTest = useCallback(async ({ environment = 'custom', phases, chain } = {}) => {
    setLiveMetrics([])
    setLogs([])
    setStepLogs([])
    const body = { environment, phases, config }
    if (chain) {
      body.chain = chain
    }
    const res = await fetch(`${API}/tests/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return res.json()
  }, [config])

  const stopTest = useCallback(async () => {
    const res = await fetch(`${API}/tests/stop`, { method: 'POST' })
    return res.json()
  }, [])

  return (
    <AppContext.Provider value={{
      config, setConfig, saveConfig,
      testStatus, liveMetrics, logs, stepLogs, setStepLogs, lastSummary,
      startTest, stopTest,
      chains, selectedChainId, setSelectedChainId,
      saveChain, deleteChain, fetchChains,
      API
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
