import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-android-launch-manifest.py', import.meta.url));
const source = readFileSync('apps/printly-owner-android/app/src/main/AndroidManifest.xml', 'utf8');
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function run(xml, expectedPackage) {
  const root = mkdtempSync(join(tmpdir(), 'printly-launch-manifest-test-')); roots.push(root);
  const path = join(root, 'AndroidManifest.xml'); writeFileSync(path, xml);
  return spawnSync('python3', [script, path, ...(expectedPackage ? [expectedPackage] : [])], { encoding: 'utf8' });
}
function change(before, after) {
  expect(source).toContain(before);
  return source.replace(before, after);
}
const manage = '<activity android:name="com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity" android:exported="false">\n            <meta-data android:name="android.support.customtabs.trusted.MANAGE_SPACE_URL" android:value="@string/launch_url" />\n        </activity>';

describe('owner Android launch manifest guard', () => {
  it('accepts the actual source manifest', () => {
    const result = run(source);
    expect(result.status, result.stderr).toBe(0);
  });
  it('accepts the expected package on a compiled-style manifest', () => {
    const xml = change('<manifest xmlns:android=', '<manifest package="io.github.dawartariq.printly.owner.debug" xmlns:android=');
    expect(run(xml, 'io.github.dawartariq.printly.owner.debug').status).toBe(0);
    expect(run(xml, 'io.github.dawartariq.printly.owner').status).not.toBe(0);
  });
  it.each([
    ['missing browser-helper component', () => change(manage, '')],
    ['duplicate browser-helper component', () => change(manage, `${manage}\n${manage}`)],
    ['exported browser-helper component', () => change(manage, manage.replace('android:exported="false"', 'android:exported="true"'))],
    ['missing browser-helper URL', () => change(manage, manage.replace('<meta-data android:name="android.support.customtabs.trusted.MANAGE_SPACE_URL" android:value="@string/launch_url" />', ''))],
    ['non-exported launcher', () => change('android:label="@string/app_name" android:exported="true"', 'android:label="@string/app_name" android:exported="false"')],
    ['missing launcher category', () => change('<category android:name="android.intent.category.LAUNCHER" />', '')],
    ['malformed manifest', () => '<manifest>'],
  ])('rejects a %s', (_description, makeXml) => {
    const result = run(makeXml());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Android launch manifest check failed:');
  });
});
