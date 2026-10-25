package com.koray.tboxtesla;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Answers multicast DNS questions for drivedeck.local with the box's address, so the phone page is
 * reachable as http://drivedeck.local:8765 in the same Wi-Fi or hotspot, without a router entry.
 * Only A records, nothing is browsed or announced besides the name itself.
 */
class MdnsResponder {
    static final String HOST = "drivedeck.local";
    private static final int PORT = 5353;
    private static final String GROUP = "224.0.0.251";
    private static final int TTL_SECONDS = 120;

    private final Context context;
    private volatile boolean running;
    private MulticastSocket socket;
    private WifiManager.MulticastLock lock;

    MdnsResponder(Context context) {
        this.context = context;
    }

    synchronized void start() {
        if (running) {
            return;
        }
        running = true;
        Thread thread = new Thread(this::serve, "mdns");
        thread.setDaemon(true);
        thread.start();
    }

    synchronized void stop() {
        running = false;
        if (socket != null) {
            socket.close();
            socket = null;
        }
        if (lock != null && lock.isHeld()) {
            lock.release();
        }
    }

    private void serve() {
        try {
            WifiManager wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                // without it many Wi-Fi drivers drop multicast packets to save power
                lock = wifi.createMulticastLock("drivedeck-mdns");
                lock.setReferenceCounted(false);
                lock.acquire();
            }
            InetAddress group = InetAddress.getByName(GROUP);
            MulticastSocket s = new MulticastSocket(null);
            s.setReuseAddress(true);
            s.bind(new InetSocketAddress(PORT));
            NetworkInterface nif = NetworkInterface.getByInetAddress(InetAddress.getByName(PairingServer.localAddress()));
            if (nif != null) {
                s.setNetworkInterface(nif);
                s.joinGroup(new InetSocketAddress(group, PORT), nif);
            } else {
                s.joinGroup(group);
            }
            synchronized (this) {
                socket = s;
            }
            // tell the network once that the name exists, phones that asked before learn it now
            byte[] hello = answer(0, null);
            s.send(new DatagramPacket(hello, hello.length, group, PORT));

            byte[] buffer = new byte[1500];
            while (running) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                s.receive(packet);
                Question q = parse(packet.getData(), packet.getLength());
                if (q == null) {
                    continue;
                }
                // legacy resolvers ask from another port and expect a normal unicast answer with the question
                boolean legacy = packet.getPort() != PORT;
                byte[] reply = answer(legacy ? q.id : 0, legacy ? q.raw : null);
                if (legacy || q.unicast) {
                    s.send(new DatagramPacket(reply, reply.length, packet.getAddress(), packet.getPort()));
                } else {
                    s.send(new DatagramPacket(reply, reply.length, group, PORT));
                }
            }
        } catch (IOException e) {
            if (running) {
                Log.w("Mdns", "responder stopped: " + e.getMessage());
            }
        } finally {
            stop();
        }
    }

    private static final class Question {
        int id;
        boolean unicast;
        byte[] raw;
    }

    /** Returns the question for our name (type A or ANY), or null. */
    private static Question parse(byte[] data, int length) {
        if (length < 12 || (data[2] & 0x80) != 0) {
            return null;
        }
        int count = ((data[4] & 0xff) << 8) | (data[5] & 0xff);
        int offset = 12;
        for (int i = 0; i < count && offset < length; i++) {
            StringBuilder name = new StringBuilder();
            offset = readName(data, length, offset, name, 0);
            if (offset < 0 || offset + 4 > length) {
                return null;
            }
            int type = ((data[offset] & 0xff) << 8) | (data[offset + 1] & 0xff);
            int cls = ((data[offset + 2] & 0xff) << 8) | (data[offset + 3] & 0xff);
            offset += 4;
            if ((type == 1 || type == 255) && name.toString().toLowerCase(Locale.ROOT).equals(HOST)) {
                Question q = new Question();
                q.id = ((data[0] & 0xff) << 8) | (data[1] & 0xff);
                q.unicast = (cls & 0x8000) != 0;
                // the question again, with the name written out (no compression pointers)
                ByteArrayOutputStream raw = new ByteArrayOutputStream();
                writeName(raw);
                raw.write(0);
                raw.write(1);
                raw.write(0);
                raw.write(1);
                q.raw = raw.toByteArray();
                return q;
            }
        }
        return null;
    }

    /** Reads a possibly compressed name into out, returns the offset after it in the packet or -1. */
    private static int readName(byte[] data, int length, int offset, StringBuilder out, int depth) {
        while (offset < length) {
            int len = data[offset] & 0xff;
            if (len == 0) {
                return offset + 1;
            }
            if ((len & 0xc0) == 0xc0) {
                if (offset + 1 >= length || depth > 5) {
                    return -1;
                }
                int pointer = ((len & 0x3f) << 8) | (data[offset + 1] & 0xff);
                return readName(data, length, pointer, out, depth + 1) < 0 ? -1 : offset + 2;
            }
            if (offset + 1 + len > length) {
                return -1;
            }
            if (out.length() > 0) {
                out.append('.');
            }
            out.append(new String(data, offset + 1, len, StandardCharsets.US_ASCII));
            offset += 1 + len;
        }
        return -1;
    }

    private static void writeName(ByteArrayOutputStream out) {
        for (String label : HOST.split("\\.")) {
            out.write(label.length());
            out.write(label.getBytes(StandardCharsets.US_ASCII), 0, label.length());
        }
        out.write(0);
    }

    private static byte[] answer(int id, byte[] question) throws IOException {
        byte[] address = InetAddress.getByName(PairingServer.localAddress()).getAddress();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int questions = question == null ? 0 : 1;
        out.write(new byte[] {(byte) (id >> 8), (byte) id, (byte) 0x84, 0, 0, (byte) questions, 0, 1, 0, 0, 0, 0});
        if (question != null) {
            out.write(question);
        }
        writeName(out);
        // type A, class IN with the cache flush bit (not for legacy answers), TTL, 4 bytes of address
        out.write(new byte[] {0, 1, (byte) (question == null ? 0x80 : 0), 1,
                0, 0, (byte) (TTL_SECONDS >> 8), (byte) TTL_SECONDS, 0, 4});
        out.write(address);
        return out.toByteArray();
    }
}
