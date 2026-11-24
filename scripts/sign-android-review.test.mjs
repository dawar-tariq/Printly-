import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./sign-android-review.sh', import.meta.url));
const temporary = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function setup(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'printly-review-test-'));
  temporary.push(root);
  const app = join(root, 'app');
  const runner = join(root, 'runner');
  const tools = join(root, 'sdk', 'build-tools', '36.0.0');
  mkdirSync(app); mkdirSync(runner); mkdirSync(tools, { recursive: true });
  const executable = (path, contents) => writeFileSync(path, contents, { mode: 0o700 });
  executable(join(app, 'gradlew'), `#!/usr/bin/env bash
set -euo pipefail
[ "$1" = '--no-daemon' ] && [ "$2" = 'assembleRelease' ]
[ "$PRINTLY_ANDROID_KEYSTORE_TYPE" = 'PKCS12' ]
[ "$PRINTLY_ANDROID_KEY_ALIAS" = 'printly-owner-release' ]
[ "$PRINTLY_ANDROID_KEY_PASSWORD" = "$PRINTLY_ANDROID_KEYSTORE_PASSWORD" ]
[ "$PRINTLY_ANDROID_KEYSTORE_PASSWORD" = "$FAKE_EXPECTED_PASSWORD" ]
[ -z "\${KEYSTORE_BASE64+x}" ]
[ "$(stat -c '%a' "$PRINTLY_ANDROID_KEYSTORE_PATH")" = '600' ]
[ "$(cat "$PRINTLY_ANDROID_KEYSTORE_PATH")" = 'disposable-keystore' ]
[ "\${FAKE_GRADLE_FAIL:-0}" != 1 ]
mkdir -p app/build/outputs/apk/release
printf 'disposable-apk' > app/build/outputs/apk/release/app-release.apk
`);
  executable(join(tools, 'apksigner'), `#!/usr/bin/env bash
set -euo pipefail
printf 'Signer #1 certificate SHA-256 digest: %s\\n' "$FAKE_ACTUAL"
if [ "\${FAKE_TWO_SIGNERS:-0}" = 1 ]; then printf 'Signer #2 certificate SHA-256 digest: %s\\n' "$FAKE_ACTUAL"; fi
`);
  executable(join(tools, 'aapt'), `#!/usr/bin/env bash
set -euo pipefail
printf "package: name='%s' versionCode='%s' versionName='1.0.0'\\n" "$FAKE_PACKAGE" "$FAKE_VERSION"
`);
  const env = {
    PATH: process.env.PATH, HOME: root, ANDROID_HOME: join(root, 'sdk'), RUNNER_TEMP: runner,
    KEYSTORE_BASE64: Buffer.from('disposable-keystore').toString('base64'),
    PRINTLY_ANDROID_KEYSTORE_PASSWORD: 'c'.repeat(64), FAKE_EXPECTED_PASSWORD: 'c'.repeat(64),
    EXPECTED_CERTIFICATE: Array(32).fill('AA').join(':'),
    REQUESTED_VERSION_CODE: '1', GITHUB_EVENT_NAME: 'push',
    FAKE_ACTUAL: 'a'.repeat(64), FAKE_PACKAGE: 'io.github.dawartariq.printly.owner', FAKE_VERSION: '1',
    ...overrides,
  };
  const run = () => spawnSync('bash', [script], { cwd: app, env, encoding: 'utf8' });
  const noTemporaryKeystore = () => expect(readdirSync(runner).filter((name) => name.startsWith('printly-release.'))).toEqual([]);
  return { root, app, run, noTemporaryKeystore };
}

describe('protected Android review signing script with disposable tools', () => {
  it('uses the fixed PKCS12 identity, verifies evidence, and removes the temporary key', () => {
    const f = setup(); const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    f.noTemporaryKeystore();
    expect(readFileSync(join(f.app, 'signer-evidence.txt'), 'utf8')).toContain('Signer #1 certificate SHA-256 digest:');
    expect(readFileSync(join(f.app, 'package-evidence.txt'), 'utf8')).toContain("name='io.github.dawartariq.printly.owner' versionCode='1'");
    const digest = createHash('sha256').update('disposable-apk').digest('hex');
    expect(readFileSync(join(f.app, 'sha256-evidence.txt'), 'utf8')).toMatch(new RegExp(`^${digest} `));
    expect(result.stdout + result.stderr).not.toContain('c'.repeat(64));
    expect(result.stdout + result.stderr).not.toContain('disposable-keystore');
  });

  it('accepts an independently matching manual fingerprint', () => {
    const f = setup({ GITHUB_EVENT_NAME: 'workflow_dispatch', MANUAL_EXPECTED_CERTIFICATE: 'a'.repeat(64) });
    expect(f.run().status).toBe(0); f.noTemporaryKeystore();
  });

  it('accepts a copied password with trailing CRLF without changing its value', () => {
    const f = setup({ PRINTLY_ANDROID_KEYSTORE_PASSWORD: 'c'.repeat(64) + '\r\n' });
    expect(f.run().status).toBe(0); f.noTemporaryKeystore();
  });

  it.each([
    ['missing keystore', { KEYSTORE_BASE64: '' }],
    ['missing password', { PRINTLY_ANDROID_KEYSTORE_PASSWORD: '' }],
    ['malformed password', { PRINTLY_ANDROID_KEYSTORE_PASSWORD: 'not-the-generated-password' }],
    ['password with an internal newline', { PRINTLY_ANDROID_KEYSTORE_PASSWORD: 'c'.repeat(32) + '\n' + 'c'.repeat(32) }],
    ['invalid expected fingerprint', { EXPECTED_CERTIFICATE: 'not-a-fingerprint' }],
    ['unmatched manual fingerprint', { GITHUB_EVENT_NAME: 'workflow_dispatch', MANUAL_EXPECTED_CERTIFICATE: 'b'.repeat(64) }],
    ['unexpected event', { GITHUB_EVENT_NAME: 'pull_request' }],
    ['missing version', { REQUESTED_VERSION_CODE: '' }],
    ['zero version', { REQUESTED_VERSION_CODE: '0' }],
    ['version with a leading zero', { REQUESTED_VERSION_CODE: '01' }],
    ['oversized version', { REQUESTED_VERSION_CODE: '2100000001' }],
    ['invalid base64', { KEYSTORE_BASE64: 'not-valid-base64!' }],
    ['failed build', { FAKE_GRADLE_FAIL: '1' }],
    ['different signer', { FAKE_ACTUAL: 'b'.repeat(64) }],
    ['multiple signers', { FAKE_TWO_SIGNERS: '1' }],
    ['different package', { FAKE_PACKAGE: 'other.package' }],
    ['different version', { FAKE_VERSION: '2' }],
  ])('fails closed for %s and removes any temporary key', (_name, overrides) => {
    const f = setup(overrides); const result = f.run();
    expect(result.status).not.toBe(0); f.noTemporaryKeystore();
    expect(existsSync(join(f.app, 'sha256-evidence.txt'))).toBe(false);
    expect(result.stdout + result.stderr).not.toContain('c'.repeat(64));
  });
});
