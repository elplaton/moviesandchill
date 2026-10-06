// Primero de todo: en la PS4 falta flatMap y el modulo que lo usa se carga
// antes de que React pinte nada.
import './tv/polyfills';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { FocusRoot } from './focus/react';
import { startRemoteConsole } from './debug/remote';
import { plataforma, soloPuntero, tienePuntero } from './tv/platform';
import './index.css';

// Solo Tizen (mando sin puntero) oculta el cursor. En LG el Magic Remote es
// un puntero de verdad que se dibuja como cursor CSS: ocultarlo lo dejaria ciego,
// y en la PlayStation el cursor lo mueve el stick.
if (tienePuntero()) document.body.classList.add('has-pointer');
// Donde el puntero es lo unico que hay, la app dibuja los botones que en una
// tele estan en el mando (volver, pausa, saltos); quien lo decide es
// soloPuntero(). La clase y el atributo quedan en el <html> para poder
// apuntar a este caso desde el CSS y para ver en que aparato se esta sin
// tener que leer el user agent a mano cuando algo no cuadra.
if (soloPuntero()) document.documentElement.classList.add('solo-puntero');
document.documentElement.setAttribute('data-plataforma', plataforma());

// La interfaz mide 1920x1080 fijos. Si la ventana (o la tele: algun modelo
// usa 1280x720) no mide eso, se escala entera y se centra, con bandas negras
// alrededor: asi el video y la ficha ocupan siempre todo el lienzo y lo que
// sobra se ve como el marco de una tele, no como un lateral gris.
//
// Lo que se mide NO puede ser solo `innerWidth`. En el Fire TV Stick la
// pantalla son 1920x1080 fisicos pero la densidad es 320 dpi, asi que para la
// pagina mide 960x540 px CSS. Como el lienzo es de 1920 fijos, el WebView
// **ensancha el viewport de maquetado** hasta que quepa el contenido: a partir
// de ahi `innerWidth` vale 1920 (el ancho del lienzo, no el de la tele),
// `k` sale 1, no se escala nada y la app se dibuja al doble de tamaño, de la
// que solo se ve el cuarto de arriba a la izquierda.
//
// Lo que de verdad se ve es el *viewport visual*. Se toma el menor de los dos:
// donde no hay nada raro valen lo mismo (Tizen, LG, el navegador), y donde el
// maquetado se ha estirado manda el visual. Es estable: al escalar a 0.5 el
// contenido deja de desbordar, los dos viewports se igualan en 960 y `k` sigue
// saliendo 0.5. La PS4 lleva un WebKit sin `visualViewport`, de ahi el
// respaldo.
function fitToWindow() {
  const root = document.getElementById('root');
  if (!root) return;
  const vv = window.visualViewport;
  const ancho = vv ? Math.min(window.innerWidth, vv.width) : window.innerWidth;
  const alto = vv ? Math.min(window.innerHeight, vv.height) : window.innerHeight;
  const k = Math.min(ancho / 1920, alto / 1080);
  const x = Math.max(0, (ancho - 1920 * k) / 2);
  const y = Math.max(0, (alto - 1080 * k) / 2);
  root.style.transformOrigin = '0 0';
  root.style.transform = Math.abs(k - 1) < 0.001 && x < 1 && y < 1 ? '' : `translate(${x}px, ${y}px) scale(${k})`;
}
fitToWindow();
window.addEventListener('resize', fitToWindow);
window.visualViewport?.addEventListener('resize', fitToWindow);

// Sin VITE_DEBUG_HOST la condicion es constante-falsa y Vite elimina el modulo
// entero del paquete: las compilaciones normales no llevan consola remota.
if (import.meta.env.VITE_DEBUG_HOST) startRemoteConsole();

/**
 * La app se actualiza sola: si el servidor tiene la interfaz, se carga de ahi.
 *
 * Las apps de television se instalan a mano (un .wgt por Tizen Studio, un .ipk
 * con ares-install, un .apk por adb), asi que cada arreglo obligaba a
 * levantarse del sofa. Con esto el paquete instalado es **solo el arranque**:
 * comprueba si el servidor sirve `/tv/` y le pasa el control, de modo que al
 * abrir la tele ya esta la ultima version. Solo hay que reinstalar el paquete
 * si cambia la parte nativa.
 *
 * Tres detalles que lo hacen seguro:
 *
 * - **La direccion sale de `VITE_API_BASE`**, que es la del servidor y ya va
 *   dentro de cada paquete. La version servida se compila sin ella (ver
 *   `.env.tv`), asi que no se reenvia a si misma y no hay bucle. La
 *   comparacion con la URL actual es el cinturon de seguridad por si alguien
 *   compila `/tv/` con la direccion puesta.
 * - **Si el servidor no contesta en un segundo y medio, se sigue con la copia
 *   del paquete.** Puede estar vieja, pero una interfaz vieja que funciona es
 *   mejor que una pantalla en negro; y en una LAN un segundo y medio es
 *   eternidad.
 * - **No se monta React antes de decidir.** Arrancar la app para tirarla a
 *   continuacion se veria como un parpadeo, y en una tele lenta como un
 *   arranque doble.
 *
 * Ojo: al pasar de la copia empaquetada a la servida cambia el origen, y la
 * sesion se guarda por origen. Hay que entrar una vez mas, solo la primera.
 */
function urlDelServidor(): string | null {
  const base = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
  if (!base) return null;
  const destino = `${base}/tv/`;
  // Ya estamos ahi: no hay nada que hacer (y desde luego no recargar).
  if (window.location.href.indexOf(destino) === 0) return null;
  return destino;
}

function montar() {
  ReactDOM.createRoot(document.getElementById('app')!).render(
    <HashRouter>
      <AuthProvider>
        <FocusRoot>
          <App />
        </FocusRoot>
      </AuthProvider>
    </HashRouter>
  );
}

function arrancar() {
  const destino = urlDelServidor();
  if (!destino) { montar(); return; }

  let decidido = false;
  const seguirAqui = () => { if (!decidido) { decidido = true; montar(); } };
  const reloj = setTimeout(seguirAqui, 1500);

  // XMLHttpRequest y no fetch: el WebView de webOS 5 va por Chromium 68 y
  // AbortController para cortar un fetch no esta en todos los suelos.
  const peticion = new XMLHttpRequest();
  peticion.open('GET', `${destino}index.html?v=${Date.now()}`, true);
  peticion.timeout = 1500;
  peticion.onload = () => {
    clearTimeout(reloj);
    if (decidido) return;
    decidido = true;
    // 200 y algo que parezca la app: un portal cautivo o el 404 de otro
    // servidor devuelven 200 con cualquier cosa.
    if (peticion.status === 200 && peticion.responseText.indexOf('<div id="app"') >= 0) {
      window.location.replace(destino);
      return;
    }
    montar();
  };
  peticion.onerror = () => { clearTimeout(reloj); seguirAqui(); };
  peticion.ontimeout = () => { clearTimeout(reloj); seguirAqui(); };
  try {
    peticion.send();
  } catch {
    clearTimeout(reloj);
    seguirAqui();
  }
}

// Sin StrictMode: en desarrollo monta y desmonta cada efecto dos veces, lo que
// con un motor de foco imperativo confunde mas de lo que ayuda. En produccion
// no hacia nada de todos modos.
// HashRouter y no BrowserRouter: dentro del .wgt la app se sirve desde
// file:///, asi que pushState a una ruta absoluta deja la URL en "file:///" y
// la webview responde ERR_ACCESS_DENIED. Con el hash la navegacion se queda
// dentro de index.html.
arrancar();
