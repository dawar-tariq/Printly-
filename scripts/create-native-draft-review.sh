#!/usr/bin/env bash
# Create an unpublished GitHub release containing the already-verified native
# APK, for an authorized operator's device test. Never upload signing material.
set -euo pipefail

fail() { printf '%s\n' "$1" >&2; exit 1; }
if [ "$#" -ne 2 ] || [ ! -f "$1" ] || [ ! -f "$2" ]; then
  fail 'The verified native APK and checksum evidence are required.'
fi
apk=$1
evidence=$2
[ "${GITHUB_REPOSITORY:-}" = 'dawar-tariq/Printly-' ] || fail 'Unexpected repository.'
[ "${GITHUB_REF:-}" = 'refs/heads/arena/309fdf51-printly' ] || fail 'Unexpected release branch.'
case "${GITHUB_EVENT_NAME:-}" in push|workflow_dispatch) ;; *) fail 'Unexpected release trigger.' ;; esac
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || fail 'A full reviewed commit SHA is required.'
[ "${REQUESTED_VERSION_NAME:-}" = '2.1.5' ] && [ "${REQUESTED_VERSION_CODE:-}" = '11' ] || fail 'Unexpected native version.'
[ "$(basename -- "$apk")" = 'Printly-for-Shops-2.1.5.apk' ] || fail 'Unexpected APK filename.'
[ -n "${GH_TOKEN:-}" ] || fail 'The scoped GitHub token is unavailable.'
certificate=$(printf '%s' "${EXPECTED_CERTIFICATE:-}" | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')
[[ "$certificate" =~ ^[0-9a-f]{64}$ ]] || fail 'A verified public certificate fingerprint is required.'
tools="${ANDROID_HOME:?}/build-tools/36.0.0"
[ -x "$tools/apksigner" ] && [ -x "$tools/aapt" ] || fail 'Android verification tools are unavailable.'
expected=$(awk 'NR == 1 { print $1 }' "$evidence")
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail 'Invalid APK checksum evidence.'
actual=$(sha256sum "$apk" | cut -d' ' -f1)
[ "$actual" = "$expected" ] || fail 'The APK does not match the signed-build checksum.'

umask 077
work=$(mktemp -d "${RUNNER_TEMP:?}/printly-native-draft.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
repo='dawar-tariq/Printly-'
tag='native-v2.1.5'
# A pre-existing tag would make --target ineffective. Fail closed on either an
# existing tag or an indeterminate network error, rather than creating one.
if git ls-remote --exit-code --refs --tags "https://github.com/${repo}.git" "refs/tags/${tag}" > "$work/tag"; then
  fail 'The native release tag already exists; refusing to replace it.'
else
  status=$?
  [ "$status" -eq 2 ] || fail 'Could not verify that the native release tag is unused.'
fi
# Drafts are not reliably returned by releases/tags/{tag}; list them with the
# authorized token so an existing draft is never overwritten or reused.
gh api --paginate --slurp "repos/${repo}/releases?per_page=100" > "$work/before.json"
jq -e --arg tag "$tag" '([add[] | select(.tag_name == $tag)] | length) == 0' "$work/before.json" >/dev/null \
  || fail 'A release or draft already uses this tag; refusing to replace it.'

gh release create "$tag" "$apk" --repo "$repo" --target "$GITHUB_SHA" --draft --prerelease \
  --title 'Printly for Shops 2.1.5 — device review' \
  --notes 'Signed native Android candidate for an authorized device test. This draft uses the production Printly site and is not yet a public release.'

gh api --paginate --slurp "repos/${repo}/releases?per_page=100" > "$work/after.json"
jq -e --arg tag "$tag" --arg commit "$GITHUB_SHA" --arg digest "sha256:$expected" '
  [add[] | select(.tag_name == $tag)] |
  length == 1 and .[0].draft == true and .[0].prerelease == true and
  .[0].target_commitish == $commit and (.[0].assets | length) == 1 and
  .[0].assets[0].name == "Printly-for-Shops-2.1.5.apk" and .[0].assets[0].state == "uploaded" and
  .[0].assets[0].digest == $digest and (.[0].assets[0].id | type) == "number"
' "$work/after.json" >/dev/null || fail 'The draft exists but its uploaded asset could not be verified. Do not publish it.'
asset_id=$(jq -r --arg tag "$tag" '[add[] | select(.tag_name == $tag)][0].assets[0].id' "$work/after.json")
[[ "$asset_id" =~ ^[1-9][0-9]*$ ]] || fail 'The draft asset ID is invalid. Do not publish it.'
# Independently retrieve the hosted bytes rather than relying only on metadata.
gh api -H 'Accept: application/octet-stream' "repos/${repo}/releases/assets/${asset_id}" > "$work/hosted.apk"
hosted=$(sha256sum "$work/hosted.apk" | cut -d' ' -f1)
[ "$hosted" = "$expected" ] || fail 'The downloaded draft APK differs from the signed build. Do not publish it.'
"$tools/apksigner" verify --verbose --print-certs "$work/hosted.apk" > "$work/signer.txt"
mapfile -t signers < <(sed -n 's/^Signer #[0-9]* certificate SHA-256 digest: //p' "$work/signer.txt")
[ "${#signers[@]}" -eq 1 ] || fail 'The downloaded APK does not have exactly one signer. Do not publish it.'
actual_certificate=$(printf '%s' "${signers[0]}" | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')
[ "$actual_certificate" = "$certificate" ] || fail 'The downloaded APK has the wrong signer. Do not publish it.'
"$tools/aapt" dump badging "$work/hosted.apk" > "$work/badging.txt"
package_line=$(head -n 1 "$work/badging.txt")
[[ "$package_line" == "package: name='io.github.dawartariq.printly.owner' "* ]] || fail 'Unexpected downloaded APK package.'
[[ "$package_line" == *" versionCode='11' "* && "$package_line" == *" versionName='2.1.5' "* ]] || fail 'Unexpected downloaded APK version.'
if grep -q '^application-debuggable' "$work/badging.txt"; then fail 'The downloaded APK is debuggable. Do not publish it.'; fi
echo 'Verified the unpublished draft by downloading its APK and checking SHA-256, signer, package and version. A device test is still required.'
