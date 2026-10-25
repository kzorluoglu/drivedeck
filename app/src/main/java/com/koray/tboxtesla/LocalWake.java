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

import java.util.ArrayList;

/**
 * Listens for the wake word with the speech recognizer of Android, preferring its offline model, so
 * nothing goes to OpenRouter until the driver says "DriveDeck". Every recognized phrase goes to the
 * page with all guesses of the recognizer, the page decides whether it started with the wake word.
 * The recognizer is restarted after each phrase and steps aside while the OpenRouter voice records or
 * speaks.
 */
class LocalWake {
    interface Busy {
        boolean busy();
    }

    interface Listener {
        void heard(String text);

        /** state: ready, off or error (detail = message). */
        void status(String state, String detail);
    }

    private static final long CHECK_MS = 500;
    private static final long RESTART_MS = 250;
    private static final long BACKOFF_MS = 3000;
    // the start tone of the recognizer plays right after startListening
    private static final long TONE_MS = 600;

    private final Context context;
    private final AudioManager audio;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Busy micBusy;
    private final Listener listener;

    private SpeechRecognizer recognizer;
    private String languageTag = "de-DE";
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
        languageTag = tag;
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
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
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

    private final RecognitionListener callbacks = new RecognitionListener() {
        @Override
        public void onResults(Bundle results) {
            ArrayList<String> texts = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            restart(RESTART_MS, false);
            if (texts != null && !texts.isEmpty()) {
                listener.heard(String.join(" | ", texts));
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
