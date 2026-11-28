#!/usr/bin/env bash
# Fresh, offline Android 13+ emulator only. No Firebase registration or sends.
set +e
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 1
source "$SCRIPT_DIR/ci-emulator-common.sh" || exit 1
(
  set -e -o pipefail
  prepare_disposable_emulator
  # API 35 can report an active cellular default network even after svc data
  # disable. Airplane mode plus both radio switches is a stronger preflight;
  # the instrumentation still independently requires activeNetwork == null.
  if ! adb shell cmd connectivity airplane-mode enable > /dev/null; then
    echo 'Could not enable airplane mode on the disposable emulator.' >&2
    exit 1
  fi
  airplane=$(adb shell settings get global airplane_mode_on) || { echo 'Could not verify emulator airplane mode.' >&2; exit 1; }
  airplane=${airplane//$'\r'/}
  if [[ "$airplane" != 1 ]]; then
    echo 'Refusing tests: emulator airplane mode is not enabled.' >&2
    exit 1
  fi
  adb shell svc wifi disable || { echo 'Could not disable emulator Wi-Fi.' >&2; exit 1; }
  adb shell svc data disable || { echo 'Could not disable emulator mobile data.' >&2; exit 1; }
  # Wait for the default network to disappear before installing the QA test
  # package. Never use this host-side check instead of the in-app offline guard.
  offline=0
  for ((attempt=0; attempt<20; attempt++)); do
    status=$(adb shell dumpsys connectivity) || { echo 'Could not verify emulator connectivity.' >&2; exit 1; }
    status=${status//$'\r'/}
    if grep -Eq '^[[:space:]]*Active default network:[[:space:]]*none[[:space:]]*$' <<< "$status"; then offline=1; break; fi
    sleep 1
  done
  if [[ "$offline" != 1 ]]; then
    echo 'Refusing tests: the disposable emulator still has an active default network.' >&2
    exit 1
  fi
  rm -rf app/build/outputs/androidTest-results/connected
  ./gradlew --no-daemon connectedQaAndroidTest --stacktrace \
    '-PprintlyQaSiteOrigin=https://printly-native-test.vercel.app' \
    '-PprintlyInstrumentationBuildType=qa' \
    '-Pandroid.testInstrumentationRunnerArguments.class=io.github.dawartariq.printly.owner.nativeapp.QaNotificationPermissionInstrumentedTest'
  python3 "$SCRIPT_DIR/ci-verify-instrumented-case.py" \
    io.github.dawartariq.printly.owner.nativeapp.QaNotificationPermissionInstrumentedTest \
    firstOpenAsksOnceAndPermissionAloneDoesNotEnablePush
) > "${RUNNER_TEMP:?}/native-notification-permission.log" 2>&1
result=$?
tail -n 180 "$RUNNER_TEMP/native-notification-permission.log"
if [ "$result" -ne 0 ]; then
  python3 - "$RUNNER_TEMP/native-notification-permission.log" <<'PY'
import glob
import sys
import xml.etree.ElementTree as ET

log = open(sys.argv[1], encoding='utf-8', errors='replace').read()
details = []
for path in glob.glob('app/build/outputs/androidTest-results/connected/**/TEST-*.xml', recursive=True):
    try:
        root = ET.parse(path).getroot()
        for case in root.iter('testcase'):
            for failure in list(case.findall('failure')) + list(case.findall('error')):
                details.append(f"{case.get('classname', '')}.{case.get('name', '')}: {failure.get('message', '')}\n{failure.text or ''}")
    except (OSError, ET.ParseError):
        pass
if not details:
    marker = log.find('FAILURE:')
    details.append((log[marker:marker + 5000] if marker >= 0 else '') + '\n' + '\n'.join(log.splitlines()[-35:]))
text = '\n\n'.join(details)[:12000].replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
print(f'::error title=Native first-open permission test::{text}')
PY
fi
exit "$result"
