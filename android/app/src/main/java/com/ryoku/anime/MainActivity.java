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

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Exponer _nativeExtractor al JavaScript de la app
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

                // Configurar WebView background como un navegador real
                WebSettings s = bg.getSettings();
                s.setJavaScriptEnabled(true);
                s.setDomStorageEnabled(true);
                s.setUserAgentString(UA);
                s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                s.setMediaPlaybackRequiresUserGesture(false);
                s.setLoadWithOverviewMode(true);
                s.setUseWideViewPort(true);

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
                            if (done.compareAndSet(false, true)) {
                                final String safe = url
                                    .replace("\\", "\\\\")
                                    .replace("'", "\\'");
                                final WebView main = getBridge().getWebView();
                                mainHandler.post(() -> {
                                    main.evaluateJavascript(
                                        "window._ryokuNativeCb&&window._ryokuNativeCb('"
                                        + callbackId + "','" + safe + "')", null);
                                    bg.destroy();
                                });
                            }
                        }
                        return null;
                    }
                });

                bg.loadUrl(pageUrl);

                // Timeout 18s — resolver con null para caer al servidor REST
                mainHandler.postDelayed(() -> {
                    if (done.compareAndSet(false, true)) {
                        final WebView main = getBridge().getWebView();
                        mainHandler.post(() -> {
                            main.evaluateJavascript(
                                "window._ryokuNativeCb&&window._ryokuNativeCb('"
                                + callbackId + "',null)", null);
                            bg.destroy();
                        });
                    }
                }, 18000);
            });
        }
    }
}
