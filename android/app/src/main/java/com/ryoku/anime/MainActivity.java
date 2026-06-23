package com.ryoku.anime;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Interceptar requests de red del WebView para capturar URLs de video
        // de iframes ocultos usados por el extractor cliente
        WebView webView = getBridge().getWebView();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                String urlLower = url.toLowerCase();

                // Detectar URLs de video: .m3u8 o .mp4 que no sean thumbnails/html
                boolean isM3u8 = urlLower.contains(".m3u8");
                boolean isMp4  = urlLower.contains(".mp4")
                               && !urlLower.endsWith(".html")
                               && !urlLower.contains("thumb")
                               && !urlLower.contains("poster")
                               && !urlLower.contains("preview");

                if (isM3u8 || isMp4) {
                    // Escapar la URL para inyectarla en JS de forma segura
                    final String safeUrl = url.replace("\\", "\\\\").replace("'", "\\'");
                    // Llamar a la función JS que está esperando la URL
                    view.post(() -> view.evaluateJavascript(
                        "(function(){ if(typeof window._ryokuStreamCapture==='function') window._ryokuStreamCapture('" + safeUrl + "') })()",
                        null
                    ));
                }

                return super.shouldInterceptRequest(view, request);
            }
        });
    }
}
