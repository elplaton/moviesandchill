import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// La PWA se sirve bajo /m/ en el mismo nginx que la web de escritorio.
// Marca de compilacion: identifica esta version ante el service worker.
const BUILD = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [react()],
  base: '/m/',
  build: { target: 'es2019' },
  server: {
    port: 5175,
    proxy: {
      '/api': { target: 'http://localhost:8000', ws: true },
    },
  },
});
