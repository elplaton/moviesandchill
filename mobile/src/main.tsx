import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { LibraryProvider } from './contexts/LibraryContext';
import './index.css';

// Actualizacion silenciosa: cada compilacion lleva un sw.js distinto; al
// instalarse toma el control (skipWaiting + claim) y aqui se recarga la
// pagina una vez, sin avisar. Ademas se comprueba al volver a la app.
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', async () => {
    try {
      // La version va en la URL: para el navegador "sw.js?v=A" y "sw.js?v=B"
      // son service workers distintos, asi que cada compilacion se instala
      // sola sin depender de que cambie el contenido del archivo.
      const reg = await navigator.serviceWorker.register(`/m/sw.js?v=${__BUILD__}`, { scope: '/m/' });
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 30 * 60 * 1000);
    } catch { /* sin SW */ }
  });
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) window.location.reload();
    hadController = true;
  });
}

/**
 * Alto real de lo que se ve en pantalla.
 *
 * En Safari de iPhone la barra del navegador se pliega al desplazar: el
 * viewport visible cambia de alto y ninguna unidad CSS lo sigue bien (dvh
 * baila, svh se queda corto). Se mide con la Visual Viewport API y se publica
 * en --app-h, que es lo que usa .app-shell.
 */
function trackViewportHeight() {
  const vv = window.visualViewport;
  const apply = () => {
    const h = vv?.height ?? window.innerHeight;
    // El armazon es `position: fixed`, o sea que se coloca respecto al
    // viewport de maquetacion, mientras que el alto medido es el del viewport
    // visible. Cuando Safari pliega o despliega sus barras los dos dejan de
    // coincidir y el armazon quedaba corto: por debajo de la barra de
    // pestañas asomaba el fondo de la pagina. `offsetTop` es la diferencia.
    const top = vv?.offsetTop ?? 0;
    const root = document.documentElement;
    root.style.setProperty('--app-h', `${Math.round(h)}px`);
    root.style.setProperty('--app-top', `${Math.round(top)}px`);
  };
  apply();
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 250));
}
trackViewportHeight();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/m">
      <AuthProvider>
        <LibraryProvider>
          <App />
        </LibraryProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
