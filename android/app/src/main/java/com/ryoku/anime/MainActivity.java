package com.ryoku.anime;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import android.annotation.SuppressLint;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.view.WindowCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

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

        // Permitir ventanas emergentes — necesario para Firebase signInWithPopup (login Google)
        getBridge().getWebView().getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
        getBridge().getWebView().getSettings().setSupportMultipleWindows(true);

        // Google OAuth rechaza el flujo en WebViews identificados con "wv" en el UA.
        // Eliminarlo hace que el servidor de Google lo trate como Chrome móvil normal.
        String ua = getBridge().getWebView().getSettings().getUserAgentString();
        ua = ua.replace("; wv)", ")").replace("; wv;", ";");
        getBridge().getWebView().getSettings().setUserAgentString(ua);

        getBridge().getWebView().addJavascriptInterface(
            new StreamExtractorInterface(), "_nativeExtractor"
        );

        // Precargar latanime.org en background para que Chromium resuelva el
        // challenge de Cloudflare y guarde cf_clearance en el CookieManager compartido.
        // Arranca inmediatamente — no esperamos para que el banner tenga la cookie lo antes posible.
        mainHandler.post(() -> {
            final WebView preloader = new WebView(MainActivity.this);
            WebSettings pws = preloader.getSettings();
            pws.setJavaScriptEnabled(true);
            pws.setDomStorageEnabled(true);
            pws.setUserAgentString(UA);
            preloader.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    // onPageFinished puede disparar ANTES de que el challenge JS de Cloudflare
                    // termine. Polling cada 500ms hasta detectar cf_clearance (max 20s).
                    new Runnable() {
                        int waits = 0;
                        @Override public void run() {
                            String cookies = android.webkit.CookieManager.getInstance()
                                .getCookie("https://latanime.org/");
                            if (cookies != null && cookies.contains("cf_clearance")) {
                                // Challenge resuelto. Re-disparar imágenes del banner que
                                // fallaron antes de que cf_clearance estuviera disponible.
                                // shouldInterceptRequest ahora enviará la cookie → OkHttp carga la imagen.
                                try {
                                    getBridge().getWebView().post(() ->
                                        getBridge().getWebView().evaluateJavascript(
                                            "(function(){" +
                                            "  document.querySelectorAll('.slider-slide-img[data-orig]').forEach(function(img){" +
                                            "    if(!img.complete||img.naturalWidth===0){" +
                                            "      var o=img.getAttribute('data-orig');" +
                                            "      if(o){img._nativeTried=false;img.src='';img.src=o;}" +
                                            "    }" +
                                            "  });" +
                                            "})()", null)
                                    );
                                } catch (Exception ignored) {}
                                mainHandler.postDelayed(() -> {
                                    try { preloader.stopLoading(); preloader.destroy(); }
                                    catch (Exception ignored) {}
                                }, 500);
                            } else if (waits++ < 40) {
                                mainHandler.postDelayed(this, 500);
                            } else {
                                try { preloader.stopLoading(); preloader.destroy(); }
                                catch (Exception ignored) {}
                            }
                        }
                    }.run();
                }
            });
            preloader.loadUrl("https://latanime.org/");
            // Timeout de seguridad absoluto: 25s
            mainHandler.postDelayed(() -> {
                try { preloader.stopLoading(); preloader.destroy(); } catch (Exception ignored) {}
            }, 25000);
        });

        // ── Image proxy: intercepta requests de imagen externa y añade Referer ──
        // Esto bypasa hotlink-protection en latanime.org y otros sitios.
        // shouldInterceptRequest corre en background thread — se puede hacer red aquí.
        final com.getcapacitor.Bridge cap = getBridge();
        final OkHttpClient okImgClient = new OkHttpClient.Builder()
            .followRedirects(true)
            .followSslRedirects(true)
            .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .build();

        cap.getWebView().setWebViewClient(new BridgeWebViewClient(cap) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                // Google/Firebase auth debe cargarse en la WebView, no en un navegador externo.
                // Retornar false = el WebView carga la URL él mismo (sin llamar a super,
                // que es quien abre el browser externo para URLs http/https).
                if (url.contains("accounts.google.com")
                        || url.contains("firebaseapp.com/__/auth")
                        || url.contains("ryoku-app-53e5c.firebaseapp.com")
                        || url.startsWith("http://localhost")
                        || url.startsWith("https://localhost")) {
                    return false;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (isExternalImage(url, request)) {
                    WebResourceResponse resp = fetchImageOkHttp(url, okImgClient);
                    if (resp != null) return resp;
                    Log.w("RYOKU_IMG", "fetch failed for: " + url);
                }
                return super.shouldInterceptRequest(view, request);
            }

            private boolean isExternalImage(String url, WebResourceRequest request) {
                if (url.startsWith("capacitor://") || url.startsWith("file://")
                        || url.startsWith("data:") || url.startsWith("blob:"))
                    return false;
                if (!url.startsWith("http://") && !url.startsWith("https://"))
                    return false;
                java.util.Map<String, String> headers = request.getRequestHeaders();
                if (headers != null) {
                    String accept = headers.get("Accept");
                    if (accept != null && accept.contains("image/")) return true;
                }
                String ul = url.toLowerCase();
                return ul.contains(".jpg") || ul.contains(".jpeg")
                    || ul.contains(".png") || ul.contains(".webp")
                    || ul.contains(".gif") || ul.contains(".avif");
            }

            private WebResourceResponse fetchImageOkHttp(String imageUrl, OkHttpClient client) {
                try {
                    String host = new URL(imageUrl).getHost();
                    String referer = "https://" + host + "/";
                    // Incluir cf_clearance y demás cookies del CookieManager.
                    // Sin esto, Cloudflare bloquea la imagen aunque el preloader ya resolvió el challenge.
                    String hostCookies = android.webkit.CookieManager.getInstance()
                        .getCookie(referer);
                    Request.Builder rb = new Request.Builder()
                        .url(imageUrl)
                        .header("Referer", referer)
                        .header("User-Agent", UA)
                        .header("Accept", "image/webp,image/apng,image/*,*/*;q=0.8");
                    if (hostCookies != null && !hostCookies.isEmpty()) {
                        rb.header("Cookie", hostCookies);
                    }
                    Response response = client.newCall(rb.build()).execute();
                    if (!response.isSuccessful()) { response.close(); return null; }
                    ResponseBody body = response.body();
                    if (body == null) return null;
                    String mime = response.header("Content-Type", "image/jpeg");
                    if (mime != null && mime.contains(";")) mime = mime.split(";")[0].trim();
                    // Solo devolver si es imagen — si Cloudflare devuelve HTML, retornar null
                    if (mime != null && !mime.startsWith("image/") && !mime.equals("application/octet-stream")) {
                        Log.w("RYOKU_IMG", "Non-image response: " + mime + " for " + imageUrl);
                        response.close();
                        return null;
                    }
                    return new WebResourceResponse(mime, null, body.byteStream());
                } catch (Exception e) {
                    Log.e("RYOKU_IMG", "OkHttp error for " + imageUrl + ": " + e.getMessage());
                    return null;
                }
            }
        });
    }

    // ── Gesto/botón volver de Android ───────────────────────────────────────────
    // No usamos @capacitor/app (no está instalado). En su lugar llamamos directamente
    // a window._ryokuHandleBack() en JS. Si retorna true = el JS lo manejó.
    // Si retorna false/null = salir de la app (comportamiento por defecto).
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        getBridge().getWebView().evaluateJavascript(
            "!!(window._ryokuHandleBack && window._ryokuHandleBack())",
            result -> {
                if (!"true".equals(result)) {
                    mainHandler.post(this::defaultBack);
                }
            }
        );
    }

    // Llamado desde el lambda — super.onBackPressed() no se puede llamar
    // directamente dentro de una lambda en Java, por eso usamos este helper.
    @SuppressWarnings("deprecation")
    private void defaultBack() {
        super.onBackPressed();
    }

    @SuppressLint("SetJavaScriptEnabled")
    class StreamExtractorInterface {

        // Cache de data URLs pendientes de ser recogidos por JS vía getImgData().
        // Evita pasar strings de 60-200KB a través de evaluateJavascript (puede
        // fallar silenciosamente con strings muy largos).
        private final java.util.Map<String, String> imgDataCache =
            new java.util.concurrent.ConcurrentHashMap<>();

        @JavascriptInterface
        public String getImgData(final String id) {
            // JS llama esto para recoger el data URL — retorna y borra de la cache.
            return imgDataCache.remove(id);
        }

        // ── Carga nativa de imágenes con Referer correcto ───────────────────────
        // Fallback cuando BridgeWebViewClient no logra cargar la imagen.
        // Mismo patrón que extractStream — funciona en Android WebView.
        @JavascriptInterface
        public void fetchImage(final String imageUrl, final String callbackId) {
            // Ruta rápida: OkHttp con cookie cf_clearance del preloader (ya resuelta).
            // Ruta lenta: WebView oculto que resuelve Cloudflare y usa XHR.
            new Thread(() -> {
                try {
                    String cfCookies = android.webkit.CookieManager.getInstance()
                        .getCookie("https://latanime.org/");
                    if (cfCookies != null && cfCookies.contains("cf_clearance")) {
                        String dataUrl = fetchViaOkHttp(imageUrl, cfCookies);
                        if (dataUrl != null) {
                            fireCb(callbackId, dataUrl, imageUrl);
                            return;
                        }
                    }
                } catch (Exception ignored) {}
                // OkHttp falló o no hay cf_clearance → WebView oculto
                fetchImageViaWebView(imageUrl, callbackId);
            }).start();
        }

        /** OkHttp directo con cookie cf_clearance; retorna data URL o null. */
        private String fetchViaOkHttp(String imageUrl, String cookies) {
            try {
                OkHttpClient client = new OkHttpClient.Builder()
                    .followRedirects(true).followSslRedirects(true)
                    .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
                    .build();
                String host = new URL(imageUrl).getHost();
                Request req = new Request.Builder()
                    .url(imageUrl)
                    .header("User-Agent", UA)
                    .header("Referer", "https://" + host + "/")
                    .header("Accept", "image/webp,image/apng,image/*;q=0.9,*/*;q=0.5")
                    .header("Cookie", cookies)
                    .build();
                Response response = client.newCall(req).execute();
                if (!response.isSuccessful()) { response.close(); return null; }
                ResponseBody body = response.body();
                if (body == null) return null;
                byte[] bytes = body.bytes();
                if (!isValidImageBytes(bytes)) return null;
                String ct = response.header("Content-Type", "image/jpeg");
                if (ct != null && ct.contains(";")) ct = ct.split(";")[0].trim();
                if (ct == null || !ct.startsWith("image/")) ct = guessMimeType(imageUrl);
                String b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
                return "data:" + ct + ";base64," + b64;
            } catch (Exception e) {
                return null;
            }
        }

        /** Verifica magic bytes: JPEG, PNG, WebP/RIFF, GIF. Rechaza HTML. */
        private boolean isValidImageBytes(byte[] b) {
            if (b == null || b.length < 4) return false;
            if ((b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8) return true; // JPEG
            if ((b[0] & 0xFF) == 0x89 && b[1] == 0x50) return true;           // PNG
            if (b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46) return true;    // WebP/RIFF
            if (b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) return true;    // GIF
            return false;
        }

        private String guessMimeType(String url) {
            String l = url.toLowerCase();
            if (l.contains(".jpg") || l.contains(".jpeg")) return "image/jpeg";
            if (l.contains(".png"))  return "image/png";
            if (l.contains(".webp")) return "image/webp";
            if (l.contains(".gif"))  return "image/gif";
            return "image/jpeg";
        }

        private void fetchImageViaWebView(final String imageUrl, final String callbackId) {
            mainHandler.post(() -> {
                final WebView imgView = new WebView(MainActivity.this);
                final AtomicBoolean done = new AtomicBoolean(false);

                WebSettings ws = imgView.getSettings();
                ws.setJavaScriptEnabled(true);
                ws.setDomStorageEnabled(true);
                ws.setUserAgentString(UA);
                ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

                String base = "https://latanime.org/";
                try {
                    URL pu = new URL(imageUrl);
                    base = pu.getProtocol() + "://" + pu.getHost() + "/";
                } catch (Exception ignored) {}
                final String baseUrl = base;
                final String safeUrl = imageUrl.replace("'", "%27").replace("\"", "%22");

                // XHR + FileReader: same-origin desde loadDataWithBaseURL → sin CORS.
                // Acepta image/* y application/octet-stream.
                // Reconstruye MIME desde extensión si blob.type no es image/*.
                final String extractJs =
                    "(function(){" +
                    "  window._ryokuResult=null;" +
                    "  var url='" + safeUrl + "';" +
                    "  var ext=url.split('?')[0].split('.').pop().toLowerCase();" +
                    "  var mimeMap={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif'};" +
                    "  var guessedMime=mimeMap[ext]||'image/jpeg';" +
                    "  var xhr=new XMLHttpRequest();" +
                    "  xhr.open('GET',url);" +
                    "  xhr.responseType='blob';" +
                    "  xhr.setRequestHeader('Accept','image/webp,image/apng,image/jpeg,image/*;q=0.9,*/*;q=0.5');" +
                    "  xhr.onload=function(){" +
                    "    var b=xhr.response;" +
                    "    if(!b||b.size<500){window._ryokuResult='NONE';return;}" +
                    "    var t=b.type||'';" +
                    "    var isImg=t.startsWith('image/')||t==='application/octet-stream'||t==='';" +
                    "    if(xhr.status===200&&isImg){" +
                    "      var finalMime=t.startsWith('image/')?t:guessedMime;" +
                    "      var useBlob=t.startsWith('image/')?b:b.slice(0,b.size,finalMime);" +
                    "      var fr=new FileReader();" +
                    "      fr.onloadend=function(){" +
                    "        var r=fr.result||'';" +
                    "        if(r.startsWith('data:image/')){window._ryokuResult=r;}" +
                    "        else if(r.indexOf(',')>0){window._ryokuResult='data:'+finalMime+';base64,'+r.split(',')[1];}" +
                    "        else{window._ryokuResult='NONE';}" +
                    "      };" +
                    "      fr.readAsDataURL(useBlob);" +
                    "    }else{" +
                    "      window._ryokuResult='NONE';" +
                    "    }" +
                    "  };" +
                    "  xhr.onerror=function(){window._ryokuResult='NONE';};" +
                    "  xhr.ontimeout=function(){window._ryokuResult='NONE';};" +
                    "  xhr.timeout=10000;" +
                    "  xhr.send();" +
                    "})()";

                // Helper que inyecta extractJs y espera el resultado
                final Runnable injectAndPoll = new Runnable() {
                    @Override public void run() {
                        if (done.get()) return;
                        imgView.evaluateJavascript(extractJs, null);
                        new Runnable() {
                            int a = 0;
                            @Override public void run() {
                                if (done.get()) return;
                                imgView.evaluateJavascript("window._ryokuResult||null", res -> {
                                    if (res != null && res.startsWith("\"data:image/")) {
                                        if (!done.compareAndSet(false, true)) return;
                                        fireCb(callbackId, res.substring(1, res.length() - 1), imageUrl);
                                        mainHandler.post(() -> { imgView.stopLoading(); imgView.destroy(); });
                                    } else if (res != null && res.contains("NONE")) {
                                        if (!done.compareAndSet(false, true)) return;
                                        fireCb(callbackId, null);
                                        mainHandler.post(() -> { imgView.stopLoading(); imgView.destroy(); });
                                    } else if (a++ < 50) {
                                        mainHandler.postDelayed(this, 250);
                                    } else {
                                        if (!done.compareAndSet(false, true)) return;
                                        fireCb(callbackId, null);
                                        mainHandler.post(() -> { imgView.stopLoading(); imgView.destroy(); });
                                    }
                                });
                            }
                        }.run();
                    }
                };

                imgView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        if (done.get()) return;
                        // Esperar a que cf_clearance esté presente en el CookieManager.
                        // El challenge de Cloudflare puede completarse DESPUÉS de onPageFinished.
                        new Runnable() {
                            int waits = 0;
                            @Override public void run() {
                                if (done.get()) return;
                                String cookies = android.webkit.CookieManager.getInstance()
                                    .getCookie(baseUrl);
                                boolean hasCf = cookies != null && cookies.contains("cf_clearance");
                                if (hasCf) {
                                    injectAndPoll.run();
                                } else if (waits++ < 20) {
                                    mainHandler.postDelayed(this, 500); // poll cada 500ms, max 10s
                                } else {
                                    injectAndPoll.run(); // intentar de todos modos
                                }
                            }
                        }.run();
                    }
                });

                // Cargar latanime.org REAL: Chromium resuelve el challenge de Cloudflare
                // dentro de ESTE WebView → cf_clearance disponible para el XHR inmediatamente.
                imgView.loadUrl(baseUrl);

                // Timeout global: 25s
                mainHandler.postDelayed(() -> {
                    if (!done.compareAndSet(false, true)) return;
                    fireCb(callbackId, null);
                    imgView.stopLoading();
                    imgView.destroy();
                }, 25000);
            });
        }
        // ── MonosChinos: cache de resultados ────────────────────────────────────
        private final java.util.Map<String, String> mcResultCache =
            new java.util.concurrent.ConcurrentHashMap<>();

        @JavascriptInterface
        public String getMcResult(final String id) {
            return mcResultCache.remove(id);
        }

        /**
         * Carga cualquier URL de MonosChinos en un WebView oculto,
         * espera a que Inertia.js termine de renderizar y devuelve
         * el listado de animes como JSON via _ryokuMcCb(callbackId).
         * Usado para búsqueda (/buscar?q=...) y biblioteca (/animes).
         */
        @JavascriptInterface
        public void fetchMonosChinos(final String pageUrl, final String callbackId) {
            mainHandler.post(() -> {
                final WebView bg = new WebView(MainActivity.this);
                final AtomicBoolean done = new AtomicBoolean(false);

                WebSettings ws = bg.getSettings();
                ws.setJavaScriptEnabled(true);
                ws.setDomStorageEnabled(true);
                ws.setUserAgentString(UA);
                ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

                // JS que extrae el array de animes desde el data-page de Inertia
                final String extractJs =
                    "(function(){" +
                    "try{" +
                    "  var el=document.getElementById('app')||document.querySelector('[data-page]');" +
                    "  if(!el)return 'WAIT';" +
                    "  var raw=el.getAttribute('data-page');" +
                    "  if(!raw||raw.length<10)return 'WAIT';" +
                    "  var d=JSON.parse(raw);" +
                    "  var props=d.props||{};" +
                    "  var list=null;" +
                    "  var KEYS=['animes','series','data','resultados'];" +
                    "  for(var i=0;i<KEYS.length;i++){" +
                    "    if(props[KEYS[i]]){list=props[KEYS[i]];break;}" +
                    "  }" +
                    "  if(!list){" +
                    "    for(var k in props){" +
                    "      var v=props[k];" +
                    "      if(Array.isArray(v)||(v&&Array.isArray(v.data))){list=v;break;}" +
                    "    }" +
                    "  }" +
                    "  if(!list)return 'WAIT';" +
                    "  if(!Array.isArray(list)&&list.data)list=list.data;" +
                    "  if(!Array.isArray(list))return '[]';" +
                    "  var out=list.map(function(a){" +
                    "    var url=a.slug?'https://monoschinos.st/anime/'+a.slug:(a.url||a.link||'');" +
                    "    return{" +
                    "      titulo:a.titulo||a.name||a.title||''," +
                    "      imagen:a.imagen||a.portada||a.cover||a.image||''," +
                    "      url:url," +
                    "      tipo:a.tipo||a.type||''," +
                    "      estado:a.estado||a.status||''," +
                    "      source:'monoschinos'" +
                    "    };" +
                    "  }).filter(function(a){return a.titulo&&a.url;});" +
                    "  return JSON.stringify(out);" +
                    "}catch(e){return 'ERR:'+e.message;}" +
                    "})()";

                bg.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        if (done.get()) return;
                        // Poll hasta que Inertia renderice (max 15s, cada 500ms)
                        new Runnable() {
                            int tries = 0;
                            @Override public void run() {
                                if (done.get()) return;
                                view.evaluateJavascript(extractJs, result -> {
                                    if (done.get()) return;
                                    if (result == null || result.equals("null") ||
                                            result.equals(""WAIT"")) {
                                        if (tries++ < 30) {
                                            mainHandler.postDelayed(this, 500);
                                        } else {
                                            finishMc(done, callbackId, "[]", bg);
                                        }
                                        return;
                                    }
                                    // evaluateJavascript devuelve el string JSON-encoded
                                    // (con comillas y escapes extra) — limpiar
                                    String json = result;
                                    if (json.startsWith(""") && json.endsWith(""")) {
                                        json = json.substring(1, json.length() - 1)
                                            .replace("\"", """)
                                            .replace("\\", "\")
                                            .replace("\/", "/");
                                    }
                                    finishMc(done, callbackId, json, bg);
                                });
                            }
                        }.run();
                    }
                });

                bg.loadUrl(pageUrl);

                // Timeout global: 20s
                mainHandler.postDelayed(() ->
                    finishMc(done, callbackId, "[]", bg), 20000);
            });
        }

        private void finishMc(AtomicBoolean done, String callbackId, String json, WebView bg) {
            if (!done.compareAndSet(false, true)) return;
            mcResultCache.put(callbackId, json);
            final WebView main = getBridge().getWebView();
            mainHandler.post(() -> {
                main.evaluateJavascript(
                    "window._ryokuMcCb&&window._ryokuMcCb('" + callbackId + "')", null);
                bg.stopLoading();
                bg.destroy();
            });
        }

        private void fireCb(String id, String result) {
            fireCb(id, result, null);
        }

        private void fireCb(String id, String result, String imageUrl) {
            mainHandler.post(() -> {
                if (result != null) {
                    imgDataCache.put(id, result);
                    if (imageUrl != null) imgDataCache.put("url_" + id, imageUrl);
                    getBridge().getWebView().evaluateJavascript(
                        "(function(){" +
                        "  var id='" + id + "';" +
                        "  var d=window._nativeExtractor.getImgData(id);" +
                        "  if(!d)return;" +
                        // Callback registrado por _ryokuLoadImgNative
                        "  var cb=window._ryokuImgCallbacks&&window._ryokuImgCallbacks[id];" +
                        "  if(cb){cb(d);delete window._ryokuImgCallbacks[id];}" +
                        // Actualización directa: busca el <img> por data-orig y fuerza visibilidad
                        "  var ou=window._nativeExtractor.getImgData('url_'+id);" +
                        "  if(ou){" +
                        "    var imgs=document.querySelectorAll('.slider-slide-img');" +
                        "    for(var i=0;i<imgs.length;i++){" +
                        "      if(imgs[i].getAttribute('data-orig')===ou){" +
                        "        imgs[i].src=d;" +
                        "        imgs[i].style.cssText+='display:block!important;visibility:visible!important;opacity:1!important;z-index:10!important;';" +
                        "      }" +
                        "    }" +
                        "  }" +
                        "})()", null);
                } else {
                    getBridge().getWebView().evaluateJavascript(
                        "window._ryokuImgCb&&window._ryokuImgCb('" + id + "',null)", null);
                }
            });
        }

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
