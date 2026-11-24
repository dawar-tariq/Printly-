import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/create-owner-signing-key.sh');
let root;
let vault;
let result;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'printly-test-key-'));
  chmodSync(root, 0o700);
  vault = join(root, 'disposable');
  result = spawnSync('bash', [script, vault], { encoding: 'utf8', timeout: 30_000 });
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('Android signing key creation (disposable test key)', () => {
  it('creates a private, password-protected keystore without printing the password', () => {
    expect(result.status, result.stderr).toBe(0);
    const password = readFileSync(join(vault, 'keystore-password.txt'), 'utf8').trim();
    expect(password).toMatch(/^[a-f0-9]{64}$/);
    expect(result.stdout).not.toContain(password);
    expect(result.stderr).not.toContain(password);
    expect(statSync(vault).mode & 0o777).toBe(0o700);
    expect(statSync(join(vault, 'keystore-password.txt')).mode & 0o777).toBe(0o600);
    expect(statSync(join(vault, 'printly-owner-release.p12')).mode & 0o777).toBe(0o600);
    expect(() => statSync(join(vault, 'encrypted-private-key.pem'))).toThrow();
    expect(readFileSync(join(vault, 'signing-info.txt'), 'utf8')).toMatch(/Alias: printly-owner-release[\s\S]*Certificate SHA-256: (?:[A-F0-9]{2}:){31}[A-F0-9]{2}/);
    const info = execFileSync('openssl', ['pkcs12', '-in', join(vault, 'printly-owner-release.p12'), '-passin', `file:${join(vault, 'keystore-password.txt')}`, '-info', '-noout'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(info).not.toContain(password);
  });

  it('rejects a wrong password and refuses to overwrite an existing vault', () => {
    const wrong = join(root, 'wrong-password.txt');
    writeFileSync(wrong, 'wrong-test-password\n', { mode: 0o600 });
    const invalid = spawnSync('openssl', ['pkcs12', '-in', join(vault, 'printly-owner-release.p12'), '-passin', `file:${wrong}`, '-info', '-noout'], { encoding: 'utf8' });
    expect(invalid.status).not.toBe(0);
    const before = readFileSync(join(vault, 'printly-owner-release.p12'));
    const second = spawnSync('bash', [script, vault], { encoding: 'utf8' });
    expect(second.status).not.toBe(0);
    expect(readFileSync(join(vault, 'printly-owner-release.p12'))).toEqual(before);
  });

  it('removes incomplete credentials when generation fails', () => {
    const fakeBin = join(root, 'fake-bin'); mkdirSync(fakeBin);
    const fakeOpenSsl = join(fakeBin, 'openssl');
    writeFileSync(fakeOpenSsl, '#!/bin/sh\nif [ "$1" = rand ]; then printf "disposable-test-password\\n"; exit 0; fi\nexit 42\n', { mode: 0o755 });
    const incomplete = join(root, 'incomplete');
    const failed = spawnSync('bash', [script, incomplete], { encoding: 'utf8', env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
    expect(failed.status).not.toBe(0);
    expect(() => statSync(incomplete)).toThrow();
  });
});
