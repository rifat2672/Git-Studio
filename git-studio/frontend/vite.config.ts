import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the frontend runs on :5173 and forwards /api and /ws to the backend on :4317.
const backend = `http://127.0.0.1:${process.env.BACKEND_PORT || 4317}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: backend },
      '/ws': { target: backend.replace('http', 'ws'), ws: true }
    }
  }
})
