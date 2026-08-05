import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { API } from '../api.js'

const AppContext = createContext(null)

const STORAGE_KEY = 'loadmon_user_config'

export function AppProvider({ children }) {
  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  const [testStatus, setTestStatus] = useState({ running: false })
  const [liveMetrics, setLiveMetrics] = useState([])
  const [logs, setLogs] = useState([])
  const [lastSummary, setLastSummary] = useState(null)
  const sseRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const intentionalClose = useRef(false)

  // ── Load server defaults if no local config exists ────────
  useEffect(() => {
    if (!config) {
      fetch(`${API}/config`)
        .then(r => r.json())
        .then(d => {
          if (d.success && d.config) {
            setConfig(d.config)
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d.config)) } catch {}
          }
        })
        .catch(console.error)
    }
  }, [config])

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
    })

    es.addEventListener('metrics', e => {
      const data = JSON.parse(e.data)
      setLiveMetrics(prev => [...prev.slice(-120), { ...data, _ts: Date.now() }])
    })

    es.addEventListener('log', e => {
      const data = JSON.parse(e.data)
      setLogs(prev => [...prev.slice(-200), data])
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

  // ── Start test with user's specific config ────────────────
  const startTest = useCallback(async ({ environment = 'custom', phases } = {}) => {
    setLiveMetrics([])
    setLogs([])
    const res = await fetch(`${API}/tests/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment, phases, config })
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
      testStatus, liveMetrics, logs, lastSummary,
      startTest, stopTest,
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
