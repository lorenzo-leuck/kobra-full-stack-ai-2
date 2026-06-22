import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const usePolling = !!(globalThis as any).process?.env?.VITE_USE_POLLING

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    watch: usePolling ? { usePolling: true, interval: 150 } : undefined,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      '/signal': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/agent': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/webrtc': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/whisper': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})