#!/usr/bin/env bash
# Sign and inspect the branch-specific review APK. Invoke from the Android app
# directory with secrets supplied in the process environment, never arguments.
set -euo pipefail

: "${RUNNER_TEMP:?Runner temporary directory is required}"
: "${ANDROID_HOME:?Android SDK is required}"
KEYSTORE_BASE64=${KEYSTORE_BASE64:-}
PRINTLY_ANDROID_KEYSTORE_PASSWORD=${PRINTLY_ANDROID_KEYSTORE_PASSWORD:-}
EXPECTED_CERTIFICATE=${EXPECTED_CERTIFICATE:-}
MANUAL_EXPECTED_CERTIFICATE=${MANUAL_EXPECTED_CERTIFICATE:-}
REQUESTED_VERSION_CODE=${REQUESTED_VERSION_CODE:-}
GITHUB_EVENT_NAME=${GITHUB_EVENT_NAME:-}

if [ -z "$KEYSTORE_BASE64" ] || [ -z "$PRINTLY_ANDROID_KEYSTORE_PASSWORD" ]; then
  echo 'Release signing environment secrets are not configured.' >&2
  exit 1
fi
if [[ ! "$REQUESTED_VERSION_CODE" =~ ^[1-9][0-9]{0,9}$ ]] || (( 10#$REQUESTED_VERSION_CODE > 2100000000 )); then
  echo 'The review request has an invalid version code.' >&2
  exit 1
fi
expected=$(printf '%s' "$EXPECTED_CERTIFICATE" | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { echo 'Configure the independently verified certificate fingerprint.' >&2; exit 1; }
case "$GITHUB_EVENT_NAME" in
  push) ;;
  workflow_dispatch)
    manual=$(printf '%s' "$MANUAL_EXPECTED_CERTIFICATE" | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')
    [ "$manual" = "$expected" ] || { echo 'The manual fingerprint does not match the independently configured fingerprint.' >&2; exit 1; }
    ;;
  *) echo 'Unsupported review trigger.' >&2; exit 1 ;;
esac

# The one-off review key generated for this branch is PKCS12 with this public
# alias. Its key and store passwords are the same. Never print either password.
export PRINTLY_ANDROID_KEYSTORE_TYPE=PKCS12
export PRINTLY_ANDROID_KEY_ALIAS=printly-owner-release
export PRINTLY_ANDROID_KEYSTORE_PASSWORD
export PRINTLY_ANDROID_KEY_PASSWORD="$PRINTLY_ANDROID_KEYSTORE_PASSWORD"
umask 077
PRINTLY_ANDROID_KEYSTORE_PATH=$(mktemp "$RUNNER_TEMP/printly-release.XXXXXXXX.keystore")
export PRINTLY_ANDROID_KEYSTORE_PATH
trap 'rm -f "$PRINTLY_ANDROID_KEYSTORE_PATH"' EXIT
printf '%s' "$KEYSTORE_BASE64" | base64 --decode > "$PRINTLY_ANDROID_KEYSTORE_PATH"
test -s "$PRINTLY_ANDROID_KEYSTORE_PATH"
unset KEYSTORE_BASE64
./gradlew --no-daemon assembleRelease
unset PRINTLY_ANDROID_KEYSTORE_PASSWORD PRINTLY_ANDROID_KEY_PASSWORD
rm -f "$PRINTLY_ANDROID_KEYSTORE_PATH"

APK=app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$APK" > signer-evidence.txt
mapfile -t signers < <(sed -n 's/^Signer #[0-9]* certificate SHA-256 digest: //p' signer-evidence.txt)
test "${#signers[@]}" -eq 1
actual=$(printf '%s' "${signers[0]}" | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')
[ "$actual" = "$expected" ] || { echo 'Signer does not match the independently verified certificate.' >&2; exit 1; }
"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging "$APK" > package-evidence.txt
package_line=$(head -n 1 package-evidence.txt)
[[ "$package_line" == "package: name='io.github.dawartariq.printly.owner' "* ]] || { echo 'Unexpected Android package.' >&2; exit 1; }
[[ "$package_line" == *" versionCode='$REQUESTED_VERSION_CODE' "* ]] || { echo 'APK version code does not match the review request.' >&2; exit 1; }
sha256sum "$APK" > sha256-evidence.txt
echo "::notice title=Review APK SHA-256::$(cut -d' ' -f1 sha256-evidence.txt)"
