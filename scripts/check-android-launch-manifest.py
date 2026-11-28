#!/usr/bin/env python3
"""Check the owner launcher's required components in source or compiled XML.

Android Browser Helper 2.7.4 enables or disables ManageDataLauncherActivity
when launching on Android 7.1+. The component must be declared even when the
app does not expose a Manage Space entry. Run this against the APK's merged
manifest as well as the source manifest; a source-only check is insufficient.
"""
import sys
import xml.etree.ElementTree as ET

ANDROID = "{http://schemas.android.com/apk/res/android}"
LAUNCHER = "com.google.androidbrowserhelper.trusted.LauncherActivity"
MANAGE_DATA = "com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity"
MANAGE_URL = "android.support.customtabs.trusted.MANAGE_SPACE_URL"


def check(path: str, package: str | None = None) -> None:
    root = ET.parse(path).getroot()
    if root.tag != "manifest":
        raise ValueError("Not an Android manifest.")
    if package is not None and root.get("package") != package:
        raise ValueError("The compiled manifest has an unexpected package.")
    app = root.find("application")
    if app is None:
        raise ValueError("The manifest has no application.")
    activities = app.findall("activity")

    def activity(name: str) -> ET.Element:
        matches = [item for item in activities if item.get(ANDROID + "name") == name]
        if len(matches) != 1:
            raise ValueError(f"The required {name.rsplit('.', 1)[-1]} activity must be declared exactly once.")
        return matches[0]

    launcher = activity(LAUNCHER)
    if launcher.get(ANDROID + "exported") != "true":
        raise ValueError("The launcher must be exported so the phone can open it.")
    has_launcher_filter = any(
        any(action.get(ANDROID + "name") == "android.intent.action.MAIN" for action in item.findall("action"))
        and any(category.get(ANDROID + "name") == "android.intent.category.LAUNCHER" for category in item.findall("category"))
        for item in launcher.findall("intent-filter")
    )
    if not has_launcher_filter:
        raise ValueError("The launcher must have a MAIN/LAUNCHER intent filter.")

    manage = activity(MANAGE_DATA)
    if manage.get(ANDROID + "exported") != "false":
        raise ValueError("The browser-helper manage-data activity must remain internal.")
    metadata = [item for item in manage.findall("meta-data") if item.get(ANDROID + "name") == MANAGE_URL]
    if len(metadata) != 1 or not metadata[0].get(ANDROID + "value"):
        raise ValueError("The browser-helper manage-data activity needs its site URL metadata.")
    for intent_filter in manage.findall("intent-filter"):
        if any(category.get(ANDROID + "name") == "android.intent.category.LAUNCHER" for category in intent_filter.findall("category")):
            raise ValueError("The browser-helper manage-data activity must not be another launcher.")


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print("Usage: check-android-launch-manifest.py MANIFEST_XML [EXPECTED_PACKAGE]", file=sys.stderr)
        return 1
    try:
        check(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
    except (OSError, ET.ParseError, ValueError) as exc:
        print(f"Android launch manifest check failed: {exc}", file=sys.stderr)
        return 1
    print("Android launcher and internal browser-helper component are present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
