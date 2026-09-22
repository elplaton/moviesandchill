import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { FocusRoot } from './focus/react';
import { startRemoteConsole } from './debug/remote';
import './index.css';

// Fuera de la TV (navegador de escritorio) conviene ver el cursor.
if (!/Tizen|SMART-TV|SmartTV/i.test(navigator.userAgent)) document.body.classList.add('has-pointer');

// La interfaz mide 1920x1080 fijos. Si la ventana (o la tele: algun modelo
// usa 1280x720) no mide eso, se escala entera y se centra, con bandas negras
// alrededor: asi el video y la ficha ocupan siempre todo el lienzo y lo que
// sobra se ve como el marco de una tele, no como un lateral gris.
function fitToWindow() {
  const root = document.getElementById('root');
  if (!root) return;
  const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const x = Math.max(0, (window.innerWidth - 1920 * k) / 2);
  const y = Math.max(0, (window.innerHeight - 1080 * k) / 2);
  root.style.transformOrigin = '0 0';
  root.style.transform = Math.abs(k - 1) < 0.001 && x < 1 && y < 1 ? '' : `translate(${x}px, ${y}px) scale(${k})`;
}
fitToWindow();
window.addEventListener('resize', fitToWindow);

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
