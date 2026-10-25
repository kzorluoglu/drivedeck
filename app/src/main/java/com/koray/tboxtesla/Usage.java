package com.koray.tboxtesla;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/**
 * Counts what the assistant used since the last reset: chat tokens and cost as OpenRouter reports
 * them, seconds of transcribed speech and characters of spoken answers. Shown on the phone page.
 */
class Usage {
    private final SharedPreferences prefs;

    Usage(Context context) {
        prefs = context.getSharedPreferences("usage", Context.MODE_PRIVATE);
    }

    /** Adds the usage block of a chat completion response, ignores anything else. */
    synchronized void addChat(String responseBody) {
        try {
            JSONObject usage = new JSONObject(responseBody).optJSONObject("usage");
            if (usage == null) {
                return;
            }
            prefs.edit()
                    .putLong("requests", prefs.getLong("requests", 0) + 1)
                    .putLong("promptTokens", prefs.getLong("promptTokens", 0) + usage.optLong("prompt_tokens"))
                    .putLong("completionTokens", prefs.getLong("completionTokens", 0) + usage.optLong("completion_tokens"))
                    .putFloat("cost", prefs.getFloat("cost", 0) + (float) usage.optDouble("cost", 0))
                    .apply();
        } catch (Exception e) {
            // an answer without usage is not counted
        }
    }

    synchronized void addSpeechSeconds(double seconds) {
        prefs.edit().putFloat("sttSeconds", prefs.getFloat("sttSeconds", 0) + (float) seconds).apply();
    }

    synchronized void addSpokenChars(int chars) {
        prefs.edit().putLong("ttsChars", prefs.getLong("ttsChars", 0) + chars).apply();
    }

    synchronized void reset() {
        prefs.edit().clear().putLong("since", System.currentTimeMillis()).apply();
    }

    synchronized JSONObject toJson() {
        JSONObject out = new JSONObject();
        try {
            if (!prefs.contains("since")) {
                prefs.edit().putLong("since", System.currentTimeMillis()).apply();
            }
            out.put("since", prefs.getLong("since", 0));
            out.put("requests", prefs.getLong("requests", 0));
            out.put("promptTokens", prefs.getLong("promptTokens", 0));
            out.put("completionTokens", prefs.getLong("completionTokens", 0));
            out.put("cost", prefs.getFloat("cost", 0));
            out.put("sttSeconds", Math.round(prefs.getFloat("sttSeconds", 0)));
            out.put("ttsChars", prefs.getLong("ttsChars", 0));
        } catch (Exception e) {
            // cannot happen for plain puts
        }
        return out;
    }
}
