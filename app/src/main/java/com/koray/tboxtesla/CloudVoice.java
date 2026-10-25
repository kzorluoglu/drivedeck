package com.koray.tboxtesla;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;

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
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Locale;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * Speech to text and text to speech through OpenRouter, so the voice does not depend on the
 * speech services of the box. The key stays on this side, like for the chat requests. Also
 * listens for the wake word: every short burst of speech is transcribed and handed to the page.
 */
class CloudVoice {
    interface Callback {
        void done(String json);
    }

    interface WakeCallback {
        void heard(String text);
    }

    private static final String BASE = "https://openrouter.ai/api/v1/audio/";
    static final String STT_MODEL = "openai/gpt-4o-mini-transcribe";
    static final String TTS_MODEL = "openai/gpt-4o-mini-tts-2025-12-15";
    static final String TTS_VOICE = "alloy";

    private static final int RATE = 16000;
    private static final int CHUNK = RATE / 10;
    private static final int NO_SPEECH_MS = 7000;
    private static final int SILENCE_END_MS = 1300;
    private static final int MAX_MS = 25000;
    private static final int CACHE_FILES = 300;
    // the wake word with a short command fits in a few seconds, longer sound is talk or music
    private static final int WAKE_SILENCE_END_MS = 700;
    private static final int WAKE_MIN_MS = 300;
    private static final int WAKE_MAX_MS = 8000;
    private static final int WAKE_PREROLL = 3;
    private static final int AFTER_SPEECH_MS = 500;

    private final Context context;
    private final SecretStore secrets;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final File cache;

    private volatile boolean finish;
    private volatile boolean cancel;
    private volatile boolean recording;
    private volatile int speakToken;
    private volatile MediaPlayer player;
    // one recorder at a time: the wake loop gives the microphone up for a command
    private final Semaphore mic = new Semaphore(1);
    private volatile boolean wakeOn;
    private volatile boolean wakeHeld;
    private volatile String wakeTag = "de-DE";
    private volatile long quietUntil;
    private Thread wakeThread;

    CloudVoice(Context context, SecretStore secrets) {
        this.context = context;
        this.secrets = secrets;
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
                    result = "{\"error\":\"" + text(languageTag, "nothing") + "\"}";
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
        int minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        AudioRecord recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum, CHUNK * 4));
        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
            recorder.release();
            throw new IllegalStateException("Mikrofon nicht verfügbar");
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        short[] chunk = new short[CHUNK];
        double floor = -1;
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
                // the first tenth of a second sets the noise level of the car, speech has to be clearly above it
                if (floor < 0) {
                    floor = rms;
                    continue;
                }
                if (rms > Math.max(600, floor * 3)) {
                    spoke = true;
                    lastVoice = now;
                } else if (!spoke) {
                    floor = Math.min(floor, Math.max(rms, 1));
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
            recorder.stop();
            recorder.release();
        }
        return spoke && !cancel ? out.toByteArray() : null;
    }

    private static byte[] wav(byte[] pcm) {
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + pcm.length)
                .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1).putShort((short) 1)
                .putInt(RATE).putInt(RATE * 2).putShort((short) 2).putShort((short) 16)
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
                .put("data", Base64.encodeToString(wav(pcm), Base64.NO_WRAP))
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
        String spoken = new JSONObject(response).optString("text", "").trim();
        return spoken.isEmpty()
                ? "{\"error\":\"" + text(languageTag, "nothing") + "\"}"
                : "{\"text\":" + JSONObject.quote(spoken) + "}";
    }

    // Wake word

    /** Starts listening for the wake word, or only switches the language when it already runs. */
    void startWake(String languageTag, WakeCallback callback) {
        wakeTag = languageTag;
        wakeOn = true;
        if (wakeThread != null && wakeThread.isAlive()) {
            return;
        }
        wakeThread = new Thread(() -> wakeLoop(callback), "wake");
        wakeThread.start();
    }

    void stopWake() {
        wakeOn = false;
    }

    /** Lets the microphone go while the app is in the background. */
    void holdWake(boolean hold) {
        wakeHeld = hold;
    }

    private boolean wakePaused() {
        return !wakeOn || wakeHeld || recording || player != null || System.currentTimeMillis() < quietUntil || !available();
    }

    private void wakeLoop(WakeCallback callback) {
        while (wakeOn) {
            if (wakePaused() || !mic.tryAcquire()) {
                pause(300);
                continue;
            }
            byte[] pcm;
            try {
                pcm = burst();
            } catch (Exception e) {
                Log.w("CloudVoice", "wake recording failed: " + e.getMessage());
                pcm = null;
                pause(2000);
            } finally {
                mic.release();
            }
            if (pcm == null) {
                continue;
            }
            try {
                String text = new JSONObject(transcribe(pcm, wakeTag)).optString("text", "");
                if (!text.isEmpty() && wakeOn) {
                    callback.heard(text);
                }
            } catch (Exception e) {
                Log.w("CloudVoice", "wake transcription failed: " + e.getMessage());
                pause(2000);
            }
        }
    }

    /**
     * Waits for a short burst of speech and returns it as PCM, or null when the loop should pause
     * or the sound was too short or too long to be the wake word.
     */
    private byte[] burst() {
        int minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        AudioRecord recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum, CHUNK * 4));
        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
            recorder.release();
            throw new IllegalStateException("Mikrofon nicht verfügbar");
        }
        ArrayDeque<byte[]> preroll = new ArrayDeque<>();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        short[] chunk = new short[CHUNK];
        double floor = -1;
        long speechStart = 0;
        long lastVoice = 0;
        recorder.startRecording();
        try {
            while (!wakePaused()) {
                int read = recorder.read(chunk, 0, chunk.length);
                if (read <= 0) {
                    return null;
                }
                double sum = 0;
                ByteBuffer bytes = ByteBuffer.allocate(read * 2).order(ByteOrder.LITTLE_ENDIAN);
                for (int i = 0; i < read; i++) {
                    sum += (double) chunk[i] * chunk[i];
                    bytes.putShort(chunk[i]);
                }
                double rms = Math.sqrt(sum / read);
                long now = System.currentTimeMillis();
                boolean voice = floor >= 0 && rms > Math.max(600, floor * 3);
                if (speechStart == 0) {
                    // the noise level of the car drifts, so it follows the quiet parts slowly
                    floor = floor < 0 ? rms : floor * 0.95 + Math.max(rms, 1) * 0.05;
                    preroll.addLast(bytes.array());
                    if (preroll.size() > WAKE_PREROLL) {
                        preroll.removeFirst();
                    }
                    if (voice) {
                        speechStart = now;
                        lastVoice = now;
                        for (byte[] part : preroll) {
                            out.write(part, 0, part.length);
                        }
                    }
                    continue;
                }
                out.write(bytes.array(), 0, read * 2);
                if (voice) {
                    lastVoice = now;
                }
                if (now - speechStart > WAKE_MAX_MS) {
                    return null;
                }
                if (now - lastVoice > WAKE_SILENCE_END_MS) {
                    return lastVoice - speechStart >= WAKE_MIN_MS ? out.toByteArray() : null;
                }
            }
            return null;
        } finally {
            recorder.stop();
            recorder.release();
        }
    }

    private static void pause(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    // Text to speech

    /**
     * Speaks the text. A newer call replaces the one before. If the service cannot be reached, fallback runs
     * on the main thread, so the system voice can take over.
     */
    void speak(String text, String languageTag, Runnable fallback) {
        int token = ++speakToken;
        stopSpeaking(false);
        new Thread(() -> {
            try {
                File file = audioFor(text, languageTag);
                main.post(() -> {
                    if (token == speakToken) {
                        play(file, fallback);
                    }
                });
            } catch (Exception e) {
                Log.w("CloudVoice", "speech failed, using the system voice: " + e.getMessage());
                main.post(() -> {
                    if (token == speakToken) {
                        fallback.run();
                    }
                });
            }
        }, "tts").start();
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

    private void play(File file, Runnable fallback) {
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
                fallback.run();
                return true;
            });
            next.prepare();
            player = next;
            next.start();
        } catch (Exception e) {
            fallback.run();
        }
    }

    private File audioFor(String text, String languageTag) throws Exception {
        String key = secrets.openRouterKey();
        if (key.isEmpty()) {
            throw new IOException("no key");
        }
        File file = new File(cache, sha1(TTS_MODEL + TTS_VOICE + languageTag + text) + ".mp3");
        if (file.exists() && file.length() > 0) {
            file.setLastModified(System.currentTimeMillis());
            return file;
        }
        JSONObject request = new JSONObject()
                .put("model", TTS_MODEL)
                .put("input", text)
                .put("voice", TTS_VOICE)
                .put("response_format", "mp3")
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
        File part = new File(cache, file.getName() + ".part");
        try (InputStream in = http.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) > 0) {
                out.write(buffer, 0, read);
            }
        }
        if (part.length() == 0 || !part.renameTo(file)) {
            part.delete();
            throw new IOException("empty audio");
        }
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

    static String text(String tag, String key) {
        boolean tr = tag.startsWith("tr");
        boolean en = tag.startsWith("en");
        if (key.equals("nokey")) {
            return tr ? "OpenRouter anahtarı yok, lütfen eşleştir" : en ? "No OpenRouter key, please pair" : "Kein OpenRouter Schlüssel, bitte koppeln";
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
