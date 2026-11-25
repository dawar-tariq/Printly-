import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/create-native-draft-review.sh');
const commit = 'a'.repeat(40);
const tag = 'native-v2.0.1';
const file = 'Printly-for-Shops-2.0.1.apk';

function fixture({ before = [], tagStatus = 2, corruptEvidence = false, corruptUploadedDigest = false, repository = 'dawar-tariq/Printly-' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'printly-draft-test-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const apk = join(root, file);
  const evidence = join(root, 'sha256-evidence.txt');
  writeFileSync(apk, 'not a real APK; disposable test input\n');
  const hash = createHash('sha256').update(readFileSync(apk)).digest('hex');
  writeFileSync(evidence, `${corruptEvidence ? 'f'.repeat(64) : hash}  app/build/outputs/apk/release/app-release.apk\n`);
  writeFileSync(join(root, 'before.json'), JSON.stringify([before]));
  writeFileSync(join(root, 'after.json'), JSON.stringify([[{
    tag_name: tag, draft: true, prerelease: true, target_commitish: commit,
    assets: [{ name: file, digest: `sha256:${corruptUploadedDigest ? '0'.repeat(64) : hash}` }],
  }]]));
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nexit "$MOCK_TAG_STATUS"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
set -eu
case "$1" in
  api) if [ -f "$MOCK_CREATED" ]; then cat "$MOCK_AFTER"; else cat "$MOCK_BEFORE"; fi ;;
  release) printf '%s\\n' "$*" > "$MOCK_CALL"; touch "$MOCK_CREATED" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  const result = spawnSync('bash', [script, apk, evidence], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root,
      GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/heads/arena/309fdf51-printly',
      GITHUB_EVENT_NAME: 'push', GITHUB_SHA: commit, REQUESTED_VERSION_NAME: '2.0.1',
      REQUESTED_VERSION_CODE: '4', GH_TOKEN: 'fake-test-only', MOCK_TAG_STATUS: String(tagStatus),
      MOCK_CREATED: join(root, 'created'), MOCK_CALL: join(root, 'call'),
      MOCK_BEFORE: join(root, 'before.json'), MOCK_AFTER: join(root, 'after.json'),
    },
  });
  const created = existsSync(join(root, 'created'));
  const call = existsSync(join(root, 'call')) ? readFileSync(join(root, 'call'), 'utf8') : '';
  rmSync(root, { recursive: true, force: true });
  return { result, created, call };
}

test('creates only a draft pinned to the reviewed commit and checks the uploaded digest', () => {
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

test('does not report success when GitHub reports a different uploaded digest', () => {
  const { result, created } = fixture({ corruptUploadedDigest: true });
  assert.equal(created, true); // Keep the unpublished draft for investigation.
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Do not publish/);
});
