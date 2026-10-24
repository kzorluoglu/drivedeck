package com.koray.tboxtesla;

import android.content.Context;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;

/**
 * Disk cache for map tiles. Tiles that were seen once also show without a connection, e.g. in a tunnel
 * or with a weak hotspot. The oldest files are removed when the cache grows over the limit.
 */
class TileCache {
    private static final String TILE_HOST = "server.arcgisonline.com";
    private static final long MAX_BYTES = 300L * 1024 * 1024;

    private final File dir;

    TileCache(Context context) {
        dir = new File(context.getCacheDir(), "tiles");
        dir.mkdirs();
        trim();
    }

    static boolean handles(String host) {
        return TILE_HOST.equals(host);
    }

    WebResourceResponse get(String url) {
        File file = new File(dir, name(url));
        try {
            byte[] data;
            if (file.exists()) {
                data = read(new FileInputStream(file));
                file.setLastModified(System.currentTimeMillis());
            } else {
                HttpURLConnection http = (HttpURLConnection) new URL(url).openConnection();
                http.setConnectTimeout(8000);
                http.setReadTimeout(8000);
                if (http.getResponseCode() != 200) {
                    return null;
                }
                data = read(http.getInputStream());
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(data);
                }
            }
            WebResourceResponse response = new WebResourceResponse("image/png", null, new ByteArrayInputStream(data));
            response.setResponseHeaders(java.util.Collections.singletonMap("Access-Control-Allow-Origin", "*"));
            return response;
        } catch (IOException e) {
            // offline and not cached: let the page show a missing tile
            WebResourceResponse missing = new WebResourceResponse("image/png", null, new ByteArrayInputStream(new byte[0]));
            missing.setStatusCodeAndReasonPhrase(404, "Not Found");
            return missing;
        }
    }

    private static String name(String url) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-1").digest(url.getBytes("UTF-8"));
            StringBuilder out = new StringBuilder();
            for (byte b : digest) {
                out.append(String.format("%02x", b));
            }
            return out.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] read(InputStream in) throws IOException {
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = stream.read(buffer)) > 0) {
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private void trim() {
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        long total = 0;
        for (File file : files) {
            total += file.length();
        }
        if (total <= MAX_BYTES) {
            return;
        }
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        for (File file : files) {
            if (total <= MAX_BYTES * 0.8) {
                break;
            }
            total -= file.length();
            file.delete();
        }
    }
}
