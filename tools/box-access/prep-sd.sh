#!/bin/bash
# Formatiert /dev/sda (SD-Karte) neu: eine FAT32-Partition mit 4 GB, darauf adbDeviceMode = 1
set -e
D=/dev/sda
[ "$(lsblk -dno RM,TRAN,SIZE $D | xargs)" = "1 usb 238.4G" ] || { echo "$D ist nicht die 238-GB-USB-Karte, Abbruch"; lsblk $D; exit 1; }
for p in ${D}?*; do umount "$p" 2>/dev/null || true; done
wipefs -a $D
parted -s $D mklabel msdos mkpart primary fat32 1MiB 4GiB
partprobe $D; sleep 2
mkfs.vfat -F 32 -n TBOX ${D}1
M=$(mktemp -d); mount ${D}1 $M
echo 1 > $M/adbDeviceMode
sync; cat $M/adbDeviceMode; ls -l $M
umount $M; rmdir $M
lsblk -f $D
echo "FERTIG: Karte ist sicher entfernbar"
