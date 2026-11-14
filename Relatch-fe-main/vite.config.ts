import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // 2026-11-15 (V3 port): the V3 code imports shared modules as '@/...' (same mapping as tsconfig.json).
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  // 2026-11-15 (V3 port): where V3 is served (src/v3/base.ts). '/v3/' while it is tested beside the current
  // app; set to '/' at the flip. The current app (index.html) does not read it.
  define: {
    __V3_BASE__: JSON.stringify('/v3/'),
  },

  // Keep /*! licence */ comments in the bundle: src/v3/auth adapts MIT code (signup-buddy), whose notice has to
  // ship with it (src/v3/auth/THIRD_PARTY_NOTICES.md).
  esbuild: { legalComments: 'eof' },

  build: {
    chunkSizeWarningLimit: 2000,
    // Two pages: the current app (index.html, served at /) and V3 (v3.html, served at /v3 by vercel.json)
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        v3: fileURLToPath(new URL('./v3.html', import.meta.url)),
      },
    },
  }
})
