import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
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
    // webOS 5 (LG 2020) va por Chromium 68 y webOS 6 (2021) por 79.
    target: mode === 'webos' ? 'chrome68' : 'chrome85',
  },
  server: {
    proxy: {
      // ws: true tambien para /api: el progreso de descargas va por
      // /api/ws/progress y sin ello en desarrollo nunca llegaba.
      '/api': { target: 'http://localhost:8000', ws: true },
    },
  },
}));
