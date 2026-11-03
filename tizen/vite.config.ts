import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import webos4 from './postcss.webos4.js';

/**
 * Las LG de 2018-2019 (webOS 4.x) llevan Chromium 53, que no sabe lo que es
 * un `<script type="module">`: lo ignora sin decir nada y la app se queda en
 * negro (pasó con una 32LM6380PLC). No es solo sintaxis —que esbuild bajaría—,
 * es el formato del paquete, así que en los modos de LG se compila **dos
 * veces**: el paquete de siempre, como módulo, y otro clásico (`nomodule`, con
 * SystemJS, Babel y los polyfills de core-js que pida el código) que solo
 * cargan los navegadores que no entienden módulos. Una LG con webOS 5 o más
 * carga el módulo como hasta ahora.
 *
 * Solo en `webos` (el paquete de LG) y `tv-webos` (la interfaz que ese paquete
 * se baja del servidor, en /tv-webos/). `/tv/`, Samsung, Fire TV y PS4 no
 * cambian: ni plugin, ni objetivo, ni CSS.
 */
const WEBOS = ['webos', 'tv-webos'];

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(WEBOS.includes(mode) ? [legacy({ targets: ['chrome >= 53'] })] : []),
  ],
  // El CSS no tiene versión «legacy»: es uno para todos, así que en los modos
  // de LG se escribe para Chromium 53 (ver postcss.webos4.js). Sin `postcss`
  // aquí, Vite usa postcss.config.js, que es el de siempre.
  css: WEBOS.includes(mode)
    ? { postcss: { plugins: [tailwindcss(), webos4(), autoprefixer()] } }
    : undefined,
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
    // Fire OS 7 (los Fire TV Stick anteriores a 2023) monta un WebView por
    // Chromium 70, asi que comparte suelo con webOS.
    //
    // La PS4 no lleva Chromium sino WebKit, asi que no vale ningun objetivo
    // `chromeNN`: con el de webOS el paquete sale con sintaxis que la consola
    // no sabe leer y la pagina se queda en blanco. Safari 11 cubre el WebKit
    // de los firmwares que se ven hoy (605 y posteriores); si una consola muy
    // vieja se queda en blanco, baja a safari10.
    //
    // El modo `tv` es el que sirve nginx en /tv/ y lo cargan TODAS las teles,
    // asi que se compila para el suelo de todas ellas (el de webOS 5 y Fire
    // OS 7), no para el de la mas moderna.
    //
    // En los modos de LG el objetivo lo pone plugin-legacy (ver WEBOS): el
    // módulo sale para chrome64 y el clásico para chrome53. El CSS, para
    // chrome53, o esbuild lo minifica con sintaxis de color que no entiende
    // (`#0000001a`).
    target: WEBOS.includes(mode) ? undefined
      : mode === 'ps4' ? 'safari11'
      : mode === 'firetv' || mode === 'tv' ? 'chrome68'
      : 'chrome85',
    cssTarget: WEBOS.includes(mode) ? 'chrome53' : undefined,
  },
  server: {
    proxy: {
      // ws: true tambien para /api: el progreso de descargas va por
      // /api/ws/progress y sin ello en desarrollo nunca llegaba.
      '/api': { target: 'http://localhost:8000', ws: true },
    },
  },
}));
