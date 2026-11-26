#!/usr/bin/env node
// A previously authorized signed-review request must never authorize a newer
// Gradle candidate. Read only public request/build metadata; no secrets or APKs.
import { readFileSync } from 'node:fs';

try {
  if (process.argv.length !== 4) throw new Error('Usage: check-native-review-version.mjs REQUEST_JSON BUILD_GRADLE');
  const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const build = readFileSync(process.argv[3], 'utf8');
  const codes = [...build.matchAll(/^[ \t]*versionCode[ \t]+([1-9]\d*)[ \t\r]*$/gm)];
  const names = [...build.matchAll(/^[ \t]*versionName[ \t]+'([^']+)'[ \t\r]*$/gm)];
  // Reject ambiguous additional directives or dynamic expressions, including
  // unexpected occurrences in comments. Signing preflight should fail closed.
  const codeTokens = [...build.matchAll(/\bversionCode\b/g)];
  const nameTokens = [...build.matchAll(/\bversionName\b/g)];
  if (!request || typeof request !== 'object' || Array.isArray(request) || codes.length !== 1 || names.length !== 1 ||
      codeTokens.length !== 1 || nameTokens.length !== 1 || !Number.isSafeInteger(request.version_code) ||
      request.version_code !== Number(codes[0][1]) || request.version_name !== names[0][1]) {
    throw new Error('The review request does not match the checked-in native candidate. A new explicit review request is required.');
  }
  console.log('The signed-review request matches the checked-in candidate version.');
} catch (error) {
  // Do not dump the request, environment, file contents or credentials.
  console.error(error instanceof Error && (error.message.startsWith('The review request') || error.message.startsWith('Usage:'))
    ? error.message : 'Could not validate the native review request and candidate version.');
  process.exitCode = 1;
}
