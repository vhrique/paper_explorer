import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base: './'` for production so the built app loads over file:// inside Electron
// and under a subpath on GitHub Pages. Override with VITE_BASE if a host needs an
// absolute base (e.g. VITE_BASE=/paper_explorer/).
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE || (command === 'build' ? './' : '/'),
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
}))
