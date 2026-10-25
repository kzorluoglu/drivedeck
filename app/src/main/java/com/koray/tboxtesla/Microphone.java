package com.koray.tboxtesla;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioRecordingConfiguration;
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
    static final String RAW = "raw";
    static final String CAMCORDER = "camcorder";
    private static final String[] SOURCES = {MIC, RECOGNITION, CALL, RAW, CAMCORDER};

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
                : source.equals(RAW) ? MediaRecorder.AudioSource.UNPROCESSED
                : source.equals(CAMCORDER) ? MediaRecorder.AudioSource.CAMCORDER
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
     * Records every input with every way of recording (and at 16 and 48 kHz) for a moment while the driver
     * talks, and returns the levels: [{device, name, source, rate, peak, mean, zero, routed} or {..., error}].
     * The loudest one is the right microphone. "zero" means every sample was exactly 0: Android hands this
     * app silence on purpose (another app holds the microphone, or this one is not in the foreground).
     */
    JSONArray test(long eachMs) {
        JSONArray results = new JSONArray();
        JSONArray devices = inputs();
        for (int d = 0; d < devices.length(); d++) {
            JSONObject device = devices.optJSONObject(d);
            for (String source : SOURCES) {
                for (int rate : new int[] {16000, 48000}) {
                    results.put(measure(device, source, rate, eachMs));
                }
            }
        }
        return results;
    }

    private JSONObject measure(JSONObject device, String source, int rate, long eachMs) {
        JSONObject row = new JSONObject();
        short[] chunk = new short[rate / 10];
        try {
            row.put("device", device.optInt("id")).put("name", device.optString("name")).put("source", source).put("rate", rate);
            AudioRecord recorder = open(rate, chunk.length * 8, device.optInt("id"), source);
            double peak = 0;
            double total = 0;
            int chunks = 0;
            boolean zero = true;
            try {
                recorder.startRecording();
                long end = System.currentTimeMillis() + eachMs;
                while (System.currentTimeMillis() < end) {
                    int read = recorder.read(chunk, 0, chunk.length);
                    if (read <= 0) {
                        row.put("error", "read " + read);
                        break;
                    }
                    double sum = 0;
                    for (int i = 0; i < read; i++) {
                        sum += (double) chunk[i] * chunk[i];
                        zero &= chunk[i] == 0;
                    }
                    double rms = Math.sqrt(sum / read);
                    peak = Math.max(peak, rms);
                    total += rms;
                    chunks++;
                }
                AudioDeviceInfo routed = recorder.getRoutedDevice();
                row.put("routed", routed == null ? "" : describe(routed));
            } finally {
                close(recorder);
            }
            row.put("peak", Math.round(peak)).put("mean", chunks == 0 ? 0 : Math.round(total / chunks)).put("zero", zero && chunks > 0);
        } catch (Exception e) {
            try {
                row.put("error", String.valueOf(e.getMessage()));
            } catch (Exception ignored) {
                // the row stays without it
            }
        }
        return row;
    }

    /** Android version, and who else records right now (and whether Android silences this app). */
    JSONObject system(boolean foreground) {
        JSONObject info = new JSONObject();
        try {
            info.put("android", Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
            info.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            info.put("foreground", foreground);
            info.put("allowed", allowed());
            info.put("micMuted", audio.isMicrophoneMute());
            info.put("mode", audio.getMode());
            JSONArray others = new JSONArray();
            for (AudioRecordingConfiguration config : audio.getActiveRecordingConfigurations()) {
                JSONObject other = new JSONObject().put("source", config.getClientAudioSource());
                if (Build.VERSION.SDK_INT >= 29) {
                    other.put("silenced", config.isClientSilenced());
                }
                AudioDeviceInfo device = config.getAudioDevice();
                other.put("device", device == null ? "" : describe(device));
                others.put(other);
            }
            info.put("recordings", others);
        } catch (Exception e) {
            // whatever was collected
        }
        return info;
    }
}
