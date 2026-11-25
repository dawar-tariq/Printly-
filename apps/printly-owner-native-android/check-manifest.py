#!/usr/bin/env python3
"""Verify the compiled native APK launcher, package and basic privacy flags."""
import sys
import xml.etree.ElementTree as ET

ANDROID = '{http://schemas.android.com/apk/res/android}'
if len(sys.argv) != 3:
    raise SystemExit('Usage: check-manifest.py MANIFEST_XML EXPECTED_PACKAGE')
root = ET.parse(sys.argv[1]).getroot()
if root.tag != 'manifest' or root.get('package') != sys.argv[2]:
    raise SystemExit('Unexpected Android package.')
app = root.find('application')
if app is None or app.get(ANDROID + 'allowBackup') != 'false' or app.get(ANDROID + 'usesCleartextTraffic') != 'false':
    raise SystemExit('Backup and cleartext must be disabled.')
activities = app.findall('activity')
launcher = [a for a in activities if a.get(ANDROID + 'name', '').endswith('.MainActivity')]
if len(launcher) != 1 or launcher[0].get(ANDROID + 'exported') != 'true':
    raise SystemExit('Native MainActivity must be the exported launcher.')
filters = launcher[0].findall('intent-filter')
if not any(any(x.get(ANDROID + 'name') == 'android.intent.action.MAIN' for x in f.findall('action')) and
           any(x.get(ANDROID + 'name') == 'android.intent.category.LAUNCHER' for x in f.findall('category')) for f in filters):
    raise SystemExit('Missing MAIN/LAUNCHER filter.')
if any('androidbrowserhelper' in a.get(ANDROID + 'name', '').lower() for a in activities):
    raise SystemExit('Browser-helper activity found in native APK.')
provider = [p for p in app.findall('provider') if p.get(ANDROID + 'name') == 'androidx.core.content.FileProvider']
if len(provider) != 1 or provider[0].get(ANDROID + 'exported') != 'false':
    raise SystemExit('The file provider must be internal.')
print('Native launcher, package, privacy flags and internal file provider verified.')
