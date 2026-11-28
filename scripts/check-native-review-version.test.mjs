import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const test = process.env.VITEST ? (await import('vitest')).test : nodeTest;
const script = resolve('scripts/check-native-review-version.mjs');
const request = { version_code: 5, version_name: '2.1.0' };
const build = "defaultConfig {\n    versionCode 5\n    versionName '2.1.0'\n}\n";

function check(value, gradle) {
  const root = mkdtempSync(join(tmpdir(), 'printly-review-version-'));
  try {
    const json = join(root, 'request.json'), source = join(root, 'build.gradle');
    writeFileSync(json, typeof value === 'string' ? value : JSON.stringify(value));
    writeFileSync(source, gradle);
    return spawnSync(process.execPath, [script, json, source], { encoding: 'utf8' });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('accepts only the identical, unambiguous literal candidate version', () => {
  assert.equal(check(request, build).status, 0);
  for (const [value, gradle] of [
    [{ ...request, version_code: 4 }, build],
    [{ ...request, version_name: '2.0.1' }, build],
    [{ ...request, version_code: '5' }, build],
    [request, build.replace('versionCode 5', 'versionCode project.version')],
    [request, build.replace('versionCode 5', 'versionCode 5\n    versionCode 6')],
    [request, build.replace("versionName '2.1.0'", "versionName '2.1.0'\n    versionName project.name")],
    [request, build.replace('versionCode 5', 'versionCode 5\n    other(); versionCode 6')],
    ['{invalid', build],
  ]) assert.notEqual(check(value, gradle).status, 0);
});

test('the protected workflow runs the guard before referencing signing secrets', () => {
  const workflow = readFileSync('.github/workflows/android-native-release-review.yml', 'utf8');
  const guard = workflow.indexOf('node ../../scripts/check-native-review-version.mjs signed-review-request.json app/build.gradle');
  const secrets = workflow.indexOf('secrets.PRINTLY_ANDROID_');
  assert.ok(guard >= 0 && secrets > guard);
});
