#!/usr/bin/env bash
# Encrypt the review APK before it becomes a GitHub Actions artifact. This
# repository is public, so an unencrypted artifact is not a private download.
set -euo pipefail

# GitHub run logs may be inaccessible to the operator. Report only a fixed,
# non-secret failure category as an annotation; never print a passphrase or
# include raw GnuPG output in the annotation.
fail() {
  local title=$1 message=$2
  printf '%s\n' "$message" >&2
  if [ "${GITHUB_ACTIONS:-}" = 'true' ]; then printf '::error title=%s::%s\n' "$title" "$message"; fi
  exit 1
}

if [ "$#" -ne 2 ] || [ ! -f "$1" ] || [ "$1" = "$2" ]; then
  fail 'Review encryption input' 'Review encryption needs an existing input file and a different output path.'
fi
passphrase=${PRINTLY_ANDROID_ARTIFACT_PASSPHRASE:-}
unset PRINTLY_ANDROID_ARTIFACT_PASSPHRASE
# Allow trailing line endings from copying a text file; still reject a newline
# inside the passphrase so decryption cannot silently use only its first line.
while [[ "$passphrase" == *$'\n' || "$passphrase" == *$'\r' ]]; do passphrase=${passphrase%?}; done
if [ "${#passphrase}" -lt 24 ] || [ "${#passphrase}" -gt 1024 ] || [[ "$passphrase" == *$'\n'* || "$passphrase" == *$'\r'* ]]; then
  fail 'Review passphrase' 'Configure PRINTLY_ANDROID_ARTIFACT_PASSPHRASE as a separate, single-line value of at least 24 characters in the protected environment.'
fi
command -v gpg >/dev/null || fail 'Review encryption' 'GnuPG is unavailable on the runner.'
umask 077
export GNUPGHOME
GNUPGHOME=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/printly-review-gpg.XXXXXXXX") || fail 'Review encryption' 'The runner could not create a private encryption directory.'
trap 'gpgconf --kill gpg-agent >/dev/null 2>&1 || true; rm -rf "$GNUPGHOME"' EXIT
chmod 700 "$GNUPGHOME" || fail 'Review encryption permissions' 'The runner could not secure its private encryption directory.'
# The passphrase is read on stdin, never placed in the command line or log.
# OpenPGP's integrity protection is verified when the recipient decrypts it.
# Capture stderr privately and emit only fixed error categories to avoid
# disclosing unexpected content from an external process.
if ! printf '%s\n' "$passphrase" | gpg --batch --yes --pinentry-mode loopback --no-symkey-cache \
  --passphrase-fd 0 --symmetric --cipher-algo AES256 --s2k-digest-algo SHA256 \
  --s2k-mode 3 --s2k-count 65011712 --compress-algo none --output "$2" "$1" 2> "$GNUPGHOME/gpg-error.txt"; then
  if grep -qiE 'no space left|disk quota exceeded' "$GNUPGHOME/gpg-error.txt"; then
    fail 'Review encryption storage' 'The runner ran out of storage while encrypting the review artifact.'
  elif grep -qiE 'permission denied|operation not permitted' "$GNUPGHOME/gpg-error.txt"; then
    fail 'Review encryption permissions' 'The runner could not read or write a file required for encryption.'
  elif grep -qiE 'no such file or directory|not found' "$GNUPGHOME/gpg-error.txt"; then
    fail 'Review encryption file' 'A file or program needed by GnuPG was not found.'
  elif grep -qiE 'agent|pinentry|inappropriate ioctl' "$GNUPGHOME/gpg-error.txt"; then
    fail 'Review encryption agent' 'GnuPG could not use its non-interactive encryption agent.'
  else
    fail 'Review encryption' 'GnuPG failed to encrypt the review artifact after passphrase validation.'
  fi
fi
unset passphrase
