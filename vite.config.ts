import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { assistantApi } from './server/assistant/plugin.ts'

export default defineConfig(({ mode }) => {
  // Lê .env / .env.local SEM o prefixo VITE_: a chave fica só no servidor, nunca no bundle
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      assistantApi({ apiKey: env.GEMINI_API_KEY || undefined, model: env.GEMINI_MODEL || 'gemini-3.5-flash' }),
    ],
    base: './',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: (id: string) => {
            if (id.includes('node_modules/three')) return 'three'
            if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) return 'echarts'
            return undefined
          },
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    },
  }
})
