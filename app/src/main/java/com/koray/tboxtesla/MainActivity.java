package com.koray.tboxtesla;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.Locale;

/**
 * Hosts the web based dashboard from assets/web in a full screen WebView.
 */
public class MainActivity extends Activity {
    private static final int LOCATION_REQUEST = 1;

    // Assets are served from this https origin so the page can fetch its own files (3D models)
    // and counts as a secure context for geolocation.
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ASSET_HOST + "/web/index.html";

    private WebView web;
    private DeviceBridge bridge;
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

        bridge = new DeviceBridge(this);
        web.addJavascriptInterface(bridge, "TBox");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
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
        setContentView(web);
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
        if (requestCode != LOCATION_REQUEST || pendingCallback == null) {
            return;
        }
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        pendingCallback.invoke(pendingOrigin, granted, false);
        pendingCallback = null;
        pendingOrigin = null;
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        bridge.shutdown();
        super.onDestroy();
    }

    /**
     * Exposed to JavaScript as window.TBox, gives the page access to real device state.
     */
    private static class DeviceBridge implements TextToSpeech.OnInitListener {
        private static final int ICON_SIZE = 96;

        private final Context context;
        private final AudioManager audio;
        private final TextToSpeech tts;

        DeviceBridge(Context context) {
            this.context = context;
            audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            tts = new TextToSpeech(context, this);
        }

        @Override
        public void onInit(int status) {
            if (status == TextToSpeech.SUCCESS) {
                tts.setLanguage(Locale.GERMAN);
            }
        }

        void shutdown() {
            tts.shutdown();
        }

        /**
         * Returns all launchable apps except this one as JSON: [{pkg, label, icon (PNG data URL)}].
         */
        @JavascriptInterface
        public String getApps() {
            PackageManager pm = context.getPackageManager();
            Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> infos = pm.queryIntentActivities(main, 0);
            JSONArray apps = new JSONArray();
            for (ResolveInfo info : infos) {
                String pkg = info.activityInfo.packageName;
                if (pkg.equals(context.getPackageName())) {
                    continue;
                }
                try {
                    JSONObject app = new JSONObject();
                    app.put("pkg", pkg);
                    app.put("label", info.loadLabel(pm).toString());
                    app.put("icon", iconDataUrl(info.loadIcon(pm)));
                    apps.put(app);
                } catch (Exception e) {
                    // skip apps whose icon or label cannot be read
                }
            }
            return apps.toString();
        }

        private static String iconDataUrl(Drawable drawable) {
            Bitmap bitmap = Bitmap.createBitmap(ICON_SIZE, ICON_SIZE, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            drawable.setBounds(0, 0, ICON_SIZE, ICON_SIZE);
            drawable.draw(canvas);
            ByteArrayOutputStream png = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, png);
            return "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP);
        }

        @JavascriptInterface
        public boolean launchApp(String pkg) {
            Intent intent = context.getPackageManager().getLaunchIntentForPackage(pkg);
            if (intent == null) {
                return false;
            }
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        }

        /**
         * Opens a link with whatever app handles it, e.g. YouTube links go to the YouTube app.
         */
        @JavascriptInterface
        public void openUrl(String url) {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }

        @JavascriptInterface
        public void speak(String text) {
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "nav");
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
