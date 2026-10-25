package com.koray.tboxtesla;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The microphone for the assistant, as chosen on the phone page. On the box the car's microphone comes
 * over the CarPlay/Android Auto connection, and how it shows up in Android depends on the firmware: often
 * as its own input device, often only in call mode (the box then opens the phone channel to the car).
 * So the input device and the way of recording can be picked, and a test measures every combination.
 */
class Microphone {
    // how Android is asked to record: plain, tuned for speech recognition, or like a phone call
    static final String MIC = "mic";
    static final String RECOGNITION = "recognition";
    static final String CALL = "call";
    private static final String[] SOURCES = {MIC, RECOGNITION, CALL};

    private final Context context;
    private final SecretStore store;
    private final AudioManager audio;
    private int previousMode = -1;

    Microphone(Context context, SecretStore store) {
        this.context = context;
        this.store = store;
        this.audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    }

    boolean allowed() {
        return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    /** Opens a 16 kHz mono recorder for the input chosen on the phone page. close() it afterwards. */
    AudioRecord open(int rate, int bufferBytes) {
        JSONObject data = store.load();
        return open(rate, bufferBytes, data.optInt("micDevice", 0), data.optString("micSource", MIC));
    }

    private AudioRecord open(int rate, int bufferBytes, int deviceId, String source) {
        int kind = source.equals(CALL) ? MediaRecorder.AudioSource.VOICE_COMMUNICATION
                : source.equals(RECOGNITION) ? MediaRecorder.AudioSource.VOICE_RECOGNITION
                : MediaRecorder.AudioSource.MIC;
        if (source.equals(CALL)) {
            previousMode = audio.getMode();
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        }
        int minimum = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        AudioRecord recorder = new AudioRecord(kind, rate, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum, bufferBytes));
        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
            recorder.release();
            restoreMode();
            throw new IllegalStateException("Mikrofon nicht verfügbar");
        }
        AudioDeviceInfo device = input(deviceId);
        if (device != null) {
            recorder.setPreferredDevice(device);
        }
        return recorder;
    }

    void close(AudioRecord recorder) {
        try {
            recorder.stop();
        } catch (IllegalStateException e) {
            // never started
        }
        recorder.release();
        restoreMode();
    }

    private void restoreMode() {
        if (previousMode >= 0) {
            audio.setMode(previousMode);
            previousMode = -1;
        }
    }

    private AudioDeviceInfo input(int id) {
        if (id == 0) {
            return null;
        }
        for (AudioDeviceInfo device : audio.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            if (device.getId() == id) {
                return device;
            }
        }
        return null;
    }

    /** Every input Android knows: [{id, name}], id 0 is the default of the system. */
    JSONArray inputs() {
        JSONArray list = new JSONArray();
        try {
            list.put(new JSONObject().put("id", 0).put("name", "Standard"));
            for (AudioDeviceInfo device : audio.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
                list.put(new JSONObject().put("id", device.getId()).put("name", describe(device)));
            }
        } catch (Exception e) {
            // the default then
        }
        return list;
    }

    private static String describe(AudioDeviceInfo device) {
        String type;
        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_MIC:
                type = "Eingebaut";
                break;
            case AudioDeviceInfo.TYPE_USB_DEVICE:
            case AudioDeviceInfo.TYPE_USB_ACCESSORY:
            case AudioDeviceInfo.TYPE_USB_HEADSET:
                type = "USB";
                break;
            case AudioDeviceInfo.TYPE_BUS:
                type = "Fahrzeug";
                break;
            case AudioDeviceInfo.TYPE_TELEPHONY:
                type = "Telefonie";
                break;
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                type = "Bluetooth";
                break;
            case AudioDeviceInfo.TYPE_REMOTE_SUBMIX:
                type = "Weitergeleitet";
                break;
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                type = "Kabel";
                break;
            default:
                type = "Typ " + device.getType();
        }
        String product = String.valueOf(device.getProductName()).trim();
        return product.isEmpty() ? type : type + " · " + product;
    }

    /**
     * Records every input with every way of recording for a moment while the driver talks, and returns the
     * levels: [{device, name, source, peak, mean} or {..., error}]. The loudest one is the right microphone.
     */
    JSONArray test(long eachMs) {
        JSONArray results = new JSONArray();
        JSONArray devices = inputs();
        int rate = 16000;
        short[] chunk = new short[rate / 10];
        for (int d = 0; d < devices.length(); d++) {
            JSONObject device = devices.optJSONObject(d);
            for (String source : SOURCES) {
                JSONObject row = new JSONObject();
                try {
                    row.put("device", device.optInt("id")).put("name", device.optString("name")).put("source", source);
                    AudioRecord recorder = open(rate, chunk.length * 8, device.optInt("id"), source);
                    double peak = 0;
                    double total = 0;
                    int chunks = 0;
                    try {
                        recorder.startRecording();
                        long end = System.currentTimeMillis() + eachMs;
                        while (System.currentTimeMillis() < end) {
                            int read = recorder.read(chunk, 0, chunk.length);
                            if (read <= 0) {
                                break;
                            }
                            double sum = 0;
                            for (int i = 0; i < read; i++) {
                                sum += (double) chunk[i] * chunk[i];
                            }
                            double rms = Math.sqrt(sum / read);
                            peak = Math.max(peak, rms);
                            total += rms;
                            chunks++;
                        }
                    } finally {
                        close(recorder);
                    }
                    row.put("peak", Math.round(peak)).put("mean", chunks == 0 ? 0 : Math.round(total / chunks));
                } catch (Exception e) {
                    try {
                        row.put("error", String.valueOf(e.getMessage()));
                    } catch (Exception ignored) {
                        // the row stays without it
                    }
                }
                results.put(row);
            }
        }
        return results;
    }
}
