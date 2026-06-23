package com.ryoku.anime;

import com.getcapacitor.BridgeActivity;
import android.annotation.SuppressLint;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.view.WindowCompat;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends BridgeActivity {

    private static final String UA =
        "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // JS para activar el player una vez que cargó la página
    private static final String TRIGGER_JS =
        "(function(){" +
        "  try{ jwplayer().play() }catch(e){}" +
        "  document.querySelectorAll('video').forEach(function(v){" +
        "    try{ v.play() }catch(e){}" +
        "  });" +
        "  document.querySelectorAll('[class*=play],[id*=play],button').forEach(function(b){" +
        "    try{ b.click() }catch(e){}" +
        "  });" +
        "})()";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Edge-to-edge: el WebView se extiende detrás de status bar y nav bar.
        // Sin esto, inset:0 en CSS solo cubre el área sin las barras del sistema
        // y queda el espacio vacío en los lados en landscape.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(
            new StreamExtractorInterface(), "_nativeExtractor"
        );
    }

    @SuppressLint("SetJavaScriptEnabled")
    class StreamExtractorInterface {

        // ── Extracción de streams ────────────────────────────────────────────────
        @JavascriptInterface
        public void extractStream(final String pageUrl, final String callbackId) {
            mainHandler.post(() -> {
                final WebView bg = new WebView(MainActivity.this);
                final AtomicBoolean done = new AtomicBoolean(false);

                WebSettings ws = bg.getSettings();
                ws.setJavaScriptEnabled(true);
                ws.setDomStorageEnabled(true);
                ws.setUserAgentString(UA);
                ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                ws.setMediaPlaybackRequiresUserGesture(false);
                ws.setLoadWithOverviewMode(true);
                ws.setUseWideViewPort(true);

                bg.setWebViewClient(new WebViewClient() {

                    @Override
                    public WebResourceResponse shouldInterceptRequest(
                            WebView view, WebResourceRequest request) {
                        if (done.get()) return null;

                        String url = request.getUrl().toString();
                        String ul  = url.toLowerCase();

                        boolean isM3u8 = ul.contains(".m3u8");
                        boolean isMp4  = ul.contains(".mp4")
                                      && !ul.endsWith(".html")
                                      && !ul.contains("thumb")
                                      && !ul.contains("poster")
                                      && !ul.contains("preview");

                        if (isM3u8 || isMp4) {
                            sendResult(url);
                        }
                        return null;
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        // Activar el player una vez cargada la página
                        if (!done.get()) {
                            view.evaluateJavascript(TRIGGER_JS, null);
                        }
                    }

                    private void sendResult(String streamUrl) {
                        if (!done.compareAndSet(false, true)) return;
                        final String safe = streamUrl
                            .replace("\\", "\\\\")
                            .replace("'", "\\'");
                        final WebView main = getBridge().getWebView();
                        mainHandler.post(() -> {
                            main.evaluateJavascript(
                                "window._ryokuNativeCb&&window._ryokuNativeCb('"
                                + callbackId + "','" + safe + "')", null);
                            bg.stopLoading();
                            bg.destroy();
                        });
                    }
                });

                bg.loadUrl(pageUrl);

                // Timeout 20s — caer al servidor REST como fallback
                mainHandler.postDelayed(() -> {
                    if (!done.compareAndSet(false, true)) return;
                    final WebView main = getBridge().getWebView();
                    mainHandler.post(() -> {
                        main.evaluateJavascript(
                            "window._ryokuNativeCb&&window._ryokuNativeCb('"
                            + callbackId + "',null)", null);
                        bg.stopLoading();
                        bg.destroy();
                    });
                }, 20000);
            });
        }

        // ── Control de pantalla completa nativa ──────────────────────────────────
        // Llamado desde JS al entrar en pantalla completa del reproductor.
        // Rota a landscape Y oculta status bar + barra de nav del sistema.
        @JavascriptInterface
        public void enterFullscreen() {
            mainHandler.post(() -> {
                // Rotar a landscape
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

                // Modo inmersivo: ocultar status bar y nav bar del sistema
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    android.view.WindowInsetsController wic =
                        getWindow().getInsetsController();
                    if (wic != null) {
                        wic.hide(android.view.WindowInsets.Type.systemBars());
                        wic.setSystemBarsBehavior(
                            android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                        );
                    }
                } else {
                    //noinspection deprecation
                    getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    );
                }
            });
        }

        // Llamado desde JS al salir de pantalla completa.
        // Devuelve orientación libre y restaura las barras del sistema.
        @JavascriptInterface
        public void exitFullscreen() {
            mainHandler.post(() -> {
                // Volver a orientación libre
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);

                // Restaurar barras del sistema
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    android.view.WindowInsetsController wic =
                        getWindow().getInsetsController();
                    if (wic != null) {
                        wic.show(android.view.WindowInsets.Type.systemBars());
                    }
                } else {
                    //noinspection deprecation
                    getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_VISIBLE
                    );
                }
            });
        }
    }
}
