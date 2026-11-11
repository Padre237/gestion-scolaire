import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Application web installable (PWA) ; l'API Node.js est servie sur la même origine.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8443', changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 2000 },
});
