import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-android-review-encryption.sh', import.meta.url));
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function setup(passphrase, decryptMode = 'success') {
  const root = mkdtempSync(join(tmpdir(), 'printly-encryption-check-test-')); roots.push(root);
  const bin = join(root, 'bin'), runner = join(root, 'runner'); mkdirSync(bin); mkdirSync(runner);
  writeFileSync(join(bin, 'gpg'), `#!/usr/bin/env bash
set -euo pipefail
IFS= read -r supplied
[ "$supplied" = "$FAKE_EXPECTED_PASSPHRASE" ]
mode='' output='' output_next='' input=''
for arg in "$@"; do
  if [ -n "$output_next" ]; then output=$arg; output_next=''; fi
  case "$arg" in
    --symmetric) mode=encrypt ;;
    --decrypt) mode=decrypt ;;
    --output) output_next=1 ;;
  esac
  input=$arg
done
if [ "$mode" = encrypt ]; then
  cp "$input" "$output"
elif [ "$mode" = decrypt ]; then
  if [ "$FAKE_DECRYPT_MODE" = fail ]; then printf 'private error: %s\\n' "$supplied" >&2; exit 1; fi
  if [ "$FAKE_DECRYPT_MODE" = mismatch ]; then printf 'different sample'; else cat "$input"; fi
else
  exit 1
fi
`, { mode: 0o700 });
  writeFileSync(join(bin, 'gpgconf'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o700 });
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: root, RUNNER_TEMP: runner, GITHUB_ACTIONS: 'true',
    PRINTLY_ANDROID_ARTIFACT_PASSPHRASE: passphrase, FAKE_EXPECTED_PASSPHRASE: 'b'.repeat(64), FAKE_DECRYPT_MODE: decryptMode };
  const result = spawnSync('bash', [script], { env, encoding: 'utf8' });
  return { result, runner };
}

describe('protected Android review encryption pre-check', () => {
  it.each(['b'.repeat(64), 'b'.repeat(64) + '\n', 'b'.repeat(64) + '\r\n'])(
    'round-trips harmless data and cleans up for a valid passphrase', (passphrase) => {
      const { result, runner } = setup(passphrase);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('A harmless sample encrypted and decrypted successfully.');
      expect(result.stdout + result.stderr).not.toContain('b'.repeat(64));
      expect(readdirSync(runner)).toEqual([]);
    },
  );
  it.each(['', 'short', 'b'.repeat(32) + '\n' + 'b'.repeat(32)])(
    'fails safely on an invalid passphrase before the round-trip', (passphrase) => {
      const { result, runner } = setup(passphrase);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain('::error title=Review passphrase::');
      expect(result.stdout + result.stderr).not.toContain('b'.repeat(32));
      expect(readdirSync(runner)).toEqual([]);
    },
  );
  it.each([
    ['fail', 'The harmless sample could not be decrypted'],
    ['mismatch', 'The harmless sample did not round-trip correctly'],
  ])('fails closed on a %s decrypt result without logging raw output or the passphrase', (mode, message) => {
    const { result, runner } = setup('b'.repeat(64), mode);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(message);
    expect(result.stdout + result.stderr).not.toContain('private error');
    expect(result.stdout + result.stderr).not.toContain('b'.repeat(64));
    expect(readdirSync(runner)).toEqual([]);
  });
});
