package com.koray.tboxtesla;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Locale;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * Speech to text and text to speech through OpenRouter, so the voice does not depend on the
 * speech services of the box. The key stays on this side, like for the chat requests. The microphone
 * is only opened when the driver starts the assistant (a held key), nothing is listened to before.
 */
class CloudVoice {
    interface Callback {
        void done(String json);
    }

    interface ErrorCallback {
        void failed(String message);
    }

    private static final String BASE = "https://openrouter.ai/api/v1/audio/";
    static final String STT_MODEL = "openai/gpt-4o-mini-transcribe";
    // any model of https://openrouter.ai/api/v1/models?output_modalities=speech, chosen on the phone page
    static final String DEFAULT_TTS_MODEL = "google/gemini-3.8-flash-tts";
    static final String DEFAULT_TTS_VOICE = "Kore";
    // raw PCM of the speech endpoint: 24 kHz, 16 bit, mono
    private static final int TTS_RATE = 24000;

    private static final int RATE = 16000;
    private static final int CHUNK = RATE / 10;
    private static final int NO_SPEECH_MS = 7000;
    private static final int SILENCE_END_MS = 1300;
    private static final int MAX_MS = 25000;
    // speech has to be this loud at least, and clearly above the noise of the car
    private static final double MIN_SPEECH = 150;
    private static final double OVER_NOISE = 2.5;
    // the noise level is guessed this high at first, the driver may start talking right away
    private static final double FIRST_NOISE = 300;
    private static final int CACHE_FILES = 300;
    private static final int AFTER_SPEECH_MS = 500;

    private final Context context;
    private final SecretStore secrets;
    private final Usage usage;
    private final Microphone microphone;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final File cache;

    private volatile boolean finish;
    private volatile boolean cancel;
    private volatile boolean recording;
    private volatile int speakToken;
    private volatile MediaPlayer player;
    // one recording at a time
    private final Semaphore mic = new Semaphore(1);
    private volatile long quietUntil;
    // loudest level of the last recording, reported with "nothing understood" to see what the microphone gets
    private volatile int lastPeak;

    CloudVoice(Context context, SecretStore secrets, Usage usage, Microphone microphone) {
        this.context = context;
        this.secrets = secrets;
        this.usage = usage;
        this.microphone = microphone;
        cache = new File(context.getCacheDir(), "tts");
        cache.mkdirs();
        prune();
    }

    boolean available() {
        return !secrets.openRouterKey().isEmpty();
    }

    // Speech to text

    /** Ends the recording and transcribes what was said so far. */
    void finishListening() {
        finish = true;
    }

    /** Ends the recording and throws it away. */
    void cancelListening() {
        cancel = true;
        finish = true;
    }

    /**
     * Records from the microphone until the speaker stops talking, then transcribes. The callback gets
     * {"text":...} or {"error":...}. Needs the RECORD_AUDIO permission.
     */
    void listen(String languageTag, Runnable onReady, Callback callback) {
        finish = false;
        cancel = false;
        recording = true;
        new Thread(() -> {
            String result;
            try {
                // a question of the assistant is spoken first, the answer is recorded after it
                long deadline = System.currentTimeMillis() + 20000;
                while ((player != null || System.currentTimeMillis() < quietUntil) && System.currentTimeMillis() < deadline) {
                    Thread.sleep(100);
                }
                if (!mic.tryAcquire(3, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Mikrofon belegt");
                }
                byte[] pcm;
                try {
                    pcm = record(onReady);
                } finally {
                    mic.release();
                }
                recording = false;
                if (cancel) {
                    result = "{\"error\":\"" + text(languageTag, "nothing") + "\"}";
                } else if (pcm == null) {
                    result = "{\"error\":\"" + nothing(languageTag) + "\"}";
                } else {
                    result = transcribe(pcm, languageTag);
                }
            } catch (Exception e) {
                Log.w("CloudVoice", "transcription failed: " + e.getMessage());
                recording = false;
                result = "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
            }
            callback.done(result);
        }, "stt").start();
    }

    /** Returns 16 kHz mono PCM of the speech, or null when nobody spoke. */
    private byte[] record(Runnable onReady) {
        // the input chosen on the phone page, the car's microphone when the box offers it
        AudioRecord recorder = microphone.open(RATE, CHUNK * 4);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        short[] chunk = new short[CHUNK];
        double floor = -1;
        double peak = 0;
        boolean spoke = false;
        long start = System.currentTimeMillis();
        long lastVoice = start;
        recorder.startRecording();
        main.post(onReady);
        try {
            while (!finish) {
                int read = recorder.read(chunk, 0, chunk.length);
                if (read <= 0) {
                    break;
                }
                double sum = 0;
                ByteBuffer bytes = ByteBuffer.allocate(read * 2).order(ByteOrder.LITTLE_ENDIAN);
                for (int i = 0; i < read; i++) {
                    sum += (double) chunk[i] * chunk[i];
                    bytes.putShort(chunk[i]);
                }
                out.write(bytes.array(), 0, read * 2);
                double rms = Math.sqrt(sum / read);
                long now = System.currentTimeMillis();
                peak = Math.max(peak, rms);
                if (floor < 0) {
                    floor = Math.min(rms, FIRST_NOISE);
                }
                if (rms > Math.max(MIN_SPEECH, floor * OVER_NOISE)) {
                    spoke = true;
                    lastVoice = now;
                } else {
                    // the noise of the car follows the quiet moments, up and down
                    floor = floor * 0.9 + Math.max(rms, 1) * 0.1;
                }
                if (spoke && now - lastVoice > SILENCE_END_MS) {
                    break;
                }
                if (!spoke && now - start > NO_SPEECH_MS) {
                    break;
                }
                if (now - start > MAX_MS) {
                    break;
                }
            }
        } finally {
            microphone.close(recorder);
        }
        lastPeak = (int) Math.round(peak);
        if (cancel) {
            return null;
        }
        // nothing looked like speech, but something was audible: OpenRouter decides, a quiet microphone
        // in a loud car should not lose the command
        return spoke || peak >= MIN_SPEECH / 2 ? out.toByteArray() : null;
    }

    private static byte[] wav(byte[] pcm, int rate) {
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + pcm.length)
                .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1).putShort((short) 1)
                .putInt(rate).putInt(rate * 2).putShort((short) 2).putShort((short) 16)
                .put("data".getBytes(StandardCharsets.US_ASCII)).putInt(pcm.length);
        byte[] all = Arrays.copyOf(header.array(), 44 + pcm.length);
        System.arraycopy(pcm, 0, all, 44, pcm.length);
        return all;
    }

    private String transcribe(byte[] pcm, String languageTag) throws Exception {
        String key = secrets.openRouterKey();
        if (key.isEmpty()) {
            return "{\"error\":\"" + text(languageTag, "nokey") + "\"}";
        }
        JSONObject audio = new JSONObject()
                .put("data", Base64.encodeToString(wav(pcm, RATE), Base64.NO_WRAP))
                .put("format", "wav");
        JSONObject request = new JSONObject()
                .put("model", STT_MODEL)
                .put("input_audio", audio)
                .put("language", languageTag.substring(0, 2).toLowerCase(Locale.ROOT));
        HttpURLConnection http = open("transcriptions", key, 30000);
        try (OutputStream body = http.getOutputStream()) {
            body.write(request.toString().getBytes(StandardCharsets.UTF_8));
        }
        int status = http.getResponseCode();
        String response = readAll(status < 400 ? http.getInputStream() : http.getErrorStream());
        if (status >= 400) {
            return "{\"error\":" + JSONObject.quote("OpenRouter " + status + ": " + shorten(response)) + "}";
        }
        usage.addSpeechSeconds(pcm.length / 2.0 / RATE);
        String spoken = new JSONObject(response).optString("text", "").trim();
        return spoken.isEmpty()
                ? "{\"error\":\"" + nothing(languageTag) + "\"}"
                : "{\"text\":" + JSONObject.quote(spoken) + "}";
    }

    /** Measures every input for the phone page (see Microphone.test), while nothing else records. */
    JSONArray testMicrophone() throws Exception {
        if (!microphone.allowed()) {
            throw new IllegalStateException("Mikrofon nicht erlaubt, einmal im Auto die Spracheingabe starten");
        }
        if (!mic.tryAcquire(5, TimeUnit.SECONDS)) {
            throw new IllegalStateException("Mikrofon belegt");
        }
        try {
            return microphone.test(1500);
        } finally {
            mic.release();
        }
    }

    // Text to speech

    /**
     * Speaks the text through OpenRouter. A newer call replaces the one before. There is no local voice:
     * when OpenRouter fails, onError gets the reason on the main thread and nothing is spoken.
     */
    void speak(String text, String languageTag, ErrorCallback onError) {
        int token = ++speakToken;
        stopSpeaking(false);
        new Thread(() -> {
            try {
                File file = audioFor(text, languageTag);
                main.post(() -> {
                    if (token == speakToken) {
                        play(file, onError);
                    }
                });
            } catch (Exception e) {
                Log.w("CloudVoice", "speech failed: " + e.getMessage());
                main.post(() -> onError.failed(String.valueOf(e.getMessage())));
            }
        }, "tts").start();
    }

    /** Model and voice for the speech output, as set on the phone page. */
    String[] ttsChoice() {
        JSONObject data = secrets.load();
        String model = data.optString("ttsModel", "").trim();
        String voice = data.optString("ttsVoice", "").trim();
        return new String[] {model.isEmpty() ? DEFAULT_TTS_MODEL : model, voice.isEmpty() ? DEFAULT_TTS_VOICE : voice};
    }

    void stopSpeaking(boolean invalidate) {
        if (invalidate) {
            speakToken++;
        }
        if (player != null) {
            try {
                player.stop();
            } catch (IllegalStateException e) {
                // already finished
            }
            player.release();
            player = null;
            quietUntil = System.currentTimeMillis() + AFTER_SPEECH_MS;
        }
    }

    private void play(File file, ErrorCallback onError) {
        try {
            stopSpeaking(false);
            MediaPlayer next = new MediaPlayer();
            next.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            next.setDataSource(file.getAbsolutePath());
            next.setOnCompletionListener((p) -> {
                p.release();
                if (player == p) {
                    player = null;
                    quietUntil = System.currentTimeMillis() + AFTER_SPEECH_MS;
                }
            });
            next.setOnErrorListener((p, what, extra) -> {
                p.release();
                if (player == p) {
                    player = null;
                    quietUntil = System.currentTimeMillis() + AFTER_SPEECH_MS;
                }
                onError.failed("Wiedergabe fehlgeschlagen (" + what + ")");
                return true;
            });
            next.prepare();
            player = next;
            next.start();
        } catch (Exception e) {
            onError.failed("Wiedergabe fehlgeschlagen: " + e.getMessage());
        }
    }

    private File audioFor(String text, String languageTag) throws Exception {
        String key = secrets.openRouterKey();
        if (key.isEmpty()) {
            throw new IOException("no key");
        }
        String[] choice = ttsChoice();
        String name = sha1(choice[0] + choice[1] + languageTag + text);
        for (String ext : new String[] {".wav", ".mp3"}) {
            File cached = new File(cache, name + ext);
            if (cached.exists() && cached.length() > 0) {
                cached.setLastModified(System.currentTimeMillis());
                return cached;
            }
        }
        // PCM is the format every provider can deliver (Gemini only that), MiniMax answers with MP3 anyway
        JSONObject request = new JSONObject()
                .put("model", choice[0])
                .put("input", text)
                .put("voice", choice[1])
                .put("response_format", "pcm")
                .put("instructions", "Speak " + languageName(languageTag)
                        + " clearly and naturally, calm and friendly, like a good car assistant.");
        HttpURLConnection http = open("speech", key, 15000);
        try (OutputStream body = http.getOutputStream()) {
            body.write(request.toString().getBytes(StandardCharsets.UTF_8));
        }
        int status = http.getResponseCode();
        if (status >= 400) {
            throw new IOException("OpenRouter " + status + ": " + shorten(readAll(http.getErrorStream())));
        }
        boolean mp3 = String.valueOf(http.getContentType()).contains("mpeg");
        byte[] audio;
        try (InputStream in = http.getInputStream()) {
            ByteArrayOutputStream all = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) > 0) {
                all.write(buffer, 0, read);
            }
            audio = all.toByteArray();
        }
        if (audio.length == 0) {
            throw new IOException("leere Antwort");
        }
        File file = new File(cache, name + (mp3 ? ".mp3" : ".wav"));
        File part = new File(cache, file.getName() + ".part");
        try (FileOutputStream out = new FileOutputStream(part)) {
            out.write(mp3 ? audio : wav(audio, TTS_RATE));
        }
        if (!part.renameTo(file)) {
            part.delete();
            throw new IOException("empty audio");
        }
        usage.addSpokenChars(text.length());
        prune();
        return file;
    }

    // Helpers

    private HttpURLConnection open(String endpoint, String key, int readTimeout) throws IOException {
        HttpURLConnection http = (HttpURLConnection) new URL(BASE + endpoint).openConnection();
        http.setConnectTimeout(6000);
        http.setReadTimeout(readTimeout);
        http.setRequestMethod("POST");
        http.setDoOutput(true);
        http.setRequestProperty("Authorization", "Bearer " + key);
        http.setRequestProperty("Content-Type", "application/json");
        http.setRequestProperty("X-Title", "DriveDeck");
        return http;
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) {
            return "";
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) > 0) {
            out.write(buffer, 0, read);
        }
        return out.toString("UTF-8");
    }

    private static String shorten(String text) {
        return text.length() > 200 ? text.substring(0, 200) : text;
    }

    private static String sha1(String text) throws Exception {
        StringBuilder hex = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-1").digest(text.getBytes(StandardCharsets.UTF_8))) {
            hex.append(String.format("%02x", b));
        }
        return hex.toString();
    }

    private static String languageName(String tag) {
        if (tag.startsWith("tr")) {
            return "Turkish";
        }
        return tag.startsWith("en") ? "English" : "German";
    }

    /** "Nothing understood" with the loudest level of the recording, a few hundred is normal speech. */
    private String nothing(String tag) {
        return text(tag, "nothing") + " (" + text(tag, "level") + " " + lastPeak + ")";
    }

    static String text(String tag, String key) {
        boolean tr = tag.startsWith("tr");
        boolean en = tag.startsWith("en");
        if (key.equals("nokey")) {
            return tr ? "OpenRouter anahtarı yok, lütfen eşleştir" : en ? "No OpenRouter key, please pair" : "Kein OpenRouter Schlüssel, bitte koppeln";
        }
        if (key.equals("level")) {
            return tr ? "ses seviyesi" : en ? "level" : "Pegel";
        }
        return tr ? "Anlaşılamadı" : en ? "Nothing understood" : "Nichts verstanden";
    }

    private void prune() {
        File[] files = cache.listFiles();
        if (files == null || files.length <= CACHE_FILES) {
            return;
        }
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        for (int i = 0; i < files.length - CACHE_FILES; i++) {
            files[i].delete();
        }
    }
}
