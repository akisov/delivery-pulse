import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    proxy: {
      '/data': 'http://localhost:7860',
      '/sync': 'http://localhost:7860',
      '/sync-info': 'http://localhost:7860',
    }
  }
})
