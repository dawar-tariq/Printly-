#!/usr/bin/env bash
# Shared safety checks for destructive, synthetic-only Android emulator tests.
# Source this file from the emulator scripts; do not use it on a personal AVD.

prepare_disposable_emulator() {
  local listing serial qemu current_user packages
  local -a devices
  if [[ "${PRINTLY_DISPOSABLE_EMULATOR:-}" != 1 ]]; then
    echo 'Refusing emulator tests without PRINTLY_DISPOSABLE_EMULATOR=1. A disposable AVD will have networking disabled and its isolated QA app uninstalled.' >&2
    return 1
  fi
  if ! listing=$(adb devices); then
    echo 'Could not enumerate Android devices.' >&2
    return 1
  fi
  listing=${listing//$'\r'/}
  mapfile -t devices < <(printf '%s\n' "$listing" | awk 'NR > 1 && NF { print $1 " " $2 }')
  if [[ ${#devices[@]} -ne 1 || ! "${devices[0]}" =~ ^emulator-[0-9]+\ device$ ]]; then
    echo 'Refusing to change devices: exactly one connected Android emulator is required.' >&2
    return 1
  fi
  serial=${devices[0]%% *}
  if ! qemu=$(adb -s "$serial" shell getprop ro.kernel.qemu); then
    echo 'Could not verify the Android emulator.' >&2
    return 1
  fi
  qemu=${qemu//$'\r'/}
  if [[ "$qemu" != 1 ]]; then
    if ! qemu=$(adb -s "$serial" shell getprop ro.boot.qemu); then
      echo 'Could not verify the Android emulator.' >&2
      return 1
    fi
    qemu=${qemu//$'\r'/}
  fi
  if [[ "$qemu" != 1 ]]; then
    echo 'Refusing to change devices: the connected device did not identify itself as an emulator.' >&2
    return 1
  fi
  # Pin adb to the verified serial and refuse other currently connected
  # devices. Gradle may enumerate devices independently, so use isolated CI;
  # this check cannot prevent another device from connecting afterward.
  export ANDROID_SERIAL="$serial"
  if ! current_user=$(adb shell am get-current-user); then
    echo 'Could not verify the emulator user.' >&2
    return 1
  fi
  current_user=${current_user//$'\r'/}
  if [[ "$current_user" != 0 ]]; then
    echo 'Refusing tests outside the disposable emulator primary user.' >&2
    return 1
  fi
  adb shell svc wifi disable || { echo 'Could not disable emulator Wi-Fi.' >&2; return 1; }
  adb shell svc data disable || { echo 'Could not disable emulator mobile data.' >&2; return 1; }
  # A missing package is fine, but a failed uninstall must not leave a QA user
  # installation behind. Check the primary user's installed packages afterward.
  adb uninstall io.github.dawartariq.printly.owner.native.qa > /dev/null 2>&1 || true
  if ! packages=$(adb shell pm list packages --user 0); then
    echo 'Could not verify that the QA package was removed.' >&2
    return 1
  fi
  packages=${packages//$'\r'/}
  if grep -Fxq 'package:io.github.dawartariq.printly.owner.native.qa' <<< "$packages"; then
    echo 'Refusing tests: the previous QA package could not be removed.' >&2
    return 1
  fi
}
