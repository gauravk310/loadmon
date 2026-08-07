import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_SERVER_URL || env.SERVER_URL || 'http://localhost:8000'

  return {
    plugins: [react()],
    preview: {
      allowedHosts: true
    },
    server: {
      allowedHosts: true,
      port: 5173,
      proxy: {
        // ── SSE stream — must bypass buffering ──────────────
        '/api/tests/stream': {
          target,
          changeOrigin: true,
          selfHandleResponse: false,
          timeout: 0,
          proxyTimeout: 0,
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              proxyRes.headers['cache-control'] = 'no-cache'
              proxyRes.headers['x-accel-buffering'] = 'no'
            })
          }
        },
        // ── All other API calls ──────────────────────────────
        '/api': {
          target,
          changeOrigin: true,
        }
      }
    }
  }
})
