#!/usr/bin/env bash
# Exercise the actual Android launch path on a disposable emulator. The first
# APK intentionally lacks the Browser Helper manage-data activity; it must
# crash with that missing-component error. The second is the fixed debug APK.
# No release keys, real accounts, or production mutations are involved.
set -euo pipefail

if [ "$#" -ne 2 ] || [ ! -f "$1" ] || [ ! -f "$2" ]; then
  echo 'Expected deliberately broken and fixed debug APK paths.' >&2
  exit 1
fi
broken=$1
fixed=$2
package=io.github.dawartariq.printly.owner.debug
launcher="$package/com.google.androidbrowserhelper.trusted.LauncherActivity"
temp=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/printly-emulator-launch.XXXXXXXX")
trap 'rm -rf "$temp"' EXIT

# The emulator uses the preinstalled browser; neither variant needs to reach
# the live Printly website for this native launch check.
adb shell svc wifi disable
adb shell svc data disable
adb shell pm list packages -e | tr -d '\r' | grep -Fx 'package:com.android.chrome' >/dev/null || {
  echo 'The Android emulator has no enabled Chrome browser to exercise the launch.' >&2
  exit 1
}

launch() {
  local apk=$1 output=$2
  adb install -r "$apk" >/dev/null
  adb shell pm clear "$package" >/dev/null
  adb shell am force-stop com.android.chrome || true
  adb logcat -c
  # A broken activity can crash while am is waiting for a window. The
  # assertions on logcat and the resumed activity below determine success.
  timeout 30s adb shell am start -W -n "$launcher" > "$temp/start.txt" 2>&1 || true
  sleep 10
  adb logcat -d -v brief -s AndroidRuntime:E TWALauncherActivity:D TwaLauncher:D > "$output"
}

launch "$broken" "$temp/broken.log"
python3 - "$temp/broken.log" "$package" <<'PY'
from pathlib import Path
import sys
lines = Path(sys.argv[1]).read_text(errors='replace').splitlines()
package = sys.argv[2]
crashes = ['\n'.join(lines[i:i + 80]) for i, line in enumerate(lines) if 'FATAL EXCEPTION' in line]
if not any(f'Process: {package},' in block and 'IllegalArgumentException' in block
           and 'ManageDataLauncherActivity' in block for block in crashes):
    print('The intentionally broken APK did not show the expected missing-component crash.', file=sys.stderr)
    print('\n'.join(lines[-120:]), file=sys.stderr)
    raise SystemExit(1)
print('The intentionally broken APK reproduced the missing-component crash.')
PY

launch "$fixed" "$temp/fixed.log"
python3 - "$temp/fixed.log" "$package" <<'PY'
from pathlib import Path
import sys
lines = Path(sys.argv[1]).read_text(errors='replace').splitlines()
package = sys.argv[2]
crashes = ['\n'.join(lines[i:i + 80]) for i, line in enumerate(lines) if 'FATAL EXCEPTION' in line]
if any(f'Process: {package},' in block for block in crashes):
    print('The fixed debug APK crashed while launching.', file=sys.stderr)
    print('\n'.join(lines[-120:]), file=sys.stderr)
    raise SystemExit(1)
print('The fixed debug APK had no launcher-process fatal exception.')
PY
resumed=$(adb shell dumpsys activity activities | tr -d '\r' | grep -E 'mResumedActivity|topResumedActivity' | tail -n 1 || true)
if [[ "$resumed" != *'com.android.chrome/'* ]]; then
  printf 'The fixed debug APK did not hand off to Chrome. Resumed activity: %s\n' "$resumed" >&2
  cat "$temp/start.txt" >&2
  tail -n 100 "$temp/fixed.log" >&2
  exit 1
fi
printf '%s\n' 'The fixed debug APK handed off to Chrome on the offline emulator.'
