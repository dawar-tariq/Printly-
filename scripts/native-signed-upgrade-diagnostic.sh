#!/usr/bin/env bash
# Offline, disposable emulator only. Never installs to a user device.
set -eEuo pipefail
trap 'echo "::error::Upgrade diagnostic failed at line ${LINENO}"' ERR
[ "${PRINTLY_DISPOSABLE_EMULATOR:-}" = 1 ]
mapfile -t devices < <(adb devices | tr -d '\r' | awk 'NR > 1 && NF { print $1 " " $2 }')
[ "${#devices[@]}" -eq 1 ] && [[ "${devices[0]}" =~ ^emulator-[0-9]+\ device$ ]]
export ANDROID_SERIAL="${devices[0]%% *}"
[ "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1 ]
adb root
adb wait-for-device
[ "$(adb shell id -u | tr -d '\r')" = 0 ]
# Install without launching or signing in, then block the app's entire network
# access before launch. The in-place upgrade keeps the same UID.
pkg=io.github.dawartariq.printly.owner
adb install "$RUNNER_TEMP/old.apk" >/dev/null
uid=$(adb shell stat -c %u /data/user/0/$pkg | tr -d '\r')
[[ "$uid" =~ ^[0-9]+$ ]]
adb shell iptables -I OUTPUT 1 -m owner --uid-owner "$uid" -j REJECT
adb shell ip6tables -I OUTPUT 1 -m owner --uid-owner "$uid" -j REJECT
adb shell iptables -C OUTPUT -m owner --uid-owner "$uid" -j REJECT
adb shell ip6tables -C OUTPUT -m owner --uid-owner "$uid" -j REJECT
adb shell mkdir -p /data/user/0/$pkg/files
adb shell "echo synthetic-upgrade-sentinel > /data/user/0/$pkg/files/upgrade-sentinel"
adb shell chown -R "$uid:$uid" /data/user/0/$pkg/files
adb shell restorecon -RF /data/user/0/$pkg/files
adb install -r "$RUNNER_TEMP/new.apk" >/dev/null
[ "$(adb shell cat /data/user/0/$pkg/files/upgrade-sentinel | tr -d '\r')" = synthetic-upgrade-sentinel ]
adb shell dumpsys package "$pkg" | grep -q 'versionCode=11 '
adb shell dumpsys package "$pkg" | grep -q 'versionName=2.1.5'
adb shell am start -n "$pkg/io.github.dawartariq.printly.owner.nativeapp.MainActivity" >/dev/null
sleep 10
pid=$(adb shell pidof "$pkg" | tr -d '\r')
[[ "$pid" =~ ^[0-9]+$ ]]
echo 'Signed Android upgrade installed over the previous version, retained app data and started offline.'
