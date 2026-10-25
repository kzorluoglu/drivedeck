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
 * nothing leaves the box and nothing costs money until the driver says "DriveDeck". Every recognized
 * phrase goes to the page, which decides whether it was meant for the assistant. The recognizer is
 * restarted after each phrase and steps aside while the OpenRouter voice records or speaks.
 */
class LocalWake {
    interface Heard {
        void heard(String text);
    }

    interface Busy {
        boolean busy();
    }

    private static final long CHECK_MS = 500;
    private static final long RESTART_MS = 250;
    private static final long BACKOFF_MS = 3000;

    private final Context context;
    private final AudioManager audio;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Busy micBusy;
    private final Heard heard;
    private final Heard failed;

    private SpeechRecognizer recognizer;
    private String languageTag = "de-DE";
    private boolean wanted;
    private boolean held;
    private boolean listening;
    private boolean muted;
    private long nextStart;

    LocalWake(Context context, Busy micBusy, Heard heard, Heard failed) {
        this.context = context;
        this.audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        this.micBusy = micBusy;
        this.heard = heard;
        this.failed = failed;
    }

    /** Main thread only, like everything in this class. */
    void start(String tag) {
        languageTag = tag;
        if (wanted) {
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            failed.heard("Keine Spracherkennung von Android auf diesem Gerät");
            return;
        }
        wanted = true;
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
            recognizer.setRecognitionListener(listener);
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.getPackageName());
        // the start tone of the recognizer would sound every few seconds
        mute(true);
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
        mute(false);
    }

    private void restart(long delay, boolean fresh) {
        listening = false;
        if (fresh && recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        nextStart = System.currentTimeMillis() + delay;
    }

    private void mute(boolean on) {
        if (on == muted) {
            return;
        }
        muted = on;
        int direction = on ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE;
        try {
            audio.adjustStreamVolume(AudioManager.STREAM_SYSTEM, direction, 0);
            audio.adjustStreamVolume(AudioManager.STREAM_NOTIFICATION, direction, 0);
        } catch (SecurityException e) {
            // do not disturb blocks it, then the tone stays
        }
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override
        public void onResults(Bundle results) {
            ArrayList<String> texts = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            restart(RESTART_MS, false);
            if (texts != null) {
                // the alternatives too, the wake word is often only in the second guess
                heard.heard(String.join(" | ", texts));
            }
        }

        @Override
        public void onError(int error) {
            boolean quiet = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                failed.heard("Mikrofon nicht erlaubt");
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
