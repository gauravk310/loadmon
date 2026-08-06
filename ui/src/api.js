const isLocal = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const defaultUrl = isLocal ? 'http://localhost:8000' : 'https://loadmon-be.onrender.com';

const rawServerUrl = 
  import.meta.env.VITE_SERVER_URL || 
  import.meta.env.VITE_API_URL || 
  import.meta.env.VITE_BACKEND_URL || 
  defaultUrl;

export const SERVER_URL = rawServerUrl ? rawServerUrl.replace(/\/+$/, '') : '';
export const API = `${SERVER_URL}/api`;
