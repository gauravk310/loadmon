// Base server URL fetched from environment variable with fallback to production backend URL
const rawServerUrl = 
  import.meta.env.VITE_SERVER_URL || 
  import.meta.env.VITE_API_URL || 
  import.meta.env.VITE_BACKEND_URL || 
  'https://loadmon-be.onrender.com'

export const SERVER_URL = rawServerUrl ? rawServerUrl.replace(/\/+$/, '') : ''
export const API = `${SERVER_URL}/api`
