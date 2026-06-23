package com.ryoku.anime;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();

        // Extender BridgeWebViewClient para no romper el routing de Capacitor
        webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // Dejar que Capacitor maneje primero sus rutas internas
                WebResourceResponse response = super.shouldInterceptRequest(view, request);

                String url = request.getUrl().toString();
                String urlLower = url.toLowerCase();

                boolean isM3u8 = urlLower.contains(".m3u8");
                boolean isMp4  = urlLower.contains(".mp4")
                               && !urlLower.endsWith(".html")
                               && !urlLower.contains("thumb")
                               && !urlLower.contains("poster")
                               && !urlLower.contains("preview");

                if (isM3u8 || isMp4) {
                    final String safeUrl = url.replace("\\", "\\\\").replace("'", "\\'");
                    view.post(() -> view.evaluateJavascript(
                        "(function(){ if(typeof window._ryokuStreamCapture==='function') window._ryokuStreamCapture('" + safeUrl + "') })()",
                        null
                    ));
                }

                return response;
            }
        });
    }
}
