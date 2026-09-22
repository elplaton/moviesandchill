import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { FocusRoot } from './focus/react';
import { startRemoteConsole } from './debug/remote';
import './index.css';

// Fuera de la TV (navegador de escritorio) conviene ver el cursor.
if (!/Tizen|SMART-TV|SmartTV/i.test(navigator.userAgent)) document.body.classList.add('has-pointer');

// La interfaz mide 1920x1080 fijos. En un navegador de escritorio mas pequeño
// se escala entera para poder revisarla sin una tele delante.
function fitToWindow() {
  const root = document.getElementById('root');
  if (!root) return;
  const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080, 1);
  root.style.transformOrigin = '0 0';
  root.style.transform = k < 1 ? `scale(${k})` : '';
}
if (import.meta.env.DEV) {
  fitToWindow();
  window.addEventListener('resize', fitToWindow);
}

// Sin VITE_DEBUG_HOST la condicion es constante-falsa y Vite elimina el modulo
// entero del paquete: las compilaciones normales no llevan consola remota.
if (import.meta.env.VITE_DEBUG_HOST) startRemoteConsole();

// Sin StrictMode: en desarrollo monta y desmonta cada efecto dos veces, lo que
// con un motor de foco imperativo confunde mas de lo que ayuda. En produccion
// no hacia nada de todos modos.
// HashRouter y no BrowserRouter: dentro del .wgt la app se sirve desde
// file:///, asi que pushState a una ruta absoluta deja la URL en "file:///" y
// la webview responde ERR_ACCESS_DENIED. Con el hash la navegacion se queda
// dentro de index.html.
ReactDOM.createRoot(document.getElementById('app')!).render(
  <HashRouter>
    <AuthProvider>
      <FocusRoot>
        <App />
      </FocusRoot>
    </AuthProvider>
  </HashRouter>
);
