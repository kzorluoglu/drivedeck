package com.koray.tboxtesla;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.provider.Settings;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.content.Intent;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.view.View;
import android.webkit.CookieManager;
import android.widget.FrameLayout;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Hosts the web based dashboard from assets/web in a full screen WebView.
 */
public class MainActivity extends Activity {
    private static final int LOCATION_REQUEST = 1;
    private static final int AUDIO_REQUEST = 2;
    private static final int BLUETOOTH_REQUEST = 3;
    private static final int WAKE_REQUEST = 4;

    // Assets are served from this https origin so the page can fetch its own files (3D models)
    // and counts as a secure context for geolocation.
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ASSET_HOST + "/web/index.html";

    private WebView web;
    private WebView agentWeb;
    private FrameLayout root;
    private SecretStore secrets;
    private PairingServer pairing;
    private TileCache tiles;
    private final ObdClient obd = new ObdClient();
    private int listenId;
    private String listenLanguage;
    private String pendingObdAddress;
    private String agentScript;
    private FrameLayout.LayoutParams fullscreenBounds;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private DeviceBridge bridge;
    private Updater updater;
    private final BroadcastReceiver installResult = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                // the system asks the driver to confirm the update
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(confirm);
                }
            } else if (status != PackageInstaller.STATUS_SUCCESS) {
                String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                callPage(0, "{\"event\":\"update\",\"status\":\"failed\",\"message\":" + JSONObject.quote(String.valueOf(message)) + "}");
            }
        }
    };
    private String pendingOrigin;
    private GeolocationPermissions.Callback pendingCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Allows inspecting the page from chrome://inspect on the Mac.
        WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        secrets = new SecretStore(this);
        tiles = new TileCache(this);
        pairing = new PairingServer(this, secrets, new PairingServer.Listener() {
            @Override
            public void onSaved() {
                callPage(0, "{\"event\":\"paired\"}");
            }

            @Override
            public void onMessage(JSONObject message) {
                callPage(0, "{\"event\":\"inbox\",\"message\":" + message + "}");
            }
        });
        bridge = new DeviceBridge(this);
        updater = new Updater(this);
        IntentFilter resultFilter = new IntentFilter(Updater.RESULT_ACTION);
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            registerReceiver(installResult, resultFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(installResult, resultFilter);
        }
        web.addJavascriptInterface(bridge, "TBox");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (TileCache.handles(request.getUrl().getHost())) {
                    return tiles.get(request.getUrl().toString());
                }
                return loadAsset(request.getUrl());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                    return;
                }
                pendingOrigin = origin;
                pendingCallback = callback;
                requestPermissions(new String[] {
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                }, LOCATION_REQUEST);
            }
        });

        web.loadUrl(START_URL);
        root = new FrameLayout(this);
        root.addView(web);
        setContentView(root);
    }

    /**
     * Sends a result to the page: window.core.native(id, payload). Id 0 is for events.
     */
    private void callPage(int id, String payload) {
        runOnUiThread(() -> web.evaluateJavascript("window.core.native(" + id + "," + JSONObject.quote(payload) + ")", null));
    }

    /**
     * The browser the assistant drives, a second WebView laid over the app window of the page.
     * It is created on first use and keeps its cookies, so logins survive restarts.
     */
    private WebView agentWeb() {
        if (agentWeb != null) {
            return agentWeb;
        }
        agentWeb = new WebView(this);
        agentWeb.setBackgroundColor(Color.parseColor("#0f1012"));
        WebSettings settings = agentWeb.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        // Sites such as Google refuse to sign in to a WebView, which announces itself with "; wv".
        settings.setUserAgentString(settings.getUserAgentString().replace("; wv", ""));
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(agentWeb, true);
        agentWeb.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                return !("http".equals(scheme) || "https".equals(scheme));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                callPage(0, "{\"event\":\"loaded\",\"url\":" + JSONObject.quote(url) + "}");
            }
        });
        // HTML5 fullscreen (e.g. the fullscreen button of YouTube) fills the whole screen
        agentWeb.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                // The page picks the area (video in 16:9 next to the map), default is the whole screen.
                root.addView(view, fullscreenBounds != null ? fullscreenBounds
                        : new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
                callPage(0, "{\"event\":\"fullscreen\",\"on\":true}");
            }

            @Override
            public void onHideCustomView() {
                leaveFullscreen();
            }
        });
        agentWeb.setAlpha(0f);
        root.addView(agentWeb, new FrameLayout.LayoutParams(1, 1));
        return agentWeb;
    }

    private void leaveFullscreen() {
        if (customView == null) {
            return;
        }
        root.removeView(customView);
        customView = null;
        customViewCallback.onCustomViewHidden();
        customViewCallback = null;
        callPage(0, "{\"event\":\"fullscreen\",\"on\":false}");
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            leaveFullscreen();
        } else {
            super.onBackPressed();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) > 0) {
            out.write(buffer, 0, read);
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private String agentScript() {
        if (agentScript == null) {
            try (InputStream in = getAssets().open("web/agent-page.js")) {
                agentScript = readAll(in);
            } catch (IOException e) {
                agentScript = "";
            }
        }
        return agentScript;
    }

    private WebResourceResponse loadAsset(Uri url) {
        if (!ASSET_HOST.equals(url.getHost()) || url.getPath() == null) {
            return null;
        }
        String path = url.getPath().substring(1);
        try {
            return new WebResourceResponse(mimeType(path), null, getAssets().open(path));
        } catch (IOException e) {
            WebResourceResponse missing = new WebResourceResponse("text/plain", "utf-8", null);
            missing.setStatusCodeAndReasonPhrase(404, "Not Found");
            return missing;
        }
    }

    private static String mimeType(String path) {
        if (path.endsWith(".html")) {
            return "text/html";
        }
        if (path.endsWith(".js")) {
            return "application/javascript";
        }
        if (path.endsWith(".css")) {
            return "text/css";
        }
        if (path.endsWith(".glb")) {
            return "model/gltf-binary";
        }
        if (path.endsWith(".png")) {
            return "image/png";
        }
        return "application/octet-stream";
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == AUDIO_REQUEST) {
            if (granted) {
                bridge.listen(listenId, listenLanguage);
            } else {
                callPage(listenId, "{\"error\":\"Mikrofon nicht erlaubt\"}");
            }
        } else if (requestCode == WAKE_REQUEST) {
            if (granted) {
                bridge.setWake(true, bridge.speechTag);
            }
        } else if (requestCode == BLUETOOTH_REQUEST) {
            if (granted && pendingObdAddress != null) {
                obd.connect(pendingObdAddress);
            }
            pendingObdAddress = null;
        } else if (requestCode == LOCATION_REQUEST && pendingCallback != null) {
            pendingCallback.invoke(pendingOrigin, granted, false);
            pendingCallback = null;
            pendingOrigin = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        bridge.holdWake(false);
    }

    @Override
    protected void onPause() {
        // other apps (phone calls, CarPlay) get the microphone back while DriveDeck is in the background
        bridge.holdWake(true);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        unregisterReceiver(installResult);
        pairing.stop();
        obd.disconnect();
        bridge.shutdown();
        super.onDestroy();
    }

    /**
     * Exposed to JavaScript as window.TBox, gives the page access to real device state.
     */
    private class DeviceBridge implements TextToSpeech.OnInitListener {
        private final Context context;
        private final AudioManager audio;
        private final TextToSpeech tts;
        private final CloudVoice cloud;
        // speech goes through OpenRouter, the system voice only speaks without a key or when OpenRouter cannot be reached
        private String speechTag = "de-DE";

        DeviceBridge(Context context) {
            this.context = context;
            cloud = new CloudVoice(context, secrets);
            audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            tts = new TextToSpeech(context, this);
        }

        @Override
        public void onInit(int status) {
            if (status == TextToSpeech.SUCCESS) {
                tts.setLanguage(Locale.GERMAN);
            }
        }

        void holdWake(boolean hold) {
            cloud.holdWake(hold);
        }

        void shutdown() {
            cloud.stopWake();
            cloud.stopSpeaking(true);
            tts.shutdown();
        }

        /**
         * Starts the pairing server and returns {url} for the QR code, or {error}.
         */
        @JavascriptInterface
        public String startPairing() {
            try {
                return new JSONObject().put("url", pairing.start()).toString();
            } catch (Exception e) {
                return "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
            }
        }

        @JavascriptInterface
        public void stopPairing() {
            pairing.stop();
        }

        /**
         * {hasKey, model, logins: [{site, user}]}, never the secrets themselves.
         */
        @JavascriptInterface
        public String getAssistantState() {
            return secrets.publicState().toString();
        }

        @JavascriptInterface
        public void clearAssistantData() {
            secrets.clear();
            CookieManager.getInstance().removeAllCookies(null);
            runOnUiThread(() -> {
                if (agentWeb != null) {
                    agentWeb.clearCache(true);
                    agentWeb.clearHistory();
                }
            });
        }

        /**
         * Chat completion against OpenRouter. The key stays on this side. The answer arrives as
         * window.core.native(id, json) with {status, body} or {error}.
         */
        @JavascriptInterface
        public void llm(int id, String requestJson) {
            new Thread(() -> callPage(id, openRouter(requestJson)), "llm").start();
        }

        private String openRouter(String requestJson) {
            String key = secrets.openRouterKey();
            if (key.isEmpty()) {
                return "{\"error\":\"Kein OpenRouter Schlüssel, bitte koppeln\"}";
            }
            try {
                JSONObject request = new JSONObject(requestJson);
                request.put("model", secrets.publicState().optString("model", SecretStore.DEFAULT_MODEL));
                HttpURLConnection http = (HttpURLConnection) new URL("https://openrouter.ai/api/v1/chat/completions").openConnection();
                http.setConnectTimeout(15000);
                http.setReadTimeout(90000);
                http.setRequestMethod("POST");
                http.setDoOutput(true);
                http.setRequestProperty("Authorization", "Bearer " + key);
                http.setRequestProperty("Content-Type", "application/json");
                http.setRequestProperty("X-Title", "DriveDeck");
                try (OutputStream out = http.getOutputStream()) {
                    out.write(request.toString().getBytes(StandardCharsets.UTF_8));
                }
                int status = http.getResponseCode();
                InputStream in = status < 400 ? http.getInputStream() : http.getErrorStream();
                String body = in == null ? "" : readAll(in);
                return new JSONObject().put("status", status).put("body", body).toString();
            } catch (Exception e) {
                return "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
            }
        }

        /**
         * Places the assistant's browser over a rectangle of the page, given in CSS pixels.
         */
        @JavascriptInterface
        public void browserShow(float x, float y, float w, float h, float viewportWidth) {
            runOnUiThread(() -> {
                float scale = web.getWidth() / viewportWidth;
                WebView view = agentWeb();
                FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(Math.round(w * scale), Math.round(h * scale));
                params.leftMargin = Math.round(x * scale);
                params.topMargin = Math.round(y * scale);
                view.setLayoutParams(params);
                view.setAlpha(1f);
                view.setVisibility(View.VISIBLE);
            });
        }

        /**
         * Area for HTML5 fullscreen video, in CSS pixels of the page.
         */
        @JavascriptInterface
        public void browserFullscreenRect(float x, float y, float w, float h, float viewportWidth) {
            runOnUiThread(() -> {
                float scale = web.getWidth() / viewportWidth;
                fullscreenBounds = new FrameLayout.LayoutParams(Math.round(w * scale), Math.round(h * scale));
                fullscreenBounds.leftMargin = Math.round(x * scale);
                fullscreenBounds.topMargin = Math.round(y * scale);
            });
        }

        @JavascriptInterface
        public void browserHide() {
            runOnUiThread(() -> {
                leaveFullscreen();
                if (agentWeb != null) {
                    // stays attached and invisible instead of GONE, so music keeps playing
                    agentWeb.setAlpha(0f);
                    agentWeb.setLayoutParams(new FrameLayout.LayoutParams(1, 1));
                }
            });
        }

        @JavascriptInterface
        public void browserLoad(String url) {
            runOnUiThread(() -> agentWeb().loadUrl(url));
        }

        @JavascriptInterface
        public void browserBack() {
            runOnUiThread(() -> {
                if (agentWeb != null && agentWeb.canGoBack()) {
                    agentWeb.goBack();
                }
            });
        }

        /**
         * Runs an expression in the browser page (with the helpers of agent-page.js loaded) and
         * returns its JSON result through window.core.native(id, json).
         */
        @JavascriptInterface
        public void browserEval(int id, String expression) {
            runOnUiThread(() -> agentWeb().evaluateJavascript(agentScript() + "\n;" + expression, (result) -> callPage(id, String.valueOf(result))));
        }

        /**
         * Fills the stored login for the page's site into its form. The password goes straight
         * from the encrypted store into the page, it never passes through the assistant page.
         */
        @JavascriptInterface
        public void browserFillLogin(int id) {
            runOnUiThread(() -> {
                String host = Uri.parse(String.valueOf(agentWeb().getUrl())).getHost();
                JSONObject login = host == null ? null : secrets.loginFor(host.toLowerCase());
                if (login == null) {
                    callPage(id, "{\"error\":\"Für diese Seite ist keine Anmeldung gespeichert\"}");
                    return;
                }
                String call = "__ai.fill(" + JSONObject.quote(login.optString("user")) + "," + JSONObject.quote(login.optString("pass")) + ")";
                agentWeb().evaluateJavascript(agentScript() + "\n;" + call, (result) -> callPage(id, String.valueOf(result)));
            });
        }

        /**
         * Language of the speech output as a tag, e.g. "de-DE", "tr-TR", "en-US".
         */
        @JavascriptInterface
        public void setSpeechLanguage(String tag) {
            speechTag = tag;
            tts.setLanguage(Locale.forLanguageTag(tag));
        }

        /**
         * Listens for the wake word in the background. Everything heard arrives as event {event:"heard", text},
         * the page decides whether it was meant for the assistant.
         */
        @JavascriptInterface
        public void setWake(boolean on, String languageTag) {
            runOnUiThread(() -> {
                if (!on) {
                    cloud.stopWake();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, WAKE_REQUEST);
                    return;
                }
                cloud.startWake(languageTag, (text) -> {
                    try {
                        callPage(0, new JSONObject().put("event", "heard").put("text", text).toString());
                    } catch (Exception e) {
                        // nothing heard then
                    }
                });
            });
        }

        /**
         * Speech to text through OpenRouter. The result arrives as window.core.native(id, {text} or {error}).
         */
        @JavascriptInterface
        public void listen(int id, String languageTag) {
            runOnUiThread(() -> {
                listenId = id;
                listenLanguage = languageTag;
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, AUDIO_REQUEST);
                    return;
                }
                if (!cloud.available()) {
                    callPage(id, "{\"error\":\"" + CloudVoice.text(languageTag, "nokey") + "\"}");
                    return;
                }
                cloud.listen(languageTag, () -> callPage(0, "{\"event\":\"listening\"}"), (json) -> callPage(id, json));
            });
        }

        @JavascriptInterface
        public void stopListening() {
            runOnUiThread(() -> {
                // a second tap ends the recording and transcribes it
                cloud.finishListening();
            });
        }

        @JavascriptInterface
        public void cancelListening() {
            runOnUiThread(() -> {
                cloud.cancelListening();
            });
        }

        // OBD adapter over Bluetooth

        @JavascriptInterface
        public String obdDevices() {
            return obd.devices();
        }

        @JavascriptInterface
        public void obdConnect(String address) {
            runOnUiThread(() -> {
                if (android.os.Build.VERSION.SDK_INT >= 31
                        && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                    pendingObdAddress = address;
                    requestPermissions(new String[] {Manifest.permission.BLUETOOTH_CONNECT}, BLUETOOTH_REQUEST);
                    return;
                }
                obd.connect(address);
            });
        }

        @JavascriptInterface
        public void obdDisconnect() {
            obd.disconnect();
        }

        @JavascriptInterface
        public String obdState() {
            return obd.state();
        }

        // Updates from the GitHub releases, see Updater

        @JavascriptInterface
        public String appVersion() {
            try {
                return updater.installedVersion();
            } catch (Exception e) {
                return "";
            }
        }

        /**
         * Looks for a newer release. The answer arrives as window.core.native(id, {available, version, url, size, notes} or {error}).
         */
        @JavascriptInterface
        public void updateCheck(int id) {
            new Thread(() -> {
                try {
                    callPage(id, updater.check());
                } catch (Exception e) {
                    callPage(id, "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}");
                }
            }, "update-check").start();
        }

        /**
         * Downloads and installs the release. Progress arrives as event {event:"update", status:"downloading", percent},
         * the final answer as {ok:true}, {needsPermission:true} or {error}.
         */
        @JavascriptInterface
        public void updateInstall(int id, String url) {
            if (!updater.mayInstall()) {
                runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()))));
                callPage(id, "{\"needsPermission\":true}");
                return;
            }
            new Thread(() -> {
                try {
                    updater.install(url, (percent) -> callPage(0, "{\"event\":\"update\",\"status\":\"downloading\",\"percent\":" + percent + "}"));
                    callPage(id, "{\"ok\":true}");
                } catch (Exception e) {
                    callPage(id, "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}");
                }
            }, "update-install").start();
        }

        @JavascriptInterface
        public void speak(String text) {
            if (cloud.available()) {
                cloud.speak(text, speechTag, () -> tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "nav"));
            } else {
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "nav");
            }
        }

        @JavascriptInterface
        public int getVolume() {
            return audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        }

        @JavascriptInterface
        public int getMaxVolume() {
            return audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        }

        @JavascriptInterface
        public void setVolume(int volume) {
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, volume, 0);
        }
    }
}
