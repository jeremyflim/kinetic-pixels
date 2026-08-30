import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/kinetic-pixels/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'] },
  },
})
