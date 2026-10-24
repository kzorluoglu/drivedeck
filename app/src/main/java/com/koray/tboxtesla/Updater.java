package com.koray.tboxtesla;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Updates the app from the GitHub releases of the project, without Google Play. The APK is
 * downloaded here and handed to the system installer, which asks the driver to confirm.
 */
class Updater {
    interface Progress {
        void percent(int percent);
    }

    static final String RESULT_ACTION = "com.koray.tboxtesla.INSTALL_RESULT";
    private static final String LATEST = "https://api.github.com/repos/kzorluoglu/drivedeck/releases/latest";
    private static final String DOWNLOAD_PREFIX = "https://github.com/kzorluoglu/drivedeck/releases/download/";

    private final Context context;

    Updater(Context context) {
        this.context = context;
    }

    String installedVersion() throws Exception {
        return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
    }

    /** {available, current, version, url, size, notes} for the newest release. */
    String check() throws Exception {
        HttpURLConnection http = (HttpURLConnection) new URL(LATEST).openConnection();
        http.setConnectTimeout(8000);
        http.setReadTimeout(15000);
        http.setRequestProperty("Accept", "application/vnd.github+json");
        http.setRequestProperty("User-Agent", "DriveDeck");
        if (http.getResponseCode() != 200) {
            throw new IllegalStateException("GitHub " + http.getResponseCode());
        }
        JSONObject release;
        try (InputStream in = http.getInputStream()) {
            java.io.ByteArrayOutputStream body = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) {
                body.write(chunk, 0, n);
            }
            release = new JSONObject(body.toString("UTF-8"));
        }
        String version = release.optString("tag_name").replaceFirst("^v", "");
        String current = installedVersion();
        JSONObject result = new JSONObject().put("current", current).put("version", version).put("available", false);
        JSONArray assets = release.optJSONArray("assets");
        for (int i = 0; assets != null && i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            String url = asset.optString("browser_download_url");
            if (url.endsWith(".apk") && url.startsWith(DOWNLOAD_PREFIX)) {
                result.put("url", url).put("size", asset.optLong("size"));
                result.put("available", compare(version, current) > 0);
                break;
            }
        }
        return result.put("notes", release.optString("body")).toString();
    }

    /** Numeric comparison of dotted versions, 1.10 is newer than 1.9. */
    static int compare(String a, String b) {
        String[] x = a.split("\\.");
        String[] y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? number(x[i]) : 0;
            int q = i < y.length ? number(y[i]) : 0;
            if (p != q) {
                return Integer.compare(p, q);
            }
        }
        return 0;
    }

    private static int number(String part) {
        try {
            return Integer.parseInt(part.replaceAll("\\D.*", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    boolean mayInstall() {
        return context.getPackageManager().canRequestPackageInstalls();
    }

    /** Downloads the APK, checks that it is this app in a newer version and hands it to the installer. */
    void install(String url, Progress progress) throws Exception {
        if (!url.startsWith(DOWNLOAD_PREFIX) || !url.endsWith(".apk")) {
            throw new IllegalArgumentException("Unexpected download address");
        }
        File apk = new File(context.getCacheDir(), "update.apk");
        HttpURLConnection http = (HttpURLConnection) new URL(url).openConnection();
        http.setConnectTimeout(10000);
        http.setReadTimeout(30000);
        http.setRequestProperty("User-Agent", "DriveDeck");
        if (http.getResponseCode() != 200) {
            throw new IllegalStateException("Download " + http.getResponseCode());
        }
        long total = http.getContentLengthLong();
        try (InputStream in = http.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
            byte[] buffer = new byte[32768];
            long done = 0;
            int last = -1;
            int read;
            while ((read = in.read(buffer)) > 0) {
                out.write(buffer, 0, read);
                done += read;
                int percent = total > 0 ? (int) (done * 100 / total) : 0;
                if (percent != last) {
                    last = percent;
                    progress.percent(percent);
                }
            }
        }

        PackageManager pm = context.getPackageManager();
        PackageInfo downloaded = pm.getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        PackageInfo installed = pm.getPackageInfo(context.getPackageName(), 0);
        if (downloaded == null || !context.getPackageName().equals(downloaded.packageName)
                || downloaded.getLongVersionCode() <= installed.getLongVersionCode()) {
            apk.delete();
            throw new IllegalStateException("The download is not a newer version of this app");
        }

        PackageInstaller installer = pm.getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(context.getPackageName());
        if (Build.VERSION.SDK_INT >= 31) {
            // Android 12+ may skip the confirmation for an update of an app the installer already owns
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }
        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (OutputStream out = session.openWrite("DriveDeck.apk", 0, apk.length());
                 InputStream in = new java.io.FileInputStream(apk)) {
                byte[] chunk = new byte[32768];
                int n;
                while ((n = in.read(chunk)) > 0) {
                    out.write(chunk, 0, n);
                }
                session.fsync(out);
            }
            Intent result = new Intent(RESULT_ACTION).setPackage(context.getPackageName());
            PendingIntent pending = PendingIntent.getBroadcast(context, sessionId, result,
                    PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            session.commit(pending.getIntentSender());
        }
    }
}
