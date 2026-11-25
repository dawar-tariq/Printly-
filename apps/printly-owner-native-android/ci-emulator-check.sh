#!/usr/bin/env bash
# Disposable offline emulator only. Preserve actionable test diagnostics in a
# check annotation if the GitHub Actions log archive cannot be downloaded.
set +e
require_case() {
  python3 - "$1" "$2" <<'PY'
import glob
import sys
import xml.etree.ElementTree as ET

expected_class, expected_name = sys.argv[1:]
for path in glob.glob('app/build/outputs/androidTest-results/connected/**/TEST-*.xml', recursive=True):
    root = ET.parse(path).getroot()
    for case in root.iter('testcase'):
        if case.get('classname') == expected_class and case.get('name') == expected_name:
            if any(case.find(tag) is not None for tag in ('failure', 'error', 'skipped')):
                raise SystemExit(f'{expected_class}.{expected_name} did not pass')
            print(f'Verified instrumented test: {expected_class}.{expected_name}')
            raise SystemExit(0)
raise SystemExit(f'Missing instrumented test result: {expected_class}.{expected_name}')
PY
}
(
  set -e -o pipefail
  adb shell svc wifi disable
  adb shell svc data disable
  rm -rf app/build/outputs/androidTest-results/connected
  ./gradlew --no-daemon connectedDebugAndroidTest --stacktrace
  require_case io.github.dawartariq.printly.owner.nativeapp.SessionStoreInstrumentedTest concurrentLegacyRestoresShareOneIdentityAndCanBeCleared
  require_case io.github.dawartariq.printly.owner.nativeapp.DemoFlowTest nativeShopNavigationAndExplicitPaymentReview
  # The QA install is fresh and network-disabled. Verify actual Firebase options
  # and default-off consent; no device is registered and no push is sent.
  adb uninstall io.github.dawartariq.printly.owner.native.qa > /dev/null 2>&1 || true
  rm -rf app/build/outputs/androidTest-results/connected
  ./gradlew --no-daemon connectedQaAndroidTest --stacktrace \
    '-PprintlyQaSiteOrigin=https://printly-native-test.vercel.app' \
    '-PprintlyInstrumentationBuildType=qa' \
    '-Pandroid.testInstrumentationRunnerArguments.class=io.github.dawartariq.printly.owner.nativeapp.QaFirebaseInstrumentedTest'
  require_case io.github.dawartariq.printly.owner.nativeapp.QaFirebaseInstrumentedTest isolatedClientStartsWithTheTestProjectAndNoNotificationOptIn
) > "${RUNNER_TEMP:?}/native-emulator.log" 2>&1
result=$?
tail -n 250 "$RUNNER_TEMP/native-emulator.log"
if [ "$result" -ne 0 ]; then
  python3 - "$RUNNER_TEMP/native-emulator.log" <<'PY'
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
    # The failure may precede test execution (e.g. adb or Gradle). Keep the
    # beginning of Gradle's failure section and a short tail for context.
    marker = log.find('FAILURE:')
    details.append((log[marker:marker + 5000] if marker >= 0 else '') + '\n' + '\n'.join(log.splitlines()[-35:]))
text = '\n\n'.join(details)[:12000].replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
print(f'::error title=Native emulator diagnostics::{text}')
PY
fi
exit "$result"
