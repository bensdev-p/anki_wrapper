import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API binds to localhost only; devices on the LAN reach it through this
// proxy, so there's a single origin (no CORS) and one port to open.
const api = { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } }

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173, strictPort: true, proxy: api },
  preview: { host: true, port: 4173, strictPort: true, proxy: api },
})
