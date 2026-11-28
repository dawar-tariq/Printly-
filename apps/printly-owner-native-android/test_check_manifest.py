#!/usr/bin/env python3
"""Exercise the manifest guard with synthetic XML; not an APK/Android test."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CHECK = Path(__file__).with_name('check-manifest.py')
PRODUCTION = 'io.github.dawartariq.printly.owner'
QA = 'io.github.dawartariq.printly.owner.native.qa'
DEMO = 'io.github.dawartariq.printly.owner.native.debug'


def manifest(package, *, receiver_permission='com.google.android.c2dm.permission.SEND', fallback_priority='-500', extra_service='', auto_init='false', own_exported='false', push=True, install=True, network_state=True):
    permission = '<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>' if push else ''
    if push and network_state:
        permission += '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>'
    if push and install:
        permission += '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>'
    messaging = f'''
      <provider android:name="com.google.firebase.provider.FirebaseInitProvider" android:exported="false"/>
      <receiver android:name="com.google.firebase.iid.FirebaseInstanceIdReceiver" android:exported="true" android:permission="{receiver_permission}"/>
      <meta-data android:name="firebase_messaging_auto_init_enabled" android:value="{auto_init}"/>
      <meta-data android:name="firebase_messaging_installation_id_enabled" android:value="true"/>
      <service android:name="io.github.dawartariq.printly.owner.nativeapp.NativeMessagingService" android:exported="{own_exported}">
        <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT"/></intent-filter>
      </service>
      <service android:name="com.google.firebase.messaging.FirebaseMessagingService" android:exported="false">
        <intent-filter android:priority="{fallback_priority}"><action android:name="com.google.firebase.MESSAGING_EVENT"/></intent-filter>
      </service>{extra_service}''' if push else ''
    return f'''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{package}">
      {permission}
      <application android:allowBackup="false" android:usesCleartextTraffic="false">
        <activity android:name="io.github.dawartariq.printly.owner.nativeapp.MainActivity" android:exported="true">
          <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>
        </activity>
        <provider android:name="androidx.core.content.FileProvider" android:exported="false"/>
        {messaging}
      </application></manifest>'''


class ManifestGuardTest(unittest.TestCase):
    def check_xml(self, content, package, expected):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'manifest.xml'
            path.write_text(content, encoding='utf-8')
            result = subprocess.run([sys.executable, str(CHECK), str(path), package], capture_output=True, text=True)
            self.assertEqual(result.returncode == 0, expected, result.stdout + result.stderr)

    def test_push_variants_accept_the_protected_receiver_and_lower_priority_fallback(self):
        for package in (PRODUCTION, QA):
            with self.subTest(package=package):
                self.check_xml(manifest(package), package, True)
                self.check_xml(manifest(package, fallback_priority='0xfffffe0c'), package, True)

    def test_push_variants_reject_missing_or_unsafe_messaging_components(self):
        rival = '''<service android:name="example.Rival" android:exported="false"><intent-filter android:priority="1"><action android:name="com.google.firebase.MESSAGING_EVENT"/></intent-filter></service>'''
        for package in (PRODUCTION, QA):
            with self.subTest(package=package):
                self.check_xml(manifest(package, push=False), package, False)
                self.check_xml(manifest(package, receiver_permission=''), package, False)
                self.check_xml(manifest(package, fallback_priority='0'), package, False)
                self.check_xml(manifest(package, extra_service=rival), package, False)
                self.check_xml(manifest(package, auto_init='true'), package, False)
                self.check_xml(manifest(package, own_exported='true'), package, False)
                self.check_xml(manifest(package, install=False), package, False)
                self.check_xml(manifest(package, network_state=False), package, False)

    def test_demo_has_no_firebase_or_notification_permission(self):
        self.check_xml(manifest(DEMO, push=False), DEMO, True)
        self.check_xml(manifest(DEMO, push=True), DEMO, False)

    def test_unknown_package_is_not_accepted_as_a_demo(self):
        package = 'io.github.dawartariq.printly.owner.native.unexpected'
        self.check_xml(manifest(package, push=False), package, False)


if __name__ == '__main__':
    unittest.main()
