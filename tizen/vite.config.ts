import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      // Preact ocupa ~3 KB frente a los ~45 KB de React. En la CPU de una TV
      // el tiempo de descarga da igual (el paquete es local) pero el de parse
      // y arranque no. La API es la misma via preact/compat.
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/client': 'preact/compat/client',
      'react/jsx-runtime': 'preact/jsx-runtime',
      'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
    },
  },
  build: {
    // Tizen 6.5 (2022) usa Chromium 85; los modelos de 2024 van por Chromium
    // 108. Se compila para el suelo, no para el techo: con el objetivo por
    // defecto de Vite (chrome87) el paquete salia con sintaxis que una TV
    // anterior a 2022 no sabe leer, y la app quedaba en negro sin avisar.
    target: 'chrome85',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
});
