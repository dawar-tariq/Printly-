#!/usr/bin/env bash
# Fresh, offline Android 13+ emulator only. No Firebase registration or sends.
set +e
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 1
source "$SCRIPT_DIR/ci-emulator-common.sh" || exit 1
(
  set -e -o pipefail
  prepare_disposable_emulator
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
