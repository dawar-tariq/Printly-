#!/usr/bin/env bash
# Disposable CI emulator only; this test reads a public APK and never signs in.
set -uo pipefail
[ "${PRINTLY_DISPOSABLE_EMULATOR:-}" = 1 ] || exit 1
listing=$(adb devices) || exit 1
mapfile -t devices < <(printf '%s\n' "$listing" | tr -d '\r' | awk 'NR > 1 && NF { print $1 " " $2 }')
[ "${#devices[@]}" -eq 1 ] && [[ "${devices[0]}" =~ ^emulator-[0-9]+\ device$ ]] || exit 1
export ANDROID_SERIAL="${devices[0]%% *}"
qemu=$(adb shell getprop ro.kernel.qemu | tr -d '\r')
[ "$qemu" = 1 ] || exit 1
rm -rf app/build/outputs/androidTest-results/connected
./gradlew --no-daemon connectedDebugAndroidTest --stacktrace \
  '-Pandroid.testInstrumentationRunnerArguments.class=io.github.dawartariq.printly.owner.nativeapp.NativeDownloadDiagnostic' > "$RUNNER_TEMP/download-diagnostic.log" 2>&1
result=$?
python3 - <<'PY'
import glob, os, xml.etree.ElementTree as ET
failed = False
for path in glob.glob('app/build/outputs/androidTest-results/connected/**/TEST-*.xml', recursive=True):
    for case in ET.parse(path).getroot().iter('testcase'):
        for f in list(case.findall('failure')) + list(case.findall('error')):
            failed = True
            text = (f.text or f.get('message', ''))[:5000].replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
            print(f'::error title=Android public APK download::{text}')
if not failed:
    text = ''.join(open(os.path.join(os.environ['RUNNER_TEMP'], 'download-diagnostic.log')).readlines()[-35:])[:6000]
    text = text.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f'::notice title=Download diagnostic status::{text}')
PY
[ "$result" -eq 0 ] || exit "$result"
python3 ci-verify-instrumented-case.py io.github.dawartariq.printly.owner.nativeapp.NativeDownloadDiagnostic downloadPublicAssetWithUpdaterNetworkPath
