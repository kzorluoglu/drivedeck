package com.koray.tboxtesla;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Reads engine data from an ELM327 OBD adapter over classic Bluetooth (serial profile): speed, rpm,
 * coolant temperature and fuel level. The adapter has to be paired in the Android settings first.
 * Standard OBD has no gear PID, so the gear display stays P/D.
 */
class ObdClient {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final long POLL_MS = 400;

    private volatile boolean running;
    private volatile String status = "Getrennt";
    private volatile int speed = -1;
    private volatile int rpm = -1;
    private volatile int coolant = Integer.MIN_VALUE;
    private volatile int fuel = -1;
    private BluetoothSocket socket;

    @SuppressLint("MissingPermission")
    String devices() {
        JSONArray list = new JSONArray();
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter != null && adapter.isEnabled()) {
            try {
                for (BluetoothDevice device : adapter.getBondedDevices()) {
                    list.put(new JSONObject().put("name", String.valueOf(device.getName())).put("address", device.getAddress()));
                }
            } catch (Exception e) {
                // no permission or no adapter, empty list
            }
        }
        return list.toString();
    }

    @SuppressLint("MissingPermission")
    synchronized void connect(String address) {
        disconnect();
        running = true;
        status = "Verbinde ...";
        Thread thread = new Thread(() -> loop(address), "obd");
        thread.setDaemon(true);
        thread.start();
    }

    synchronized void disconnect() {
        running = false;
        status = "Getrennt";
        speed = rpm = fuel = -1;
        coolant = Integer.MIN_VALUE;
        try {
            if (socket != null) {
                socket.close();
            }
        } catch (Exception e) {
            // already closed
        }
        socket = null;
    }

    String state() {
        try {
            JSONObject state = new JSONObject();
            state.put("status", status);
            state.put("connected", "Verbunden".equals(status));
            if (speed >= 0) {
                state.put("speed", speed);
            }
            if (rpm >= 0) {
                state.put("rpm", rpm);
            }
            if (coolant != Integer.MIN_VALUE) {
                state.put("coolant", coolant);
            }
            if (fuel >= 0) {
                state.put("fuel", fuel);
            }
            return state.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @SuppressLint("MissingPermission")
    private void loop(String address) {
        try {
            BluetoothDevice device = BluetoothAdapter.getDefaultAdapter().getRemoteDevice(address);
            BluetoothSocket local = device.createRfcommSocketToServiceRecord(SPP);
            BluetoothAdapter.getDefaultAdapter().cancelDiscovery();
            local.connect();
            synchronized (this) {
                if (!running) {
                    local.close();
                    return;
                }
                socket = local;
            }
            InputStream in = local.getInputStream();
            OutputStream out = local.getOutputStream();
            for (String init : new String[] {"ATZ", "ATE0", "ATL0", "ATS0", "ATSP0"}) {
                command(in, out, init);
            }
            status = "Verbunden";
            while (running) {
                int[] value;
                if ((value = pid(in, out, "010D", 1)) != null) {
                    speed = value[0];
                }
                if ((value = pid(in, out, "010C", 2)) != null) {
                    rpm = (value[0] * 256 + value[1]) / 4;
                }
                if ((value = pid(in, out, "0105", 1)) != null) {
                    coolant = value[0] - 40;
                }
                if ((value = pid(in, out, "012F", 1)) != null) {
                    fuel = value[0] * 100 / 255;
                }
                Thread.sleep(POLL_MS);
            }
        } catch (Exception e) {
            if (running) {
                status = "Fehler: " + e.getMessage();
            }
        }
    }

    private static int[] pid(InputStream in, OutputStream out, String request, int bytes) throws Exception {
        String answer = command(in, out, request);
        String header = "41" + request.substring(2);
        int at = answer.indexOf(header);
        if (at < 0 || answer.length() < at + header.length() + bytes * 2) {
            return null;
        }
        int[] values = new int[bytes];
        for (int i = 0; i < bytes; i++) {
            int start = at + header.length() + i * 2;
            values[i] = Integer.parseInt(answer.substring(start, start + 2), 16);
        }
        return values;
    }

    /**
     * Sends a command and returns the reply without spaces, up to the ELM327 prompt '>'.
     */
    private static String command(InputStream in, OutputStream out, String command) throws Exception {
        out.write((command + "\r").getBytes(StandardCharsets.US_ASCII));
        out.flush();
        StringBuilder reply = new StringBuilder();
        long deadline = System.currentTimeMillis() + 3000;
        while (System.currentTimeMillis() < deadline) {
            if (in.available() == 0) {
                Thread.sleep(20);
                continue;
            }
            int b = in.read();
            if (b == '>') {
                break;
            }
            if (b > ' ') {
                reply.append((char) b);
            }
        }
        return reply.toString().toUpperCase();
    }
}
