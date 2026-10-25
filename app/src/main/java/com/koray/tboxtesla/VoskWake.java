package com.koray.tboxtesla;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.io.File;
import java.io.FilterInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Semaphore;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Listens for the wake word "DriveDeck" with Vosk, fully offline and without the start tone of the
 * Android recognizer. The recognizer only knows the words "drive deck", everything else ends up
 * as unknown, so no other speech is understood or kept. The small English model is downloaded once
 * (about 40 MB) and then works without internet.
 */
class VoskWake {
    interface Busy {
        boolean busy();
    }

    interface Listener {
        void woke();

        /** state: loading (detail = percent), ready, off or error (detail = message). */
        void status(String state, String detail);
    }

    private static final String MODEL_NAME = "vosk-model-small-en-us-0.15";
    private static final String MODEL_URL = "https://alphacephei.com/vosk/models/" + MODEL_NAME + ".zip";
    private static final String GRAMMAR = "[\"drive deck\", \"dry deck\", \"[unk]\"]";
    private static final int RATE = 16000;
    private static final int CHUNK = RATE / 10;
    // both words have to be recognized with at least this confidence
    private static final double MIN_CONFIDENCE = 0.6;

    private final File dir;
    private final Semaphore mic;
    private final Busy busy;
    private final Listener listener;

    private volatile boolean wanted;
    private volatile boolean held;
    private Thread thread;
    private Model model;

    VoskWake(Context context, Semaphore mic, Busy busy, Listener listener) {
        this.dir = new File(context.getFilesDir(), "vosk");
        this.mic = mic;
        this.busy = busy;
        this.listener = listener;
    }

    synchronized void start() {
        wanted = true;
        if (thread != null && thread.isAlive()) {
            return;
        }
        thread = new Thread(this::run, "wake");
        thread.start();
    }

    void stop() {
        wanted = false;
        listener.status("off", "");
    }

    /** Lets the microphone go while the app is in the background. */
    void hold(boolean hold) {
        held = hold;
    }

    private boolean paused() {
        return !wanted || held || busy.busy();
    }

    private void run() {
        try {
            if (model == null) {
                LibVosk.setLogLevel(LogLevel.WARNINGS);
                model = new Model(ensureModel().getAbsolutePath());
            }
        } catch (Exception e) {
            Log.w("VoskWake", "model not ready: " + e.getMessage());
            listener.status("error", "Modell für \"DriveDeck\" nicht geladen: " + e.getMessage());
            return;
        }
        listener.status("ready", "");
        while (wanted) {
            if (paused() || !mic.tryAcquire()) {
                pause(200);
                continue;
            }
            boolean woke;
            try {
                woke = listen();
            } catch (Exception e) {
                Log.w("VoskWake", "listening failed: " + e.getMessage());
                woke = false;
                pause(2000);
            } finally {
                mic.release();
            }
            if (woke && wanted) {
                listener.woke();
                // the command is recorded next, give it the microphone
                pause(1500);
            }
        }
    }

    /** Feeds the microphone to the recognizer until the wake word was heard (true) or the loop has to pause. */
    private boolean listen() throws IOException {
        int minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        AudioRecord recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum, CHUNK * 4));
        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
            recorder.release();
            throw new IllegalStateException("Mikrofon nicht verfügbar");
        }
        short[] buffer = new short[CHUNK];
        try (Recognizer recognizer = new Recognizer(model, RATE, GRAMMAR)) {
            recognizer.setWords(true);
            recorder.startRecording();
            while (!paused()) {
                int read = recorder.read(buffer, 0, buffer.length);
                if (read <= 0) {
                    return false;
                }
                if (recognizer.acceptWaveForm(buffer, read) && heardWakeWord(recognizer.getResult())) {
                    return true;
                }
            }
            return false;
        } finally {
            recorder.stop();
            recorder.release();
        }
    }

    /**
     * True when the phrase was the wake word on its own: "drive deck" (or "dry deck", how a Turkish
     * "drayv dek" arrives), at most one unknown sound next to it and both words with a good confidence.
     * Inside a longer sentence ("Drei Decken liegen hinten", "I drive to the deck") it does not count.
     */
    private static boolean heardWakeWord(String json) {
        try {
            JSONArray words = new JSONObject(json).optJSONArray("result");
            if (words == null) {
                return false;
            }
            JSONObject first = null;
            JSONObject second = null;
            int unknown = 0;
            for (int i = 0; i < words.length(); i++) {
                JSONObject word = words.getJSONObject(i);
                if (word.optString("word").equals("[unk]")) {
                    unknown++;
                } else if (first == null) {
                    first = word;
                } else if (second == null) {
                    second = word;
                } else {
                    return false;
                }
            }
            return unknown <= 1 && first != null && second != null
                    && (first.optString("word").equals("drive") || first.optString("word").equals("dry"))
                    && second.optString("word").equals("deck")
                    && first.optDouble("conf") >= MIN_CONFIDENCE && second.optDouble("conf") >= MIN_CONFIDENCE;
        } catch (Exception e) {
            return false;
        }
    }

    /** Returns the model folder, downloads and unpacks it on the first start. */
    private File ensureModel() throws IOException {
        File folder = new File(dir, MODEL_NAME);
        File done = new File(folder, ".complete");
        if (done.exists()) {
            return folder;
        }
        dir.mkdirs();
        HttpURLConnection http = (HttpURLConnection) new URL(MODEL_URL).openConnection();
        http.setConnectTimeout(10000);
        http.setReadTimeout(30000);
        if (http.getResponseCode() != 200) {
            throw new IOException("HTTP " + http.getResponseCode());
        }
        long total = http.getContentLengthLong();
        int lastPercent = -1;
        try (CountingStream counted = new CountingStream(http.getInputStream()); ZipInputStream zip = new ZipInputStream(counted)) {
            ZipEntry entry;
            byte[] chunk = new byte[16384];
            while ((entry = zip.getNextEntry()) != null) {
                File target = new File(dir, entry.getName());
                // nothing outside the folder, whatever the archive says
                if (!target.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator)) {
                    throw new IOException("bad entry " + entry.getName());
                }
                if (entry.isDirectory()) {
                    target.mkdirs();
                    continue;
                }
                target.getParentFile().mkdirs();
                try (OutputStream out = new FileOutputStream(target)) {
                    int n;
                    while ((n = zip.read(chunk)) > 0) {
                        out.write(chunk, 0, n);
                    }
                }
                int percent = total > 0 ? (int) (counted.count * 100 / total) : 0;
                if (percent != lastPercent) {
                    lastPercent = percent;
                    listener.status("loading", String.valueOf(percent));
                }
            }
        }
        if (!folder.isDirectory() || !done.createNewFile()) {
            throw new IOException("Modell unvollständig");
        }
        return folder;
    }

    /** Counts the downloaded bytes for the progress. */
    private static final class CountingStream extends FilterInputStream {
        long count;

        CountingStream(InputStream in) {
            super(in);
        }

        @Override
        public int read() throws IOException {
            int b = super.read();
            if (b >= 0) {
                count++;
            }
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            int n = super.read(b, off, len);
            if (n > 0) {
                count += n;
            }
            return n;
        }
    }

    private static void pause(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
