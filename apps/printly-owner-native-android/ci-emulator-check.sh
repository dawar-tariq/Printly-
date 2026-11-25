#!/usr/bin/env bash
# Synthetic-data emulator only. Preserve actionable test diagnostics in a
# check annotation if the GitHub Actions log archive cannot be downloaded.
set +e
(
  set -e -o pipefail
  adb shell svc wifi disable
  adb shell svc data disable
  ./gradlew --no-daemon connectedDebugAndroidTest --stacktrace
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
