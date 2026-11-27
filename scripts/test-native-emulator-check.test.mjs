import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Android CI runs this before installing website dependencies; Vitest discovers
// the same synthetic harness in the complete website suite. No adb is invoked.
const test = process.env.VITEST ? (await import('vitest')).test : nodeTest;
const sourceDir = resolve('apps/printly-owner-native-android');
const prefix = 'io.github.dawartariq.printly.owner.nativeapp';
const qaPackage = 'io.github.dawartariq.printly.owner.native.qa';

function fixture({ script = 'ci-emulator-check.sh', ack = true, device = 'emulator', user = '0', uninstall = 'removed', badCase = '', badState = '', airplane = 'ok', connectivity = 'offline' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'printly-emulator-harness-'));
  try {
    const bin = join(root, 'bin'), runner = join(root, 'runner');
    const calls = join(root, 'adb-calls'), gradleCalls = join(root, 'gradle-calls'), networkChecks = join(root, 'network-checks');
    mkdirSync(bin); mkdirSync(runner);
    writeFileSync(calls, ''); writeFileSync(gradleCalls, ''); writeFileSync(networkChecks, '0');
    // Offline-preflight retries are synthetic and must not slow the unit tests.
    writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    for (const file of [script, 'ci-emulator-common.sh', 'ci-verify-instrumented-case.py']) {
      copyFileSync(join(sourceDir, file), join(root, file));
    }
    writeFileSync(join(bin, 'adb'), `#!/bin/sh
printf '%s|%s\n' "\${ANDROID_SERIAL:-}" "$*" >> "$MOCK_ADB_CALLS"
case "$*" in
  devices)
    printf 'List of devices attached\n'
    case "$MOCK_DEVICE" in
      emulator|bootprop|spoof) printf 'emulator-5554\tdevice\n' ;;
      physical) printf 'physical-phone\tdevice\n' ;;
      multiple) printf 'emulator-5554\tdevice\nphysical-phone\tdevice\n' ;;
      offline) printf 'emulator-5554\toffline\n' ;;
      *) exit 2 ;;
    esac ;;
  '-s emulator-5554 shell getprop ro.kernel.qemu')
    if [ "$MOCK_DEVICE" = spoof ] || [ "$MOCK_DEVICE" = bootprop ]; then echo 0; else echo 1; fi ;;
  '-s emulator-5554 shell getprop ro.boot.qemu')
    if [ "$MOCK_DEVICE" = spoof ]; then echo 0; else echo 1; fi ;;
  'shell am get-current-user')
    [ "\${ANDROID_SERIAL:-}" = emulator-5554 ] || exit 3
    echo "$MOCK_USER" ;;
  'shell svc wifi disable'|'shell svc data disable')
    [ "\${ANDROID_SERIAL:-}" = emulator-5554 ] || exit 3 ;;
  'shell cmd connectivity airplane-mode enable')
    [ "\${ANDROID_SERIAL:-}" = emulator-5554 ] || exit 3
    [ "$MOCK_AIRPLANE" != command-error ] || exit 4 ;;
  'shell settings get global airplane_mode_on')
    [ "\${ANDROID_SERIAL:-}" = emulator-5554 ] || exit 3
    [ "$MOCK_AIRPLANE" != setting-error ] || exit 4
    if [ "$MOCK_AIRPLANE" = setting-off ]; then echo 0; else echo 1; fi ;;
  'shell dumpsys connectivity')
    [ "\${ANDROID_SERIAL:-}" = emulator-5554 ] || exit 3
    [ "$MOCK_CONNECTIVITY" != error ] || exit 4
    n=$(cat "$MOCK_NETWORK_CHECKS"); n=$((n+1)); echo "$n" > "$MOCK_NETWORK_CHECKS"
    if [ "$MOCK_CONNECTIVITY" = offline ] || { [ "$MOCK_CONNECTIVITY" = transient ] && [ "$n" -ge 3 ]; }; then
      echo 'Active default network: none'
    else echo 'Active default network: 100'; fi ;;
  'uninstall ${qaPackage}')
    [ "\${ANDROID_SERIAL:-}" = emulator-5554 ] || exit 3
    [ "$MOCK_UNINSTALL" != retained ] && [ "$MOCK_UNINSTALL" != absent-failure ] || exit 4 ;;
  'shell pm list packages --user 0')
    [ "\${ANDROID_SERIAL:-}" = emulator-5554 ] || exit 3
    [ "$MOCK_UNINSTALL" != list-error ] || exit 5
    if [ "$MOCK_UNINSTALL" = retained ] || [ "$MOCK_UNINSTALL" = retained-success ]; then
      echo 'package:${qaPackage}'
      # An early match must not be hidden by grep -q closing a long pipeline.
      i=0; while [ "$i" -lt 1000 ]; do echo 'package:synthetic.other.repeated.name'; i=$((i+1)); done
    else echo 'package:synthetic.other'; fi ;;
  *) echo "Unexpected mock adb invocation: $*" >&2; exit 6 ;;
esac
`, { mode: 0o755 });
    writeFileSync(join(root, 'gradlew'), `#!/bin/sh
set -eu
[ "\${ANDROID_SERIAL:-}" = emulator-5554 ] || exit 3
printf '%s\n' "$*" >> "$MOCK_GRADLE_CALLS"
case "$*" in
  *connectedDebugAndroidTest*) suite=debug ;;
  *connectedQaAndroidTest*)
    case "$*" in *"-PprintlyQaSiteOrigin=https://printly-native-test.vercel.app"*) : ;; *) exit 4 ;; esac
    case "$*" in *"-PprintlyInstrumentationBuildType=qa"*) : ;; *) exit 5 ;; esac
    case "$*" in
      *"${prefix}.QaFirebaseInstrumentedTest,${prefix}.QaPushTapInstrumentedTest"*) suite=qa ;;
      *"${prefix}.QaNotificationPermissionInstrumentedTest"*) suite=permission ;;
      *) exit 6 ;;
    esac ;;
  *) exit 7 ;;
esac
python3 - "$suite" <<'PY'
import os, sys, xml.etree.ElementTree as ET
prefix = '${prefix}'
cases = {
 'debug': [
  ('SessionStoreInstrumentedTest','concurrentLegacyRestoresShareOneIdentityAndCanBeCleared'),
  ('DemoFlowTest','nativeShopNavigationAndExplicitPaymentReview'),
  ('NativeLiveUpdatePayloadInstrumentedTest','productionPayloadParsesAndRequiresUpdateOnCodeSix'),
  ('NativeUpdateInstrumentedTest','cachedMandatoryPolicySurvivesOfflineAndMalformedUntilExplicitUnpublish'),
  ('NativeUpdateInstrumentedTest','optionalUpdateDoesNotBlockOrShowAnAutomaticDialog'),
  ('NativeUpdateInstrumentedTest','mandatoryScreenRequiresDownloadConfirmationAndInterceptsBack')],
 'qa': [
  ('QaFirebaseInstrumentedTest','isolatedClientStartsWithTheTestProjectAndNoNotificationOptIn'),
  ('QaPushTapInstrumentedTest','staleTapCannotCrossSessionOrEraseANewerBinding'),
  ('QaPushTapInstrumentedTest','storedTapsRequireFreshOptedInStateAndAnExistingEvent')],
 'permission': [
  ('QaNotificationPermissionInstrumentedTest','firstOpenAsksOnceAndPermissionAloneDoesNotEnablePush')],
}
root = ET.Element('testsuite')
duplicate = None
for cls, name in cases[sys.argv[1]]:
    state = os.environ.get('MOCK_BAD_STATE', '') if name == os.environ.get('MOCK_BAD_CASE', '') else ''
    if state == 'missing': continue
    case = ET.SubElement(root, 'testcase', classname=prefix + '.' + cls, name=name)
    if state in ('failure', 'error', 'skipped'): ET.SubElement(case, state)
    if state.startswith('duplicate_'): duplicate = (cls, name, state.removeprefix('duplicate_'))
directory = 'app/build/outputs/androidTest-results/connected/device'
os.makedirs(directory, exist_ok=True)
ET.ElementTree(root).write(directory + '/TEST-synthetic.xml')
if duplicate:
    cls, name, state = duplicate
    other = ET.Element('testsuite')
    case = ET.SubElement(other, 'testcase', classname=prefix + '.' + cls, name=name)
    ET.SubElement(case, state)
    ET.ElementTree(other).write(directory + '/TEST-zz-duplicate.xml')
if os.environ.get('MOCK_BAD_STATE') == 'malformed':
    open(directory + '/TEST-zz-malformed.xml', 'w').write('<broken')
PY
`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runner,
      MOCK_ADB_CALLS: calls, MOCK_GRADLE_CALLS: gradleCalls, MOCK_DEVICE: device, MOCK_USER: user, MOCK_UNINSTALL: uninstall,
      MOCK_AIRPLANE: airplane, MOCK_CONNECTIVITY: connectivity, MOCK_NETWORK_CHECKS: networkChecks,
      MOCK_BAD_CASE: badCase, MOCK_BAD_STATE: badState };
    delete env.ANDROID_SERIAL;
    if (ack) env.PRINTLY_DISPOSABLE_EMULATOR = '1'; else delete env.PRINTLY_DISPOSABLE_EMULATOR;
    const result = spawnSync('bash', [script], { cwd: root, encoding: 'utf8', timeout: 30000, env });
    if (result.error) throw result.error;
    const lines = path => readFileSync(path, 'utf8').split('\n').filter(Boolean);
    return { result, adbCalls: lines(calls), gradleCalls: lines(gradleCalls) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

const permissionScript = 'ci-notification-permission-check.sh';

test('offline harnesses target one acknowledged disposable emulator and require critical results', () => {
  for (const script of ['ci-emulator-check.sh', permissionScript]) {
    const { result, adbCalls, gradleCalls } = fixture({ script });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const commonCalls = [
      '|devices', '|-s emulator-5554 shell getprop ro.kernel.qemu', 'emulator-5554|shell am get-current-user',
      'emulator-5554|shell svc wifi disable', 'emulator-5554|shell svc data disable',
      `emulator-5554|uninstall ${qaPackage}`, 'emulator-5554|shell pm list packages --user 0',
    ];
    const permissionCalls = [
      'emulator-5554|shell cmd connectivity airplane-mode enable', 'emulator-5554|shell settings get global airplane_mode_on',
      'emulator-5554|shell svc wifi disable', 'emulator-5554|shell svc data disable', 'emulator-5554|shell dumpsys connectivity',
    ];
    assert.deepEqual(adbCalls, [...commonCalls, ...(script === permissionScript ? permissionCalls : [])]);
    assert.equal(gradleCalls.length, script === permissionScript ? 1 : 2);
    assert.equal((result.stdout.match(/Verified instrumented test:/g) ?? []).length, script === permissionScript ? 1 : 9);
  }
  const fallback = fixture({ script: permissionScript, device: 'bootprop', uninstall: 'absent-failure' });
  assert.equal(fallback.result.status, 0, fallback.result.stdout + fallback.result.stderr);
  assert.ok(fallback.adbCalls.includes('|-s emulator-5554 shell getprop ro.boot.qemu'));
});

test('offline harnesses refuse phones, multiple devices, unverified AVDs and retained QA installs', () => {
  for (const script of ['ci-emulator-check.sh', permissionScript]) {
    for (const options of [{ ack: false }, { device: 'physical' }, { device: 'multiple' },
      { device: 'offline' }, { device: 'spoof' }, { user: '10' }, { uninstall: 'retained' },
      { uninstall: 'retained-success' }, { uninstall: 'list-error' }]) {
      const { result, adbCalls, gradleCalls } = fixture({ script, ...options });
      assert.notEqual(result.status, 0, `${script}: ${JSON.stringify(options)}`);
      assert.equal(gradleCalls.length, 0, `${script}: ${JSON.stringify(options)}`);
      if (options.ack === false) assert.equal(adbCalls.length, 0);
      if (options.device || options.user) assert.ok(adbCalls.every(call => !/svc |uninstall|pm list|cmd connectivity|settings get global|dumpsys connectivity/.test(call)), adbCalls.join('\n'));
    }
  }
});

test('permission harness refuses to start unless airplane mode and an offline default network are verified', () => {
  for (const options of [
    { airplane: 'command-error' }, { airplane: 'setting-error' }, { airplane: 'setting-off' },
    { connectivity: 'error' }, { connectivity: 'online' },
  ]) {
    const { result, adbCalls, gradleCalls } = fixture({ script: permissionScript, ...options });
    assert.notEqual(result.status, 0, JSON.stringify(options));
    assert.equal(gradleCalls.length, 0, JSON.stringify(options));
    assert.match(result.stdout + result.stderr, /Could not|Refusing tests/);
    if (options.connectivity === 'online') assert.equal(adbCalls.filter(call => call.endsWith('shell dumpsys connectivity')).length, 20);
  }
  const transient = fixture({ script: permissionScript, connectivity: 'transient' });
  assert.equal(transient.result.status, 0, transient.result.stdout + transient.result.stderr);
  assert.equal(transient.adbCalls.filter(call => call.endsWith('shell dumpsys connectivity')).length, 3);
  assert.equal(transient.gradleCalls.length, 1);
});

test('QA instrumentation sources guard offline, emulator and fresh-state assumptions before changes', () => {
  const qa = join(sourceDir, 'app/src/androidTestQa/java/io/github/dawartariq/printly/owner/nativeapp');
  const push = readFileSync(join(qa, 'QaPushTapInstrumentedTest.kt'), 'utf8');
  const permission = readFileSync(join(qa, 'QaNotificationPermissionInstrumentedTest.kt'), 'utf8');
  const firebase = readFileSync(join(qa, 'QaFirebaseInstrumentedTest.kt'), 'utf8');
  const before = (source, guard, action) => {
    const start = source.indexOf(guard), end = source.indexOf(action);
    assert.ok(start >= 0 && end > start, `${guard} must precede ${action}`);
  };
  for (const source of [push, permission, firebase]) {
    before(source, 'Build.HARDWARE in setOf("ranchu", "goldfish")', 'FirebaseMessaging.getInstance()');
    before(source, 'connectivity.activeNetwork', 'FirebaseMessaging.getInstance()');
    before(source, 'getSharedPreferences("com.google.firebase.messaging", Context.MODE_PRIVATE).getBoolean("auto_init", false)', 'FirebaseMessaging.getInstance()');
  }
  before(push, 'sessionPrefs.all.isEmpty()', 'store.load()');
  before(push, 'prefs.all.isEmpty()', 'safeToClean = true');
  before(push, 'sessionPrefs.all.isEmpty()', 'safeToClean = true');
  before(permission, 'getSharedPreferences("native_session_v1", Context.MODE_PRIVATE).all.isEmpty()', 'context.startActivity(intent)');
  before(permission, 'getSharedPreferences("native_push_v1", Context.MODE_PRIVATE).all.isEmpty()', 'executeShellCommand(command)');
});

test('offline harnesses reject missing, failed, skipped, duplicate-bad and malformed test results', () => {
  for (const options of [
    { badCase: 'cachedMandatoryPolicySurvivesOfflineAndMalformedUntilExplicitUnpublish', badState: 'missing' },
    { badCase: 'mandatoryScreenRequiresDownloadConfirmationAndInterceptsBack', badState: 'failure' },
    { badCase: 'staleTapCannotCrossSessionOrEraseANewerBinding', badState: 'skipped' },
    { badCase: 'storedTapsRequireFreshOptedInStateAndAnExistingEvent', badState: 'error' },
    { badCase: 'staleTapCannotCrossSessionOrEraseANewerBinding', badState: 'duplicate_failure' },
    { script: permissionScript, badCase: 'firstOpenAsksOnceAndPermissionAloneDoesNotEnablePush', badState: 'duplicate_skipped' },
    { script: permissionScript, badState: 'malformed' },
  ]) {
    const { result } = fixture(options);
    assert.notEqual(result.status, 0, JSON.stringify(options));
    assert.match(result.stdout + result.stderr, /Missing instrumented test result|did not pass|Could not inspect instrumented test result/);
  }
});
