#!/usr/bin/env bash
# Check the configured review-artifact passphrase and GnuPG with harmless data.
# This must run before any signing credentials are made available.
set -euo pipefail

fail() {
  local message=$1
  printf '%s\n' "$message" >&2
  if [ "${GITHUB_ACTIONS:-}" = 'true' ]; then printf '::error title=Review encryption check::%s\n' "$message"; fi
  exit 1
}

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
umask 077
CHECK_ROOT=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/printly-review-check.XXXXXXXX") || fail 'The runner could not create a private directory for the encryption check.'
export GNUPGHOME="$CHECK_ROOT/gnupg"
cleanup() {
  gpgconf --kill gpg-agent >/dev/null 2>&1 || true
  rm -rf -- "$CHECK_ROOT"
}
trap cleanup EXIT
mkdir -m 700 "$GNUPGHOME" || fail 'The runner could not secure the encryption check directory.'
SAMPLE="$CHECK_ROOT/sample.txt"
ENCRYPTED="$CHECK_ROOT/sample.gpg"
ROUNDTRIP="$CHECK_ROOT/roundtrip.txt"
printf '%s\n' 'Disposable review encryption check' > "$SAMPLE"
"$script_dir/encrypt-android-review.sh" "$SAMPLE" "$ENCRYPTED"

# Use the same copied-line-ending handling as the encryption script. No
# passphrase is placed on a command line or in the log.
passphrase=${PRINTLY_ANDROID_ARTIFACT_PASSPHRASE:-}
unset PRINTLY_ANDROID_ARTIFACT_PASSPHRASE
while [[ "$passphrase" == *$'\n' || "$passphrase" == *$'\r' ]]; do passphrase=${passphrase%?}; done
if ! printf '%s\n' "$passphrase" | gpg --batch --yes --pinentry-mode loopback --no-symkey-cache \
  --passphrase-fd 0 --decrypt "$ENCRYPTED" > "$ROUNDTRIP" 2> "$CHECK_ROOT/gpg-error.txt"; then
  fail 'The harmless sample could not be decrypted on the runner.'
fi
unset passphrase
if ! cmp -s "$SAMPLE" "$ROUNDTRIP"; then
  fail 'The harmless sample did not round-trip correctly.'
fi
if [ "${GITHUB_ACTIONS:-}" = 'true' ]; then
  echo '::notice title=Review encryption check::A harmless sample encrypted and decrypted successfully.'
fi
