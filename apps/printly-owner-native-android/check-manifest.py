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
services = [s for s in app.findall('service') if s.get(ANDROID + 'name', '').endswith('.NativeMessagingService')]
permissions = {p.get(ANDROID + 'name') for p in root.findall('uses-permission')}
metadata = {m.get(ANDROID + 'name'): m.get(ANDROID + 'value') for m in app.findall('meta-data')}
production = sys.argv[2] == 'io.github.dawartariq.printly.owner'
if production:
    if 'android.permission.POST_NOTIFICATIONS' not in permissions or len(services) != 1 or services[0].get(ANDROID + 'exported') != 'false':
        raise SystemExit('Production notifications need permission and one internal messaging service.')
    if metadata.get('firebase_messaging_auto_init_enabled') != 'false' or metadata.get('firebase_messaging_installation_id_enabled') != 'true':
        raise SystemExit('Firebase auto-init must default off and FID registration must be enabled.')
    if not any(p.get(ANDROID + 'name') == 'com.google.firebase.provider.FirebaseInitProvider' and p.get(ANDROID + 'exported') == 'false' for p in app.findall('provider')):
        raise SystemExit('Production Firebase must have its internal initializer.')
    if not any(a.get(ANDROID + 'name') == 'com.google.firebase.MESSAGING_EVENT' for f in services[0].findall('intent-filter') for a in f.findall('action')):
        raise SystemExit('Missing FCM messaging event handler.')
else:
    if services or 'android.permission.POST_NOTIFICATIONS' in permissions or any('firebase' in p.get(ANDROID + 'name', '').lower() for p in app.findall('provider')):
        raise SystemExit('Demo and isolated QA must not include production Firebase or push permissions.')
print('Native launcher, privacy flags, file provider and variant-specific push manifest verified.')
