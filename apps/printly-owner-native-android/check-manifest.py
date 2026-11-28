#!/usr/bin/env python3
"""Verify the compiled native APK launcher, package and basic privacy flags."""
import sys
import xml.etree.ElementTree as ET

ANDROID = '{http://schemas.android.com/apk/res/android}'
if len(sys.argv) != 3:
    raise SystemExit('Usage: check-manifest.py MANIFEST_XML EXPECTED_PACKAGE')
root = ET.parse(sys.argv[1]).getroot()
production_package = 'io.github.dawartariq.printly.owner'
qa_package = 'io.github.dawartariq.printly.owner.native.qa'
demo_package = 'io.github.dawartariq.printly.owner.native.debug'
if sys.argv[2] not in (production_package, qa_package, demo_package) or root.tag != 'manifest' or root.get('package') != sys.argv[2]:
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
push_enabled = sys.argv[2] in (production_package, qa_package)
if push_enabled:
    if 'android.permission.POST_NOTIFICATIONS' not in permissions or len(services) != 1 or services[0].get(ANDROID + 'exported') != 'false':
        raise SystemExit('Push-enabled variants need notification permission and one internal messaging service.')
    if 'android.permission.REQUEST_INSTALL_PACKAGES' not in permissions:
        raise SystemExit('Push-enabled variants need the user-initiated update installation permission.')
    if 'android.permission.ACCESS_NETWORK_STATE' not in permissions:
        raise SystemExit('Push-enabled variants need network-state access for constrained work and offline checks.')
    if metadata.get('firebase_messaging_auto_init_enabled') != 'false' or metadata.get('firebase_messaging_installation_id_enabled') != 'true':
        raise SystemExit('Firebase auto-init must default off and FID registration must be enabled.')
    if not any(p.get(ANDROID + 'name') == 'com.google.firebase.provider.FirebaseInitProvider' and p.get(ANDROID + 'exported') == 'false' for p in app.findall('provider')):
        raise SystemExit('Firebase must have its internal initializer.')
    receiver = [r for r in app.findall('receiver') if r.get(ANDROID + 'name') == 'com.google.firebase.iid.FirebaseInstanceIdReceiver']
    if len(receiver) != 1 or receiver[0].get(ANDROID + 'exported') != 'true' or receiver[0].get(ANDROID + 'permission') != 'com.google.android.c2dm.permission.SEND':
        raise SystemExit('The Firebase receiver must be protected by the Google sender permission.')
    if services[0].get(ANDROID + 'name') != 'io.github.dawartariq.printly.owner.nativeapp.NativeMessagingService':
        raise SystemExit('Unexpected native messaging service class.')
    def event_filters(service):
        return [f for f in service.findall('intent-filter') if any(
            a.get(ANDROID + 'name') == 'com.google.firebase.MESSAGING_EVENT' for a in f.findall('action'))]
    def priority(intent_filter):
        try:
            value = int(intent_filter.get(ANDROID + 'priority', '0'), 0)
            return value - 2**32 if value >= 2**31 else value
        except ValueError:
            raise SystemExit('Unable to verify messaging service priority.')
    own_filters = event_filters(services[0])
    if len(own_filters) != 1:
        raise SystemExit('Expected one FCM messaging event handler.')
    own_priority = priority(own_filters[0])
    # Firebase includes its own fallback service at priority -500. An equal or
    # higher-priority competitor could consume callbacks instead of our handler.
    for service in app.findall('service'):
        if service is services[0]:
            continue
        if any(priority(f) >= own_priority for f in event_filters(service)):
            raise SystemExit('Another messaging service can outrank the native handler.')
else:
    components = app.findall('provider') + app.findall('service') + app.findall('receiver')
    if services or 'android.permission.POST_NOTIFICATIONS' in permissions or 'android.permission.REQUEST_INSTALL_PACKAGES' in permissions or any('firebase' in c.get(ANDROID + 'name', '').lower() for c in components):
        raise SystemExit('The synthetic demo must not include Firebase, push or update-install permissions.')
print('Native launcher, privacy flags, file provider and variant-specific push manifest verified.')
