#!/usr/bin/env bash
# Validate the deliberate review request before exposing any signing key.
# The request's public reference certificate is checked against the protected
# environment's configured public fingerprint so an upgrade cannot silently
# use a different signing identity.
set -euo pipefail
fail() {
  local title=$1 message=$2
  printf '%s\n' "$message" >&2
  if [ "${GITHUB_ACTIONS:-}" = 'true' ]; then printf '::error title=%s::%s\n' "$title" "$message"; fi
  exit 1
}
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  fail 'Review request' 'A deliberate Android review request file is required.'
fi
command -v jq >/dev/null || fail 'Review request' 'The runner cannot validate the review request.'
if ! jq -e 'type == "object" and .purpose == "signed-review-only" and
  .package == "io.github.dawartariq.printly.owner" and
  (.request_id | type == "string" and test("^[A-Za-z0-9._-]{8,80}$")) and
  (.version_code | type == "number" and . >= 1 and . <= 2100000000 and . == floor) and
  (.reference_certificate_sha256 | type == "string")' "$1" >/dev/null 2>&1; then
  fail 'Review request' 'The Android review request is invalid.'
fi
reference=$(jq -r .reference_certificate_sha256 "$1" | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')
configured=$(printf '%s' "${EXPECTED_CERTIFICATE:-}" | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')
if [[ ! "$reference" =~ ^[0-9a-f]{64}$ || ! "$configured" =~ ^[0-9a-f]{64}$ || "$reference" != "$configured" ]]; then
  fail 'Review signer' 'The configured public certificate fingerprint does not match the approved review request.'
fi
[ -n "${GITHUB_OUTPUT:-}" ] || fail 'Review request' 'The runner cannot save the approved review version.'
printf 'version_code=%s\n' "$(jq -r .version_code "$1")" >> "$GITHUB_OUTPUT"
