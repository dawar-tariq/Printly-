import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Android CI runs this with Node before installing website dependencies;
// the website suite also discovers it via Vitest. Use the invoking runner.
const test = process.env.VITEST ? (await import('vitest')).test : nodeTest;

const script = resolve('scripts/create-native-draft-review.sh');
const commit = 'a'.repeat(40);
const certificate = 'c'.repeat(64);
const tag = 'native-v2.1.1';
const file = 'Printly-for-Shops-2.1.1.apk';

function fixture({ before = [], tagStatus = 2, corruptEvidence = false, corruptUploadedDigest = false, corruptDownload = false, wrongSigner = false, debuggable = false, repository = 'dawar-tariq/Printly-' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'printly-draft-test-'));
  const bin = join(root, 'bin');
  const android = join(root, 'android');
  const tools = join(android, 'build-tools', '36.0.0');
  mkdirSync(bin);
  mkdirSync(tools, { recursive: true });
  const apk = join(root, file);
  const evidence = join(root, 'sha256-evidence.txt');
  writeFileSync(apk, 'not a real APK; disposable test input\n');
  writeFileSync(join(root, 'downloaded.apk'), corruptDownload ? 'wrong bytes' : readFileSync(apk));
  const hash = createHash('sha256').update(readFileSync(apk)).digest('hex');
  writeFileSync(evidence, `${corruptEvidence ? 'f'.repeat(64) : hash}  app/build/outputs/apk/release/app-release.apk\n`);
  writeFileSync(join(root, 'before.json'), JSON.stringify([before]));
  writeFileSync(join(root, 'after.json'), JSON.stringify([[{
    tag_name: tag, draft: true, prerelease: true, target_commitish: commit,
    assets: [{ id: 12345, name: file, state: 'uploaded', digest: `sha256:${corruptUploadedDigest ? '0'.repeat(64) : hash}` }],
  }]]));
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nexit "$MOCK_TAG_STATUS"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
set -eu
case "$1" in
  api) case "$*" in */releases/assets/*) cat "$MOCK_DOWNLOAD" ;; *) if [ -f "$MOCK_CREATED" ]; then cat "$MOCK_AFTER"; else cat "$MOCK_BEFORE"; fi ;; esac ;;
  release) printf '%s\\n' "$*" > "$MOCK_CALL"; touch "$MOCK_CREATED" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(tools, 'apksigner'), '#!/bin/sh\nprintf "Signer #1 certificate SHA-256 digest: %s\\n" "$MOCK_CERT"\n', { mode: 0o755 });
  writeFileSync(join(tools, 'aapt'), `#!/bin/sh
printf "package: name='io.github.dawartariq.printly.owner' versionCode='6' versionName='2.1.1' platformBuildVersionName='16'\\n"
if [ "$MOCK_DEBUGGABLE" = 1 ]; then echo application-debuggable; fi
`, { mode: 0o755 });
  const result = spawnSync('bash', [script, apk, evidence], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root, ANDROID_HOME: android,
      GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/heads/arena/309fdf51-printly',
      GITHUB_EVENT_NAME: 'push', GITHUB_SHA: commit, REQUESTED_VERSION_NAME: '2.1.1',
      REQUESTED_VERSION_CODE: '6', EXPECTED_CERTIFICATE: certificate, GH_TOKEN: 'fake-test-only',
      MOCK_TAG_STATUS: String(tagStatus), MOCK_CERT: wrongSigner ? 'e'.repeat(64) : certificate,
      MOCK_DEBUGGABLE: debuggable ? '1' : '0', MOCK_DOWNLOAD: join(root, 'downloaded.apk'),
      MOCK_CREATED: join(root, 'created'), MOCK_CALL: join(root, 'call'),
      MOCK_BEFORE: join(root, 'before.json'), MOCK_AFTER: join(root, 'after.json'),
    },
  });
  const created = existsSync(join(root, 'created'));
  const call = existsSync(join(root, 'call')) ? readFileSync(join(root, 'call'), 'utf8') : '';
  rmSync(root, { recursive: true, force: true });
  return { result, created, call };
}

test('creates only a draft pinned to the reviewed commit and verifies downloaded bytes and identity', () => {
  const { result, created, call } = fixture();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(created, true);
  assert.match(call, /--draft\b/);
  assert.match(call, /--prerelease\b/);
  assert.ok(call.includes(`--target ${commit}`));
  assert.doesNotMatch(result.stdout + result.stderr, /fake-test-only/);
});

test('refuses wrong identity, checksum, an existing tag, or an existing draft', () => {
  for (const options of [
    { repository: 'other/repo' }, { corruptEvidence: true }, { tagStatus: 0 },
    { tagStatus: 128 }, { before: [{ tag_name: tag, draft: true }] },
  ]) {
    const { result, created } = fixture(options);
    assert.notEqual(result.status, 0, JSON.stringify(options));
    assert.equal(created, false, JSON.stringify(options));
  }
});

test('does not report success for a bad hosted digest, download, signer or debuggable package', () => {
  for (const options of [{ corruptUploadedDigest: true }, { corruptDownload: true }, { wrongSigner: true }, { debuggable: true }]) {
    const { result, created } = fixture(options);
    assert.equal(created, true, JSON.stringify(options)); // Keep the unpublished draft for investigation.
    assert.notEqual(result.status, 0, JSON.stringify(options));
    assert.match(result.stderr, /Do not publish/);
  }
});
