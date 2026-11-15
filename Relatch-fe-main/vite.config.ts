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

  // 2026-11-15 (V3 port): where V3 is served (src/v3/base.ts). It was '/v3/' while V3 was tested beside the
  // old app; '/' since the flip (step 3.5), when V3 became the app.
  define: {
    __V3_BASE__: JSON.stringify('/'),
  },

  // Keep /*! licence */ comments in the bundle: src/v3/auth adapts MIT code (signup-buddy), whose notice has to
  // ship with it (src/v3/auth/THIRD_PARTY_NOTICES.md).
  esbuild: { legalComments: 'eof' },

  build: {
    chunkSizeWarningLimit: 2000,
    // Since the flip (2026-11-15, step 3.5) only V3 is built: v3.html, which vercel.json serves at every path.
    // The old app's page (index.html -> src/main.tsx, App.tsx) stays in the repo but is NOT built: Vercel
    // serves a real file before any rewrite, so a built index.html would keep answering "/" with the old app.
    // Rollback: Vercel's instant rollback to the deployment before the flip, or revert this commit.
    rollupOptions: {
      input: {
        v3: fileURLToPath(new URL('./v3.html', import.meta.url)),
      },
    },
  }
})
