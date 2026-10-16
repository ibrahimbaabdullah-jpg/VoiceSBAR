import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` runs the Pages Functions on :8788 (wrangler) and the UI on :5173 (Vite).
    proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
