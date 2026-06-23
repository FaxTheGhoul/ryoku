package com.ryoku.anime;

import com.getcapacitor.BridgeActivity;
import android.annotation.SuppressLint;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
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
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(
            new StreamExtractorInterface(), "_nativeExtractor"
        );
    }

    @SuppressLint("SetJavaScriptEnabled")
    class StreamExtractorInterface {

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
    }
}
