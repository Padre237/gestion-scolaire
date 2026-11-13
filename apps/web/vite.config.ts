import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Application web installable (PWA) ; l'API Node.js est servie sur la même origine.
export default defineConfig({
  plugins: [react(), {
    // Chaque construction estampille le service worker : le téléphone voit qu'une nouvelle version existe (D-50).
    name: 'version-service-worker',
    closeBundle() {
      const f = resolve(__dirname, 'dist/sw.js');
      try { writeFileSync(f, readFileSync(f, 'utf8').replace('__VERSION__', Date.now().toString(36))); } catch { /* pas de dist en développement */ }
    },
  }],
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 2000 },
});
