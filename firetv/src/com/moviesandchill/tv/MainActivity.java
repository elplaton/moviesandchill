package com.moviesandchill.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Envoltorio de Fire TV: una sola Activity con un WebView a pantalla completa
 * que carga la misma interfaz de television que Samsung y LG. El codigo de la
 * app no vive aqui, vive en tizen/src; esto solo lo mete en un APK.
 */
public class MainActivity extends Activity {

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
            // El HTML va en el APK (file://) y la API en el servidor (http o
            // https): sin esto el WebView bloquea la mezcla y no carga nada.
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.setBackgroundColor(0xFF000000);
        web.addJavascriptInterface(new Puente(), "AndroidTV");

        // La interfaz de TV mide 1920x1080 fijos y el mando no tiene puntero.
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        setContentView(web);
        pantallaCompleta();
        web.loadUrl("file:///android_asset/index.html");
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
}
