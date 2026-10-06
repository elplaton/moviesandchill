import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { LibraryProvider } from './contexts/LibraryContext';
import { FavoritesProvider } from './contexts/FavoritesContext';
import { FollowsProvider } from './contexts/FollowsContext';
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
  const root = document.documentElement;

  // Instalada en la pantalla de inicio no hay barras de navegador que se
  // plieguen, asi que no hay nada que medir. Y medir hacia falta no hacia:
  // en iOS, `visualViewport.height` viene ya SIN la franja del indicador de
  // inicio, de modo que el armazon quedaba unos 60 px corto y la barra de
  // pestañas flotaba por encima del borde; encima la barra se aparta otra vez
  // esa misma franja con su `padding-bottom`, asi que los iconos subian el
  // doble. Con 100dvh el armazon llega al borde real y el padding hace lo
  // unico que tiene que hacer: dejar los iconos por encima del indicador.
  const instalada = window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (instalada) {
    // Instalada el armazon no se mide: se ancla arriba y abajo y ocupa la
    // pantalla entera (lo hace el CSS con esta clase). Medir no servia:
    // en un iPhone 16 Pro la pantalla son 874 px y innerHeight dice 812,
    // porque descuenta la franja del reloj de ARRIBA; pero con
    // viewport-fit=cover la pagina pinta de borde a borde, asi que usar ese
    // alto dejaba el armazon 62 px corto por abajo y la barra de pestañas
    // se iba con el.
    root.classList.add('instalada');
    root.style.removeProperty('--app-h');
    root.style.setProperty('--app-top', '0px');
    return;
  }

  const vv = window.visualViewport;
  const apply = () => {
    const h = vv?.height ?? window.innerHeight;
    // El armazon es `position: fixed`, o sea que se coloca respecto al
    // viewport de maquetacion, mientras que el alto medido es el del viewport
    // visible. Cuando Safari pliega o despliega sus barras los dos dejan de
    // coincidir y el armazon quedaba corto: por debajo de la barra de
    // pestañas asomaba el fondo de la pagina. `offsetTop` es la diferencia.
    const top = vv?.offsetTop ?? 0;
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
          <FavoritesProvider>
            <FollowsProvider>
              <App />
            </FollowsProvider>
          </FavoritesProvider>
        </LibraryProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
