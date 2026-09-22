import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// La PWA se sirve bajo /m/ en el mismo nginx que la web de escritorio.
export default defineConfig({
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
