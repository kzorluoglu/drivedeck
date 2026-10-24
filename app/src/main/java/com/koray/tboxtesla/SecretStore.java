package com.koray.tboxtesla;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Keeps the assistant's credentials (OpenRouter key, site logins) encrypted with a key from the
 * Android Keystore. The page never gets the secrets back, only {@link #publicState()}.
 */
class SecretStore {
    private static final String KEY_ALIAS = "drivedeck-secrets";
    private static final String PREFS = "secrets";
    private static final String BLOB = "blob";
    static final String DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";

    private final SharedPreferences prefs;

    SecretStore(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    synchronized JSONObject load() {
        String stored = prefs.getString(BLOB, null);
        if (stored != null) {
            try {
                return new JSONObject(decrypt(stored));
            } catch (Exception e) {
                // unreadable (e.g. keystore reset), start empty
            }
        }
        return new JSONObject();
    }

    synchronized void save(JSONObject data) throws Exception {
        prefs.edit().putString(BLOB, encrypt(data.toString())).apply();
    }

    synchronized void clear() {
        prefs.edit().remove(BLOB).apply();
    }

    String openRouterKey() {
        return load().optString("openrouterKey", "");
    }

    /**
     * What the UI may know: whether a key exists, the model and the logged sites with user names.
     */
    JSONObject publicState() {
        JSONObject data = load();
        JSONObject state = new JSONObject();
        try {
            state.put("hasKey", !data.optString("openrouterKey", "").isEmpty());
            state.put("model", data.optString("model", DEFAULT_MODEL));
            JSONArray logins = new JSONArray();
            JSONArray stored = data.optJSONArray("logins");
            for (int i = 0; stored != null && i < stored.length(); i++) {
                JSONObject login = stored.getJSONObject(i);
                JSONObject shown = new JSONObject();
                shown.put("site", login.optString("site"));
                shown.put("user", login.optString("user"));
                logins.put(shown);
            }
            state.put("logins", logins);
        } catch (Exception e) {
            // cannot happen for plain puts
        }
        return state;
    }

    /**
     * Returns {user, pass} of the stored login whose site matches the host, or null.
     */
    JSONObject loginFor(String host) {
        JSONArray logins = load().optJSONArray("logins");
        for (int i = 0; logins != null && i < logins.length(); i++) {
            JSONObject login = logins.optJSONObject(i);
            String site = login == null ? "" : login.optString("site").toLowerCase();
            if (!site.isEmpty() && (host.equals(site) || host.endsWith("." + site))) {
                return login;
            }
        }
        return null;
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build());
            return generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }

    private static String encrypt(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        byte[] sealed = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP);
    }

    private static String decrypt(String stored) throws Exception {
        String[] parts = stored.split(":");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
}
