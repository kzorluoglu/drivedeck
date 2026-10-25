package com.koray.tboxtesla;

import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.ArrayList;

/**
 * Listens for the wake word with the speech recognizer of Android, preferring its offline model, so
 * nothing goes to OpenRouter until the driver says "DriveDeck". Every recognized phrase goes to the
 * page with all guesses of the recognizer, the page decides whether it started with the wake word.
 * The recognizer is restarted after each phrase and steps aside while the OpenRouter voice records or
 * speaks.
 *
 * "DriveDeck" is English, so the English recognizer listens first, whatever the app language is. When a
 * setup keeps failing (language not installed, no offline model) the next one is tried: English online,
 * then the app language offline and online. The last phrases and errors are kept for the phone page.
 */
class LocalWake {
    interface Busy {
        boolean busy();
    }

    interface Listener {
        /** text: the guesses separated by " | ", language: the tag the recognizer listened in. */
        void heard(String text, String language);

        /** state: ready, off or error (detail = message). */
        void status(String state, String detail);
    }

    private static final long CHECK_MS = 500;
    private static final long RESTART_MS = 250;
    private static final long BACKOFF_MS = 3000;
    // the start tone of the recognizer plays right after startListening
    private static final long TONE_MS = 600;
    private static final int FAILURES_BEFORE_SWITCH = 2;
    private static final int KEEP = 10;

    private final Context context;
    private final AudioManager audio;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Busy micBusy;
    private final Listener listener;

    private SpeechRecognizer recognizer;
    private String appTag = "de-DE";
    // setups in the order they are tried: language and whether the offline model is asked for
    private String[][] setups = {};
    private int setup;
    private int failures;
    private final ArrayDeque<JSONObject> heardLog = new ArrayDeque<>();
    private String lastError = "";
    private boolean wanted;
    private boolean held;
    private boolean listening;
    private boolean systemMuted;
    private boolean musicMuted;
    private long nextStart;

    LocalWake(Context context, Busy micBusy, Listener listener) {
        this.context = context;
        this.audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        this.micBusy = micBusy;
        this.listener = listener;
    }

    /** Main thread only, like everything in this class. */
    void start(String tag) {
        if (!tag.equals(appTag) || setups.length == 0) {
            appTag = tag;
            setups = tag.startsWith("en")
                    ? new String[][] {{"en-US", "offline"}, {"en-US", "online"}}
                    : new String[][] {{"en-US", "offline"}, {"en-US", "online"}, {tag, "offline"}, {tag, "online"}};
            setup = 0;
            failures = 0;
        }
        if (wanted) {
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            listener.status("error", "Keine Spracherkennung von Android auf diesem Gerät");
            return;
        }
        wanted = true;
        listener.status("ready", "");
        main.post(tick);
    }

    void stop() {
        wanted = false;
        main.removeCallbacks(tick);
        halt();
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        listener.status("off", "");
    }

    /** Stops listening now and stays quiet for a moment, so a recording can take the microphone. */
    void pauseFor(long ms) {
        halt();
        nextStart = System.currentTimeMillis() + ms;
    }

    /** Lets the microphone go while the app is in the background. */
    void hold(boolean hold) {
        held = hold;
        if (hold) {
            halt();
        }
    }

    // Starts the recognizer when it may listen, stops it when the microphone is needed elsewhere
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!wanted) {
                return;
            }
            boolean mayListen = !held && !micBusy.busy();
            if (!mayListen && listening) {
                halt();
            } else if (mayListen && !listening && System.currentTimeMillis() >= nextStart) {
                listen();
            }
            main.postDelayed(this, CHECK_MS);
        }
    };

    private void listen() {
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(context);
            recognizer.setRecognitionListener(callbacks);
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, setups[setup][0]);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, setups[setup][1].equals("offline"));
        // several guesses: with an accent the wake word is often only the second or third one
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.getPackageName());
        muteTone();
        listening = true;
        try {
            recognizer.startListening(intent);
        } catch (Exception e) {
            Log.w("LocalWake", "start failed: " + e.getMessage());
            restart(BACKOFF_MS, true);
        }
    }

    private void halt() {
        if (listening && recognizer != null) {
            recognizer.cancel();
        }
        listening = false;
        unmuteSystem();
        unmuteMusic();
    }

    private void restart(long delay, boolean fresh) {
        listening = false;
        if (fresh && recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        nextStart = System.currentTimeMillis() + delay;
    }

    /**
     * The recognizer beeps at every start, which happens every few seconds. Depending on the device the
     * tone goes to the system, notification or music stream. System and notification stay muted while the
     * wake word is listened for, music only for the moment of the tone and only when nothing is playing.
     */
    private void muteTone() {
        if (!systemMuted) {
            systemMuted = true;
            adjust(AudioManager.STREAM_SYSTEM, true);
            adjust(AudioManager.STREAM_NOTIFICATION, true);
        }
        if (!musicMuted && !audio.isMusicActive()) {
            musicMuted = true;
            adjust(AudioManager.STREAM_MUSIC, true);
            main.postDelayed(this::unmuteMusic, TONE_MS);
        }
    }

    private void unmuteSystem() {
        if (systemMuted) {
            systemMuted = false;
            adjust(AudioManager.STREAM_SYSTEM, false);
            adjust(AudioManager.STREAM_NOTIFICATION, false);
        }
    }

    private void unmuteMusic() {
        if (musicMuted) {
            musicMuted = false;
            adjust(AudioManager.STREAM_MUSIC, false);
        }
    }

    private void adjust(int stream, boolean mute) {
        try {
            audio.adjustStreamVolume(stream, mute ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE, 0);
        } catch (SecurityException e) {
            // do not disturb blocks it, then the tone stays
        }
    }

    /** A setup that keeps failing is given up for the next one. */
    private void failed(int error) {
        lastError = describe(error) + " (" + setups[setup][0] + ", " + setups[setup][1] + ")";
        failures++;
        if (failures >= FAILURES_BEFORE_SWITCH && setup + 1 < setups.length) {
            setup++;
            failures = 0;
        }
        listener.status(failures == 0 ? "ready" : "error", lastError);
    }

    private static String describe(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "kein Netz für die Spracherkennung";
            case SpeechRecognizer.ERROR_AUDIO:
                return "Mikrofon liefert nichts";
            case SpeechRecognizer.ERROR_SERVER:
                return "Spracherkennung antwortet nicht";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "Spracherkennung belegt";
            case 12:
                return "Sprache nicht unterstützt";
            case 13:
                return "Sprachpaket nicht installiert";
            default:
                return "Fehler " + error;
        }
    }

    private void remember(String text) {
        try {
            synchronized (heardLog) {
                heardLog.addFirst(new JSONObject().put("at", System.currentTimeMillis()).put("text", text));
                while (heardLog.size() > KEEP) {
                    heardLog.removeLast();
                }
            }
        } catch (Exception e) {
            // only diagnostics
        }
    }

    /** For the phone page: what is listening, the last phrases and the last error. Any thread. */
    JSONObject diagnostics() {
        JSONObject out = new JSONObject();
        try {
            String[] current = setups.length > 0 ? setups[setup] : new String[] {"", ""};
            out.put("on", wanted).put("language", current[0]).put("mode", current[1]).put("error", lastError);
            synchronized (heardLog) {
                out.put("heard", new JSONArray(heardLog));
            }
        } catch (Exception e) {
            // only diagnostics
        }
        return out;
    }

    private final RecognitionListener callbacks = new RecognitionListener() {
        @Override
        public void onResults(Bundle results) {
            ArrayList<String> texts = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            restart(RESTART_MS, false);
            failures = 0;
            if (texts != null && !texts.isEmpty()) {
                String text = String.join(" | ", texts);
                remember(text);
                listener.heard(text, setups[setup][0]);
            }
        }

        @Override
        public void onError(int error) {
            boolean quiet = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                listener.status("error", "Mikrofon nicht erlaubt");
                stop();
                return;
            }
            if (!quiet) {
                Log.w("LocalWake", "recognizer error " + error);
                failed(error);
            }
            restart(quiet ? RESTART_MS : BACKOFF_MS, !quiet);
        }

        @Override
        public void onReadyForSpeech(Bundle params) { }

        @Override
        public void onBeginningOfSpeech() { }

        @Override
        public void onRmsChanged(float rmsdB) { }

        @Override
        public void onBufferReceived(byte[] buffer) { }

        @Override
        public void onEndOfSpeech() { }

        @Override
        public void onPartialResults(Bundle partialResults) { }

        @Override
        public void onEvent(int eventType, Bundle params) { }
    };
}
