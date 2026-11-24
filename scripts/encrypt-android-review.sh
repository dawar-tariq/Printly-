#!/usr/bin/env bash
# Encrypt the review APK before it becomes a GitHub Actions artifact. This
# repository is public, so an unencrypted artifact is not a private download.
set -euo pipefail

if [ "$#" -ne 2 ] || [ ! -f "$1" ] || [ "$1" = "$2" ]; then
  echo 'Usage: encrypt-android-review.sh INPUT_APK OUTPUT_GPG' >&2
  exit 1
fi
passphrase=${PRINTLY_ANDROID_ARTIFACT_PASSPHRASE:-}
unset PRINTLY_ANDROID_ARTIFACT_PASSPHRASE
if [ "${#passphrase}" -lt 24 ] || [ "${#passphrase}" -gt 1024 ] || [[ "$passphrase" == *$'\n'* || "$passphrase" == *$'\r'* ]]; then
  echo 'Configure a separate, single-line artifact passphrase of at least 24 characters.' >&2
  exit 1
fi
command -v gpg >/dev/null || { echo 'GnuPG is required to encrypt the review APK.' >&2; exit 1; }
umask 077
export GNUPGHOME
GNUPGHOME=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/printly-review-gpg.XXXXXXXX")
trap 'gpgconf --kill gpg-agent >/dev/null 2>&1 || true; rm -rf "$GNUPGHOME"' EXIT
chmod 700 "$GNUPGHOME"
# The passphrase is read on stdin, never placed in the command line or log.
# OpenPGP's integrity protection is verified when the recipient decrypts it.
printf '%s\n' "$passphrase" | gpg --batch --yes --pinentry-mode loopback --no-symkey-cache \
  --passphrase-fd 0 --symmetric --cipher-algo AES256 --s2k-digest-algo SHA256 \
  --s2k-mode 3 --s2k-count 65011712 --compress-algo none --output "$2" "$1"
unset passphrase
