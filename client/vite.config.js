import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/art': 'http://localhost:3001',   // card artwork from the server's art/ folder
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      }
    }
  },
  build: {
    outDir: 'dist',
  }
})
