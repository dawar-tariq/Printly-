#!/usr/bin/env bash
# Offline, disposable emulator only. Never launch or install a production app.
set -uo pipefail
source ci-emulator-common.sh
export PRINTLY_DISPOSABLE_EMULATOR=1
prepare_disposable_emulator || exit 1
rm -rf app/build/outputs/androidTest-results/connected
./gradlew --no-daemon connectedDebugAndroidTest --stacktrace \
  '-Pandroid.testInstrumentationRunnerArguments.class=io.github.dawartariq.printly.owner.nativeapp.NativeApkArchiveDiagnostic' > "$RUNNER_TEMP/archive-diagnostic.log" 2>&1
result=$?
tail -n 100 "$RUNNER_TEMP/archive-diagnostic.log"
python3 - <<'PY'
import glob, os, xml.etree.ElementTree as ET
found = False
for path in glob.glob('app/build/outputs/androidTest-results/connected/**/TEST-*.xml', recursive=True):
    for case in ET.parse(path).getroot().iter('testcase'):
        for f in list(case.findall('failure')) + list(case.findall('error')):
            found = True
            text = (f.text or f.get('message', ''))[:10000].replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
            print(f'::error title=Android archive identity::{text}')
if not found and os.path.exists(os.path.join(os.environ['RUNNER_TEMP'], 'archive-diagnostic.log')):
    lines = open(os.path.join(os.environ['RUNNER_TEMP'], 'archive-diagnostic.log')).readlines()
    text = ''.join(lines[-80:])[:12000].replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f'::notice title=Android archive diagnostic log::{text}')
PY
[ "$result" -eq 0 ] || exit "$result"
python3 ci-verify-instrumented-case.py io.github.dawartariq.printly.owner.nativeapp.NativeApkArchiveDiagnostic verifyReviewedArchivesLikeInstalledUpdater
