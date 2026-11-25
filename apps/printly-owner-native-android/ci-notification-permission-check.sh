#!/usr/bin/env bash
# Fresh, offline Android 13+ emulator only. No Firebase registration or sends.
set +e
(
  set -e -o pipefail
  adb shell svc wifi disable
  adb shell svc data disable
  adb uninstall io.github.dawartariq.printly.owner.native.qa > /dev/null 2>&1 || true
  rm -rf app/build/outputs/androidTest-results/connected
  ./gradlew --no-daemon connectedQaAndroidTest --stacktrace \
    '-PprintlyQaSiteOrigin=https://printly-native-test.vercel.app' \
    '-PprintlyInstrumentationBuildType=qa' \
    '-Pandroid.testInstrumentationRunnerArguments.class=io.github.dawartariq.printly.owner.nativeapp.QaNotificationPermissionInstrumentedTest'
  python3 - <<'PY'
import glob
import xml.etree.ElementTree as ET

expected_class = 'io.github.dawartariq.printly.owner.nativeapp.QaNotificationPermissionInstrumentedTest'
expected_name = 'firstOpenAsksOnceAndPermissionAloneDoesNotEnablePush'
for path in glob.glob('app/build/outputs/androidTest-results/connected/**/TEST-*.xml', recursive=True):
    root = ET.parse(path).getroot()
    for case in root.iter('testcase'):
        if case.get('classname') == expected_class and case.get('name') == expected_name:
            if any(case.find(tag) is not None for tag in ('failure', 'error', 'skipped')):
                raise SystemExit('First-open permission test did not pass')
            print(f'Verified instrumented test: {expected_class}.{expected_name}')
            raise SystemExit(0)
raise SystemExit('Missing first-open permission test result')
PY
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
