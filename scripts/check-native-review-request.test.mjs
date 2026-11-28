import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-native-review-request.sh', import.meta.url));
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const valid = { purpose: 'signed-review-only', variant: 'native', package: 'io.github.dawartariq.printly.owner',
  request_id: 'native-review-test-1234', version_code: 4, version_name: '2.0.1', reference_certificate_sha256: 'a'.repeat(64) };
function run(request, fingerprint = 'a'.repeat(64)) {
  const root = mkdtempSync(join(tmpdir(), 'printly-native-review-')); roots.push(root);
  const path = join(root, 'request.json'), output = join(root, 'output');
  writeFileSync(path, JSON.stringify(request)); writeFileSync(output, '');
  const result = spawnSync('bash', [script, path], { env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: output, EXPECTED_CERTIFICATE: fingerprint }, encoding: 'utf8' });
  return { result, output: readFileSync(output, 'utf8') };
}

describe('native review request', () => {
  it('accepts a matching native request with a bounded version name', () => {
    const { result, output } = run(valid);
    expect(result.status, result.stderr).toBe(0);
    expect(output).toBe('version_code=4\nversion_name=2.0.1\n');
  });
  it.each([
    { ...valid, variant: 'twa' }, { ...valid, variant: undefined }, { ...valid, version_name: 'bad name' },
    { ...valid, version_name: 'v'.repeat(41) }, { ...valid, purpose: 'publish' },
    { ...valid, package: 'wrong.package' }, { ...valid, version_code: 0 },
  ])('rejects an invalid request before producing signing inputs', (request) => {
    const { result, output } = run(request);
    expect(result.status).not.toBe(0);
    expect(output).toBe('');
  });
  it('rejects a certificate that does not match the protected environment', () => {
    const { result, output } = run(valid, 'b'.repeat(64));
    expect(result.status).not.toBe(0); expect(output).toBe('');
  });
});
