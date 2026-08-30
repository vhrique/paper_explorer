import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base: './'` for production so the built app loads over file:// inside Electron.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
}))
