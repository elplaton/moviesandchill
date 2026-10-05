package com.moviesandchill.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Envoltorio de Fire TV: una sola Activity con un WebView a pantalla completa
 * que carga la misma interfaz de television que Samsung y LG. El codigo de la
 * app no vive aqui, vive en tizen/src; esto solo lo mete en un APK.
 */
public class MainActivity extends Activity {

    static final String TAG = "MoviesChill";

    /**
     * La interfaz NO se carga con file:///android_asset/index.html.
     *
     * Vite empaqueta el bundle como modulo ES (<script type="module">), y un
     * modulo se descarga con las reglas de CORS. Un documento file:// tiene
     * origen opaco ("null"), asi que el navegador bloquea su propio script y
     * la pagina se queda en negro **sin ningun error en pantalla**: el HTML
     * carga, el JS no llega a ejecutarse nunca. En Tizen y webOS no pasa
     * porque sus runtimes abren los permisos de file:// por su cuenta; el
     * WebView de Android no.
     *
     * La salida es darle a la app un origen http de verdad y responder a esas
     * peticiones desde los assets del APK (lo mismo que hace WebViewAssetLoader
     * de androidx, escrito a mano para no arrastrar la dependencia ni Gradle).
     * El dominio es el que androidx reserva para esto: no existe en internet,
     * y de todas formas ninguna peticion llega a salir a la red.
     *
     * Se usa http y no https a proposito: la API tambien va por http en la LAN
     * y asi no hay contenido mixto que justificar.
     */
    private static final String HOST_APP = "appassets.androidplatform.net";
    private static final String URL_INICIO = "http://" + HOST_APP + "/index.html";

    private WebView web;

    /** Puente para que la web pueda cerrar la app: en Android no basta con
     *  window.close(), tiene que terminar la Activity. */
    private class Puente {
        @JavascriptInterface
        public void exit() {
            runOnUiThread(new Runnable() {
                @Override public void run() { finish(); }
            });
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // la sesion vive en localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            // La interfaz va en el APK y la API en el servidor (http o https):
            // sin esto el WebView bloquea la mezcla y no carga nada.
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // Permite abrir chrome://inspect desde el Mac contra la app del Fire
        // TV. Sin esto, depurar la tele es a ciegas: un fallo de JavaScript no
        // deja rastro en ningun sitio.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web.setWebViewClient(new ClienteWeb());
        web.setWebChromeClient(new ClienteChrome());
        web.setBackgroundColor(0xFF141414);
        web.addJavascriptInterface(new Puente(), "AndroidTV");

        // La interfaz de TV mide 1920x1080 fijos y el mando no tiene puntero.
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        setContentView(web);
        pantallaCompleta();
        web.loadUrl(URL_INICIO);
    }

    /** Sin barras del sistema: una app de tele ocupa la pantalla entera. */
    private void pantallaCompleta() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean tieneFoco) {
        super.onWindowFocusChanged(tieneFoco);
        if (tieneFoco) pantallaCompleta();
    }

    /**
     * El boton Atras del mando no llega al WebView como un keydown: se lo
     * queda la Activity. Se reenvia a la web, que ya sabe si toca cerrar un
     * panel, retroceder de pantalla o salir de la app.
     */
    @Override
    public boolean onKeyDown(int codigo, KeyEvent evento) {
        if (codigo == KeyEvent.KEYCODE_BACK) {
            web.evaluateJavascript(
                    "window.__tvBack ? (window.__tvBack(), true) : false", null);
            return true;
        }
        return super.onKeyDown(codigo, evento);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Sin esto el video sigue sonando al salir a la pantalla de inicio.
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        pantallaCompleta();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    // ---------------------------------------------------------------- web

    /**
     * Sirve la interfaz desde los assets del APK bajo un origen http propio, y
     * deja pasar a la red todo lo demas (que es la API del servidor de casa).
     */
    private class ClienteWeb extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest peticion) {
            Uri url = peticion.getUrl();
            if (url == null || !HOST_APP.equals(url.getHost())) return null;
            return desdeAssets(url.getPath());
        }

        @Override
        public void onReceivedError(WebView v, int codigo, String descripcion, String url) {
            Log.e(TAG, "error cargando " + url + ": " + descripcion + " (" + codigo + ")");
        }
    }

    /** Vuelca los console.log de la interfaz a logcat. Es la unica forma de
     *  enterarse de un fallo de JavaScript en una tele sin teclado. */
    private class ClienteChrome extends WebChromeClient {
        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            String linea = m.message() + "  [" + m.sourceId() + ":" + m.lineNumber() + "]";
            if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.e(TAG, linea);
            else Log.i(TAG, linea);
            return true;
        }
    }

    /**
     * Devuelve un asset del APK como respuesta http. Un modulo ES solo se
     * ejecuta si llega con un tipo MIME de JavaScript: servir un .js como
     * application/octet-stream lo rechaza igual que no servirlo.
     */
    private WebResourceResponse desdeAssets(String ruta) {
        if (ruta == null || ruta.isEmpty() || "/".equals(ruta)) ruta = "/index.html";
        String nombre = ruta.startsWith("/") ? ruta.substring(1) : ruta;

        Map<String, String> cabeceras = new HashMap<String, String>();
        cabeceras.put("Cache-Control", "no-store");

        try {
            InputStream datos = getAssets().open(nombre);
            return new WebResourceResponse(tipoMime(nombre), "utf-8", 200, "OK", cabeceras, datos);
        } catch (IOException e) {
            // El navegador pide /favicon.ico por su cuenta y la app no tiene:
            // es un 404 normal, no hace falta gritarlo en el registro.
            if (!"favicon.ico".equals(nombre)) Log.e(TAG, "no esta en el APK: " + nombre);
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    cabeceras, new ByteArrayInputStream(new byte[0]));
        }
    }

    private static String tipoMime(String nombre) {
        if (nombre.endsWith(".html")) return "text/html";
        if (nombre.endsWith(".js") || nombre.endsWith(".mjs")) return "text/javascript";
        if (nombre.endsWith(".css")) return "text/css";
        if (nombre.endsWith(".json")) return "application/json";
        if (nombre.endsWith(".svg")) return "image/svg+xml";
        if (nombre.endsWith(".png")) return "image/png";
        if (nombre.endsWith(".webp")) return "image/webp";
        if (nombre.endsWith(".jpg") || nombre.endsWith(".jpeg")) return "image/jpeg";
        if (nombre.endsWith(".ico")) return "image/x-icon";
        if (nombre.endsWith(".woff2")) return "font/woff2";
        if (nombre.endsWith(".woff")) return "font/woff";
        if (nombre.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }
}
