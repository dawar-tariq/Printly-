import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-android-review-request.sh', import.meta.url));
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const reference = Array(32).fill('AA').join(':');
const valid = { purpose: 'signed-review-only', package: 'io.github.dawartariq.printly.owner',
  request_id: 'review-test-1234', version_code: 2, reference_certificate_sha256: reference };

function run(request = valid, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'printly-review-request-test-')); roots.push(root);
  const path = join(root, 'request.json'), output = join(root, 'output');
  writeFileSync(path, typeof request === 'string' ? request : JSON.stringify(request));
  writeFileSync(output, '');
  const env = { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: output,
    EXPECTED_CERTIFICATE: 'a'.repeat(64), ...overrides };
  const result = spawnSync('bash', [script, path], { env, encoding: 'utf8' });
  return { result, output: readFileSync(output, 'utf8') };
}

describe('protected review request validation', () => {
  it('accepts the approved version and equivalent colon-separated fingerprint', () => {
    const { result, output } = run();
    expect(result.status, result.stderr).toBe(0);
    expect(output).toBe('version_code=2\n');
  });
  it.each([
    ['wrong purpose', { ...valid, purpose: 'publish' }],
    ['wrong package', { ...valid, package: 'other.package' }],
    ['invalid request ID', { ...valid, request_id: 'bad id' }],
    ['zero version', { ...valid, version_code: 0 }],
    ['fractional version', { ...valid, version_code: 1.5 }],
    ['oversized version', { ...valid, version_code: 2100000001 }],
    ['string version', { ...valid, version_code: '2' }],
    ['missing reference fingerprint', { ...valid, reference_certificate_sha256: undefined }],
    ['malformed JSON', '{'],
  ])('rejects a %s without producing a version', (_description, request) => {
    const { result, output } = run(request);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('::error title=Review request::');
    expect(output).toBe('');
  });
  it.each([
    ['different reference', { ...valid, reference_certificate_sha256: 'b'.repeat(64) }, {}],
    ['invalid reference', { ...valid, reference_certificate_sha256: 'x'.repeat(64) }, {}],
    ['missing configured fingerprint', valid, { EXPECTED_CERTIFICATE: '' }],
    ['malformed configured fingerprint', valid, { EXPECTED_CERTIFICATE: 'short' }],
  ])('rejects a %s before allowing signing', (_description, request, overrides) => {
    const { result, output } = run(request, overrides);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('::error title=Review signer::');
    expect(output).toBe('');
  });
});
