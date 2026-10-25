package com.koray.tboxtesla;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.util.Log;

/**
 * Keeps wireless debugging on, so the box can be reached from a computer (tools/box.sh) without the car.
 * Android switches it off at every restart and the box has no screen of its own. Writing the setting
 * needs WRITE_SECURE_SETTINGS, which only adb can grant, once:
 *
 *   adb shell pm grant com.koray.tboxtesla android.permission.WRITE_SECURE_SETTINGS
 *
 * Without the grant nothing happens. Android still only allows it on networks marked as trusted, and a
 * computer still has to be paired with the box before it can connect.
 */
public class WirelessDebug extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            enable(context);
        }
    }

    static void enable(Context context) {
        if (context.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        try {
            Settings.Global.putInt(context.getContentResolver(), "adb_wifi_enabled", 1);
        } catch (Exception e) {
            Log.w("WirelessDebug", "could not switch on wireless debugging: " + e.getMessage());
        }
    }
}
