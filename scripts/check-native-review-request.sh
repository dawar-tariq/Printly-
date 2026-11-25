#!/usr/bin/env bash
# The native review is distinct from the older TWA review and may not publish.
set -euo pipefail
if [ "$#" -ne 1 ] || [ ! -f "$1" ] || ! command -v jq >/dev/null; then
  echo 'A valid native Android review request and jq are required.' >&2
  exit 1
fi
if ! jq -e 'type == "object" and .variant == "native" and
  (.version_name | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$"))' "$1" >/dev/null 2>&1; then
  echo 'The native variant or version name is invalid.' >&2
  if [ "${GITHUB_ACTIONS:-}" = true ]; then echo '::error title=Native review request::The native variant or version name is invalid.'; fi
  exit 1
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
"$script_dir/check-android-review-request.sh" "$1"
printf 'version_name=%s\n' "$(jq -r .version_name "$1")" >> "${GITHUB_OUTPUT:?}"
