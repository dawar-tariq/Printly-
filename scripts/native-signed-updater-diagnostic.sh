#!/usr/bin/env bash
# ONLY on a fresh disposable CI emulator with no real accounts or data.
set -eEuo pipefail
trap 'code=$?; echo "::error title=Signed updater diagnostic::Setup or test failed at script line ${LINENO}, exit ${code}"' ERR
[ "${PRINTLY_DISPOSABLE_EMULATOR:-}" = 1 ]
mapfile -t devices < <(adb devices | tr -d '\r' | awk 'NR > 1 && NF {print $1 " " $2}')
[ "${#devices[@]}" -eq 1 ] && [[ "${devices[0]}" =~ ^emulator-[0-9]+\ device$ ]]
export ANDROID_SERIAL="${devices[0]%% *}"
[ "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1 ]
adb root
adb wait-for-device
[ "$(adb shell id -u | tr -d '\r')" = 0 ]
# The app has no account or session. Install first, then firewall its UID
# before launch. Only IPv4 GitHub release endpoints on port 443 may be reached;
# all other IPv4 and IPv6 connections (including production APIs) are rejected.
adb install "$RUNNER_TEMP/old.apk" >/dev/null
pkg=io.github.dawartariq.printly.owner
uid=$(adb shell stat -c %u /data/user/0/$pkg | tr -d '\r')
[[ "$uid" =~ ^[0-9]+$ ]]
# Resolve only the known GitHub endpoints from CI. Never allow arbitrary
# hosts or addresses supplied by the APK. Reject on DNS or firewall failure.
ips="$RUNNER_TEMP/github-ips"
python3 - "$ips" <<'PYDNS'
import ipaddress, re, socket, subprocess, sys
hosts = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']
ips = set()
for host in hosts:
    records = socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)
    if not records: raise RuntimeError('release endpoint DNS lookup failed')
    ips.update(str(ipaddress.IPv4Address(r[4][0])) for r in records)
    # Android's resolver can select a different CDN IP from the CI host. Query
    # only the fixed allowlisted hostnames from the disposable emulator too;
    # ICMP itself need not succeed, but its resolved address must be present.
    probe = subprocess.run(['adb', 'shell', 'ping', '-4', '-c', '1', '-W', '2', host], capture_output=True, text=True, timeout=10)
    match = re.search(r'PING\s+\S+\s+\((\d+\.\d+\.\d+\.\d+)\)', probe.stdout)
    if not match: raise RuntimeError('emulator release endpoint DNS lookup failed')
    ips.add(str(ipaddress.IPv4Address(match.group(1))))
open(sys.argv[1], 'w').write('\n'.join(sorted(ips)) + '\n')
PYDNS
adb shell iptables -N PRINTLY_UPDATER_TEST
while IFS= read -r ip || [ -n "$ip" ]; do
  [ -n "$ip" ] || continue
  adb shell iptables -A PRINTLY_UPDATER_TEST -p tcp -d "$ip" --dport 443 -j RETURN </dev/null
done < "$ips"
adb shell iptables -A PRINTLY_UPDATER_TEST -j REJECT
adb shell iptables -I OUTPUT 1 -m owner --uid-owner "$uid" -j PRINTLY_UPDATER_TEST
adb shell ip6tables -I OUTPUT 1 -m owner --uid-owner "$uid" -j REJECT
adb shell iptables -C OUTPUT -m owner --uid-owner "$uid" -j PRINTLY_UPDATER_TEST
adb shell ip6tables -C OUTPUT -m owner --uid-owner "$uid" -j REJECT
python3 - "$RUNNER_TEMP/policy.xml" <<'PY'
import html, json, sys
policy = dict(available=True, versionCode=11, versionName='2.1.5', minimumVersionCode=1,
 packageName='io.github.dawartariq.printly.owner',
 downloadUrl='https://github.com/dawar-tariq/Printly-/releases/download/native-v2.1.5/Printly-for-Shops-2.1.5.apk',
 sha256='4de7995d8a6d090c2a752dba3e64467499fb3ee35d01c14fec597bd89da1022d',
 notes='', mandatory=True, releasedAt='2026-01-01T00:00:00Z')
open(sys.argv[1], 'w').write('<?xml version="1.0" encoding="utf-8" standalone="yes" ?><map><string name="policy">'+html.escape(json.dumps(policy), quote=False)+'</string></map>')
PY
adb shell mkdir -p /data/user/0/$pkg/shared_prefs
adb push "$RUNNER_TEMP/policy.xml" /data/user/0/$pkg/shared_prefs/native_update_policy_v1.xml >/dev/null
adb shell chown -R "$uid:$uid" /data/user/0/$pkg/shared_prefs
adb shell restorecon -RF /data/user/0/$pkg/shared_prefs
adb shell am start -n "$pkg/io.github.dawartariq.printly.owner.nativeapp.MainActivity" >/dev/null
# UI files stay local to the disposable runner. Only generic result text is printed.
ui="$RUNNER_TEMP/window.xml"
find_and_tap() {
  local text="$1" bounds
  adb shell uiautomator dump /sdcard/window.xml >/dev/null
  adb pull /sdcard/window.xml "$ui" >/dev/null 2>&1
  bounds=$(python3 - "$ui" "$text" <<'PY'
import sys, xml.etree.ElementTree as ET, re
for node in ET.parse(sys.argv[1]).iter('node'):
    if node.attrib.get('text') == sys.argv[2]:
        b = list(map(int, re.findall(r'\d+', node.attrib['bounds'])))
        print((b[0]+b[2])//2, (b[1]+b[3])//2)
        break
PY
)
  [ -n "$bounds" ] || { echo "::error::Expected UI control not found: $text"; return 1; }
  adb shell input tap $bounds
}
sleep 12
find_and_tap 'Download verified update'
sleep 2
find_and_tap 'Download'
sleep 60
adb shell uiautomator dump /sdcard/window.xml >/dev/null
adb pull /sdcard/window.xml "$ui" >/dev/null 2>&1
# Counts only: no URLs, credentials or response data are printed.
adb shell iptables -L PRINTLY_UPDATER_TEST -nvx | tr '\n' ' ' | sed 's/^/::notice title=IPv4 firewall counters::/'
adb shell ip6tables -L OUTPUT -nvx | grep "owner UID match $uid" | tr '\n' ' ' | sed 's/^/::notice title=IPv6 firewall counters::/' || true
python3 - "$ui" <<'PY'
import sys, xml.etree.ElementTree as ET
texts = [n.attrib.get('text','') for n in ET.parse(sys.argv[1]).iter('node')]
api = int(__import__('subprocess').check_output(['adb', 'shell', 'getprop', 'ro.build.version.sdk']).strip())
expected = 'identity rejection' if api == 29 and __import__('os').environ['OLD_VERSION'] == '2.1.2' else 'success'
for category, marker in [('success','Continue to Android installer'), ('generic download exception','Could not download the update securely. Please try again.'), ('identity rejection','The downloaded app’s package, version or signing certificate does not match this installation. Do not install it.'), ('hash rejection','The downloaded file did not match the expected SHA-256. Do not install it.')]:
    if any(marker in t for t in texts):
        print(('::notice::' if category == expected else '::error::') + 'Signed updater outcome: ' + category + '; expected historical behavior: ' + expected)
        sys.exit(0 if category == expected else 1)
print('::error::Signed updater outcome: unexpected or unfinished state')
sys.exit(1)
PY
