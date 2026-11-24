import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./encrypt-android-review.sh', import.meta.url));
const directories = [];
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }); });

function setup(passphrase, fakeError = '') {
  const root = mkdtempSync(join(tmpdir(), 'printly-encrypt-test-')); directories.push(root);
  const bin = join(root, 'bin'), runner = join(root, 'runner'); mkdirSync(bin); mkdirSync(runner);
  writeFileSync(join(bin, 'gpg'), `#!/usr/bin/env bash
set -euo pipefail
IFS= read -r supplied
[ "$supplied" = "$FAKE_EXPECTED_PASSPHRASE" ]
if [ -n "$FAKE_GPG_ERROR" ]; then printf '%s %s\\n' "$FAKE_GPG_ERROR" "$supplied" >&2; exit 1; fi
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output' ]; then shift; output=$1; fi
  shift
done
[ -n "$output" ]
printf 'disposable-encrypted-output' > "$output"
`, { mode: 0o700 });
  writeFileSync(join(bin, 'gpgconf'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o700 });
  const input = join(root, 'input.apk'), output = join(root, 'output.gpg');
  writeFileSync(input, 'disposable apk');
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: root, RUNNER_TEMP: runner, GITHUB_ACTIONS: 'true',
    PRINTLY_ANDROID_ARTIFACT_PASSPHRASE: passphrase, FAKE_EXPECTED_PASSPHRASE: 'b'.repeat(64), FAKE_GPG_ERROR: fakeError };
  const run = () => spawnSync('bash', [script, input, output], { env, encoding: 'utf8' });
  return { run, output, runner };
}

describe('encrypted Android review artifact setup', () => {
  it.each(['b'.repeat(64), 'b'.repeat(64) + '\n', 'b'.repeat(64) + '\r\n'])(
    'accepts a single-line passphrase including a copied trailing line ending', (passphrase) => {
      const f = setup(passphrase); const result = f.run();
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(f.output, 'utf8')).toBe('disposable-encrypted-output');
      expect(statSync(f.output).mode & 0o777).toBe(0o600);
      expect(readdirSync(f.runner)).toEqual([]);
      expect(result.stdout + result.stderr).not.toContain('b'.repeat(64));
    },
  );
  it.each(['', 'too-short', 'b'.repeat(32) + '\n' + 'b'.repeat(32), 'b'.repeat(32) + '\r' + 'b'.repeat(32), 'b'.repeat(1025)])(
    'rejects invalid or internally multiline passphrases without producing an artifact', (passphrase) => {
      const f = setup(passphrase); const result = f.run();
      expect(result.status).not.toBe(0);
      expect(existsSync(f.output)).toBe(false);
      expect(readdirSync(f.runner)).toEqual([]);
      expect(result.stdout).toContain('::error title=Review passphrase::');
    },
  );
  it.each([
    ['No space left on device', 'Review encryption storage'],
    ['Permission denied', 'Review encryption permissions'],
    ['No such file or directory', 'Review encryption file'],
    ['cannot connect to agent', 'Review encryption agent'],
    ['unexpected failure', 'Review encryption'],
  ])('reports a safe category for a GnuPG failure without exposing its output', (error, category) => {
    const f = setup('b'.repeat(64), error); const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(`::error title=${category}::`);
    expect(result.stdout + result.stderr).not.toContain('b'.repeat(64));
    expect(readdirSync(f.runner)).toEqual([]);
  });
});
