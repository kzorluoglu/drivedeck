# Box hardware notes: getting a shell (adb) on the Carlinkit CPC200-Tbox

Status as of 2026-10-25: **no adb access achieved yet.** Notes of everything tried and found.

## Device

- Carlinkit CPC200-Tbox ("AI box"), Android 13, Qualcomm SM6115 (Snapdragon 665 class)
- FCC ID `2AYC2-AITBOX`, grantee Huizhou Yunlian Technology Co., Ltd. (carlinkit.com), equipment class "USB Android Ai box", granted 2021-12-10
- Radio module SS808 (BT, Wi-Fi, WCDMA/LTE), FCC ID ZMOSS808NA
- FCC exhibits worth reading (not downloadable from the tooling used here, 403 on fccid.io / fcc.report / apps.fcc.gov; open `https://fccid.io/2AYC2-AITBOX` in a browser):
  `15_CPC200-Tbox UserMan-US` (user manual), `09_CPC200-Tbox IntPho` (internal photos), `08_CPC200-Tbox ExtPho` (external photos)

## What the PC sees over USB

- Plugged into the laptop the box enumerates as **`05ac:12a8 Apple Inc. iPhone`** (serial `4e982bb52892033535`, interfaces: imaging, audio, HID). It emulates an iPhone for wired CarPlay, so it is in CarPlay mode.
- No Google/Android device (`18d1`) and no adb interface appears. `adb devices` stays empty. Device number changes on every re-plug or restart, which shows the box does restart.
- Network scan of 192.168.178.0/24 for port 5555: nothing open.

## Tried

| Idea | Result |
|---|---|
| `adb` from `~/Android/Sdk/platform-tools` (added to PATH in `~/.bashrc`) | works, but sees no device |
| Android Auto Desktop Head Unit (`tools/box-access/dhu-usb.sh`, needs `sudo apt install libc++1 libc++abi1`, run with sudo) | DHU runs, skips the box ("does not support AOAP"), because the box is in CarPlay mode |
| TF card file `adbDeviceMode` containing `1` (`tools/box-access/prep-sd.sh` formats a card as 4 GB FAT32 and writes it) | no change after restart; the Carlinkit text is ambiguous, value `0` may be the "adb / computer" value |
| Holding the physical button 3 s | LED only blinks green afterwards, meaning unknown |

## Leads, unverified

- Carlinkit support page (T-box UHD): "Create a new txt file named adbDeviceMode in the TF card. The content is 1 [TV mode] ... Turn on the adb mode of connecting to the computer. The content is 0. Switch back to the mode of connecting to the head unit."
  https://carlinkitcarplay.com/blogs/t-box-multi-language-tutorials-for-factory-wired-carplay/sim-card-works-fine-in-the-car-but-indoors-no-internet-connection
- Next try: put `0` into `adbDeviceMode`, restart, check `lsusb` / `adb devices`.
- Factory menu passwords reported on forums for other boxes (Settings > CAR > Factory Settings): `adbdev` (developer mode), `adbwf` (Wi-Fi debugging). Needs the box screen, unverified for this box.
- Mode switch CarPlay -> Android Auto reported for Tbox UHD 660: pin in the hole for ~3 s from the main menu, then confirm the prompt (needs the screen). Other models: TF card slot, pin port or a hardware switch.
  https://www.carplaylife.com/how-to/does-switching-a-carplay-ai-box-to-android-auto-really-improve-performance/
- Factory reset (needs the screen): Settings > System > Advanced > Reset options > Erase all data. UHD: Settings > More > System > Reset.
  https://www.carlinkit.com/faq_detail/58.html
- XDA reports that adb/fastboot does not see the CPC200-Tbox over USB, suggesting adb over network instead:
  https://xdaforums.com/t/question-carlinkit-ai-box-rooted-rom.4490597/
- XDA warning: changing developer options (e.g. freeform windows) made a CPC200-Tbox stop appearing on the head unit:
  https://xdaforums.com/t/carlinkit-cpc200-tbox-sm6225-not-showing-up-on-head-unit-after-changing-system-developer-options.4721985/
- Linux CarPlay head unit (needs MFi auth, long shot): https://github.com/f-io/LIVI
- DHU guide for AI boxes: https://aiboxfix.com/how-to/desktop-head-unit-setup-at-home/

## Fallbacks

- Update without adb: download the APK in the box browser (README).
- Develop against the emulator: `tools/emulator.sh` (AVD `tbox`).

## From the FCC user manual (`cpc200-tbox-user-manual-fcc.png`)

- Spec sheet: Qualcomm Snapdragon SDM450 (A53 x8, up to 1.8 GHz), manual says Android 9.0 (our box reports Android 13, manual is older), 2 GB+32 GB or 4 GB+64 GB, nano SIM, 5 V 1 A, size 78x78x18 mm.
- The box is meant to be plugged into the car USB port; its Android UI then appears on the car screen. That is why a PC only sees an "iPhone".
- **TF card: maximum 128 GB.** The 256 GB card used for the `adbDeviceMode` test is above spec, so the box may not have read it at all. Retry with a card of 128 GB or less.
- The manual says nothing about a button, LED states, adb or developer mode.

## DHU without root (2026-10-25)

Box in Android Auto mode appears as `18d1:4ee1 Google Nexus/Pixel (MTP)`. Started with `sudo` from the VS Code terminal the DHU window stayed black and GNOME reported "Visual Studio Code is not responding". Run it as a normal user from a separate terminal instead. USB access without root:

```
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="18d1", MODE="0666"' | sudo tee /etc/udev/rules.d/51-android-box.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Then replug the box and run `~/Android/dhu-usb.sh` (log: `~/Android/dhu.log`). Stop stale root instances first: `sudo pkill -f dhu-usb.sh; sudo pkill desktop-head-unit`.

## Car test (2026-10-25)

- In Android Auto mode the box shows up in the Mercedes as Android Auto ("Android Auto wird gestartet...") and then stops with "Um Android Auto erstmalig zu starten, parken Sie bitte das Fahrzeug und folgen den Anweisungen auf Ihrem Smartphone." The first-run setup would have to be confirmed on the box itself, which has no screen. The Android launcher of the box is therefore not reachable in this mode.
- On the laptop DHU the box (`18d1:4ee1`, serial `sd4e982bb5`) answers "supports AOAPv2", but never re-enumerates as `2d00`/`2d01`, so no accessory mode.
- Next: switch the box back to CarPlay mode (button 3-5 times while booting, the same gesture that switched to Android Auto; unverified that it toggles back) and look at the Android UI on the car screen.

## Forum material (all unverified for this unit)

- XDA, "Carlinkit TBox Ambient LED root" thread: root via QFIL/EDL with Magisk-patched `init_boot.img`. Needs the QFIL firmware package of the exact model and region from Carlinkit support, wipes the box, wrong firmware means soft brick. Not worth it just for adb.
- Carlinkit firmware page (Tbox Plus 6125): rename firmware zip to `update.zip`, put it in the root of the memory card (NTFS not supported); the car screen shows an upgrade prompt to confirm. That shows the TF card is read at boot and the prompt needs the screen.
- One XDA post claims engineering menu codes for a Tbox Plus: `142618` (PC adb mode), `4545` (factory menu), `6868`, and says never to enable the on-device "USB debugging" toggle together with the 142618 adb mode. Single unverified post with doubtful details; try only once the box screen is visible.
- EDL on SC668 boxes: hold the recessed pin while plugging in USB (post claim). Recovery only, risky.

## Update after pulling HANDOFF.md (2026-10-25)

`docs/HANDOFF.md` (written on the Mac) supersedes parts of this file: the box is managed through **wireless debugging** (`tools/box.sh`), not USB; the earlier `adbDeviceMode` failure was probably a loose USB plug; the box supports TF cards up to 256 GB; the hole is the protocol button (`reverse.ini` on the SD card selects CarPlay/Android Auto). This laptop (Ubuntu) is not paired yet: `tools/box.sh pair IP:PORT CODE`.
