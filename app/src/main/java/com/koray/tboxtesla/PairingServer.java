package com.koray.tboxtesla;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Collections;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Tiny HTTP server for the phone, running as long as the app runs. The QR code on the car screen
 * points to it. The phone sets up the assistant (OpenRouter key, model, logins), sees its usage and
 * can send destinations, notes and links to the car.
 *
 * The connection is plain HTTP, so the content is encrypted on top: the QR code carries a random
 * AES-256 key in the URL fragment, which a browser never sends to a server. The phone page encrypts
 * everything it sends and decrypts everything it gets (AES-GCM, sjcl.js), so someone listening in the
 * Wi-Fi sees only ciphertext. The link also has a random token. Both stay the same until the
 * assistant data is deleted, the phone keeps them in its browser storage, so later it only needs
 * http://drivedeck.local:8765 (see {@link MdnsResponder}).
 */
class PairingServer {
    interface Listener {
        void onSaved();

        void onMessage(JSONObject message);

        void onUnpair();

        /** The last keys pressed in the car: [{code, name, ms, at}]. */
        JSONArray recentKeys();

        /** Measures the microphones while the driver talks: {results, system}, see CloudVoice.testMicrophone. */
        JSONObject onMicTest() throws Exception;
    }

    static final int PORT = 8765;
    private static final int MAX_BODY = 64 * 1024;

    private final Context context;
    private final SecretStore store;
    private final Usage usage;
    private final Microphone microphone;
    private final Listener listener;
    private final SecureRandom random = new SecureRandom();

    private ServerSocket server;

    PairingServer(Context context, SecretStore store, Usage usage, Microphone microphone, Listener listener) {
        this.context = context;
        this.store = store;
        this.usage = usage;
        this.microphone = microphone;
        this.listener = listener;
    }

    /**
     * Starts the server unless it runs already and returns the URL for the QR code.
     */
    synchronized String start() throws IOException {
        if (server == null || server.isClosed()) {
            server = new ServerSocket();
            server.setReuseAddress(true);
            server.bind(new InetSocketAddress(PORT));
            final ServerSocket socket = server;
            Thread acceptor = new Thread(() -> accept(socket), "pairing-server");
            acceptor.setDaemon(true);
            acceptor.start();
        }
        String[] pairing = store.pairing();
        return "http://" + advertisedAddress() + ":" + PORT + "/p/" + pairing[0] + "#k=" + pairing[1];
    }

    synchronized void stop() {
        if (server != null) {
            try {
                server.close();
            } catch (IOException e) {
                // already closed
            }
            server = null;
        }
    }

    private byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        random.nextBytes(bytes);
        return bytes;
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) {
            out.append(String.format("%02x", b));
        }
        return out.toString();
    }

    private static byte[] unhex(String text) {
        byte[] out = new byte[text.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(text.substring(2 * i, 2 * i + 2), 16);
        }
        return out;
    }

    /**
     * Address for the QR code. The emulator sits behind NAT, so for tests it can be overridden with
     * `adb shell settings put global drivedeck_host <ip of the computer>` (see tools/emulator-pairing.sh).
     */
    private String advertisedAddress() {
        String override = android.provider.Settings.Global.getString(context.getContentResolver(), "drivedeck_host");
        return override != null && !override.isEmpty() ? override : localAddress();
    }

    /**
     * The box's address in the Wi-Fi or LAN. Mobile data, USB and tunnel interfaces also have private
     * addresses on some boxes, but the phone can only reach the wlan/eth one.
     */
    static String localAddress() {
        String fallback = null;
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (nif.isLoopback() || !nif.isUp()) {
                    continue;
                }
                String name = nif.getName();
                for (InetAddress address : Collections.list(nif.getInetAddresses())) {
                    if (!(address instanceof Inet4Address) || !address.isSiteLocalAddress()) {
                        continue;
                    }
                    if (name.startsWith("wlan") || name.startsWith("eth")) {
                        return address.getHostAddress();
                    }
                    if (fallback == null) {
                        fallback = address.getHostAddress();
                    }
                }
            }
        } catch (IOException e) {
            // fall through
        }
        return fallback != null ? fallback : "127.0.0.1";
    }

    private void accept(ServerSocket socket) {
        while (!socket.isClosed()) {
            try {
                final Socket client = socket.accept();
                Thread handler = new Thread(() -> handle(client), "pairing-client");
                handler.setDaemon(true);
                handler.start();
            } catch (IOException e) {
                return;
            }
        }
    }

    /**
     * Returns the AES key when the token matches.
     */
    private byte[] keyIfValid(String candidate) {
        String[] pairing = store.pairing();
        if (!MessageDigest.isEqual(pairing[0].getBytes(StandardCharsets.UTF_8), candidate.getBytes(StandardCharsets.UTF_8))) {
            return null;
        }
        return unhex(pairing[1]);
    }

    private void handle(Socket client) {
        try (Socket socket = client) {
            socket.setSoTimeout(10000);
            InputStream in = socket.getInputStream();
            String head = readHead(in);
            if (head == null) {
                return;
            }
            String[] lines = head.split("\r\n");
            String[] request = lines[0].split(" ");
            if (request.length < 2) {
                return;
            }
            int length = 0;
            for (String line : lines) {
                if (line.toLowerCase().startsWith("content-length:")) {
                    length = Integer.parseInt(line.substring(15).trim());
                }
            }
            OutputStream out = socket.getOutputStream();
            if (length > MAX_BODY) {
                respond(out, 413, "text/plain", "too large");
                return;
            }
            String body = new String(readBytes(in, length), StandardCharsets.UTF_8);
            route(out, request[0], request[1], body);
        } catch (Exception e) {
            // a broken client connection is not worth reporting
        }
    }

    private void route(OutputStream out, String method, String path, String body) throws Exception {
        // the page itself holds no secrets, so it is served without a token: /, /sjcl.js, /ping
        String plain = path.split("\\?")[0];
        if (method.equals("GET") && (plain.equals("/") || plain.equals("/index.html"))) {
            respond(out, 200, "text/html", readAsset("pair.html"));
            return;
        }
        if (method.equals("GET") && plain.equals("/sjcl.js")) {
            respond(out, 200, "application/javascript", readAsset("sjcl.js"));
            return;
        }
        if (method.equals("GET") && plain.equals("/ping")) {
            // lets the page opened by IP check whether drivedeck.local works on this phone
            respondCors(out, "drivedeck");
            return;
        }
        // /p/<token>[/state|/save|/send|/reset-usage|/mic-test|/unpair]
        String[] parts = plain.split("/");
        byte[] key = parts.length < 3 || !parts[1].equals("p") ? null : keyIfValid(parts[2]);
        if (key == null) {
            respond(out, 403, "text/plain", "Link ungueltig");
            return;
        }
        String action = parts.length > 3 ? parts[3] : "";
        if (method.equals("GET") && action.isEmpty()) {
            respond(out, 200, "text/html", readAsset("pair.html"));
        } else if (method.equals("GET") && action.equals("state")) {
            respond(out, 200, "application/json", encrypt(key, state().toString()).toString());
        } else if (method.equals("POST") && action.equals("mic-test")) {
            JSONObject answer;
            try {
                answer = listener.onMicTest();
            } catch (Exception e) {
                answer = new JSONObject().put("error", String.valueOf(e.getMessage()));
            }
            respond(out, 200, "application/json", encrypt(key, answer.toString()).toString());
        } else if (method.equals("POST") && action.equals("unpair")) {
            // answered with the old key, everything after this needs a new QR code
            respond(out, 200, "application/json", encrypt(key, "{\"ok\":true}").toString());
            listener.onUnpair();
        } else if (method.equals("POST") && action.equals("reset-usage")) {
            usage.reset();
            respond(out, 200, "application/json", encrypt(key, "{\"ok\":true}").toString());
        } else if (method.equals("POST") && action.equals("save")) {
            save(decrypt(key, body));
            respond(out, 200, "application/json", encrypt(key, "{\"ok\":true}").toString());
            listener.onSaved();
        } else if (method.equals("POST") && action.equals("send")) {
            JSONObject message = decrypt(key, body);
            respond(out, 200, "application/json", encrypt(key, "{\"ok\":true}").toString());
            listener.onMessage(message);
        } else {
            respond(out, 404, "text/plain", "not found");
        }
    }

    /**
     * Everything the phone page shows: the assistant settings, a hint which key is stored, the usage
     * counted in the car and the balance of the key at OpenRouter (includes speech).
     */
    private JSONObject state() throws Exception {
        JSONObject state = store.publicState();
        String apiKey = store.openRouterKey();
        if (!apiKey.isEmpty()) {
            state.put("keyHint", apiKey.substring(0, Math.min(9, apiKey.length())) + "…" + apiKey.substring(Math.max(0, apiKey.length() - 4)));
            JSONObject account = account(apiKey);
            if (account != null) {
                state.put("account", account);
            }
        }
        state.put("usage", usage.toJson());
        state.put("stt", CloudVoice.STT_MODEL);
        JSONObject data = store.load();
        state.put("ttsModel", data.optString("ttsModel", CloudVoice.DEFAULT_TTS_MODEL));
        state.put("ttsVoice", data.optString("ttsVoice", CloudVoice.DEFAULT_TTS_VOICE));
        state.put("mics", microphone.inputs());
        state.put("keys", listener.recentKeys());
        state.put("talkKey", data.optInt("talkKey", -1));
        state.put("talkMode", data.optString("talkMode", "hold3"));
        state.put("micDevice", data.optInt("micDevice", 0));
        state.put("micSource", data.optString("micSource", Microphone.MIC));
        state.put("host", MdnsResponder.HOST + ":" + PORT);
        state.put("ip", localAddress() + ":" + PORT);
        return state;
    }

    /** Usage and limit of the key as OpenRouter counts them, or null when OpenRouter cannot be reached. */
    private static JSONObject account(String apiKey) {
        try {
            HttpURLConnection http = (HttpURLConnection) new URL("https://openrouter.ai/api/v1/key").openConnection();
            http.setConnectTimeout(4000);
            http.setReadTimeout(4000);
            http.setRequestProperty("Authorization", "Bearer " + apiKey);
            if (http.getResponseCode() >= 400) {
                return null;
            }
            try (InputStream in = http.getInputStream()) {
                return new JSONObject(new String(readBytes(in, Integer.MAX_VALUE), StandardCharsets.UTF_8)).optJSONObject("data");
            }
        } catch (Exception e) {
            return null;
        }
    }

    private JSONObject encrypt(byte[] key, String plain) throws Exception {
        byte[] iv = randomBytes(12);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        byte[] sealed = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return new JSONObject().put("iv", hex(iv)).put("ct", hex(sealed));
    }

    private JSONObject decrypt(byte[] key, String body) throws Exception {
        JSONObject box = new JSONObject(body);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, unhex(box.getString("iv"))));
        return new JSONObject(new String(cipher.doFinal(unhex(box.getString("ct"))), StandardCharsets.UTF_8));
    }

    /**
     * Merges the phone's input into the store. A blank key or password keeps the stored one, so
     * changing only the model or adding one login does not need everything typed again.
     */
    private void save(JSONObject input) throws Exception {
        JSONObject data = store.load();
        String apiKey = input.optString("openrouterKey", "").trim();
        if (!apiKey.isEmpty()) {
            data.put("openrouterKey", apiKey);
        }
        String model = input.optString("model", "").trim();
        data.put("model", model.isEmpty() ? SecretStore.DEFAULT_MODEL : model);
        String ttsModel = input.optString("ttsModel", "").trim();
        data.put("ttsModel", ttsModel.isEmpty() ? CloudVoice.DEFAULT_TTS_MODEL : ttsModel);
        // wake words of older versions, the assistant only starts with a key now
        data.remove("wakeWords");
        data.put("micDevice", input.optInt("micDevice", data.optInt("micDevice", 0)));
        data.put("talkKey", input.optInt("talkKey", data.optInt("talkKey", -1)));
        data.put("talkMode", input.optString("talkMode", data.optString("talkMode", "hold3")));
        data.put("micSource", input.optString("micSource", data.optString("micSource", Microphone.MIC)));
        String ttsVoice = input.optString("ttsVoice", "").trim();
        data.put("ttsVoice", ttsVoice.isEmpty() ? CloudVoice.DEFAULT_TTS_VOICE : ttsVoice);

        JSONArray previous = data.optJSONArray("logins");
        JSONArray merged = new JSONArray();
        JSONArray incoming = input.optJSONArray("logins");
        for (int i = 0; incoming != null && i < incoming.length(); i++) {
            JSONObject login = incoming.getJSONObject(i);
            String site = login.optString("site", "").trim().toLowerCase().replaceFirst("^https?://", "").replaceFirst("/.*$", "");
            String user = login.optString("user", "").trim();
            String pass = login.optString("pass", "");
            if (site.isEmpty() || user.isEmpty()) {
                continue;
            }
            for (int j = 0; pass.isEmpty() && previous != null && j < previous.length(); j++) {
                JSONObject old = previous.getJSONObject(j);
                if (old.optString("site").equals(site) && old.optString("user").equals(user)) {
                    pass = old.optString("pass");
                }
            }
            JSONObject entry = new JSONObject();
            entry.put("site", site);
            entry.put("user", user);
            entry.put("pass", pass);
            merged.put(entry);
        }
        data.put("logins", merged);
        store.save(data);
    }

    private String readAsset(String name) throws IOException {
        try (InputStream in = context.getAssets().open(name)) {
            return new String(readBytes(in, Integer.MAX_VALUE), StandardCharsets.UTF_8);
        }
    }

    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int last = 0;
        int b;
        while (head.size() < 8192 && (b = in.read()) != -1) {
            head.write(b);
            last = (last << 8) | b;
            if (last == 0x0d0a0d0a) {
                return head.toString("UTF-8");
            }
        }
        return null;
    }

    private static byte[] readBytes(InputStream in, int length) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int remaining = length;
        while (remaining > 0) {
            int read = in.read(buffer, 0, Math.min(buffer.length, remaining));
            if (read < 0) {
                break;
            }
            out.write(buffer, 0, read);
            remaining -= read;
        }
        return out.toByteArray();
    }

    private static void respondCors(OutputStream out, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\n"
                + "Content-Length: " + bytes.length + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(bytes);
        out.flush();
    }

    private static void respond(OutputStream out, int status, String type, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + " OK\r\nContent-Type: " + type + "; charset=utf-8\r\n"
                + "Content-Length: " + bytes.length + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(bytes);
        out.flush();
    }
}
