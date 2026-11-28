"""Guard the shared QA/release notification branding resources."""
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
APP = Path(__file__).resolve().parent / 'app/src'
ANDROID = '{http://schemas.android.com/apk/res/android}'
SVG = '{http://www.w3.org/2000/svg}'


class NotificationBrandingTest(unittest.TestCase):
    def test_small_icon_is_the_printly_mark_with_transparent_background(self):
        source = ET.parse(ROOT / 'public/brand/printly-logo.svg').getroot().find(f'{SVG}path')
        icon = ET.parse(APP / 'push/res/drawable/ic_push_printly.xml').getroot()
        paths = icon.findall('.//path')
        self.assertEqual(len(paths), 1)
        self.assertEqual(paths[0].get(ANDROID + 'pathData'), source.get('d'))
        self.assertEqual(paths[0].get(ANDROID + 'fillColor'), '#FFFFFFFF')
        self.assertEqual(paths[0].get(ANDROID + 'fillType'), 'evenOdd')

    def test_shared_notification_builder_uses_brand_icons(self):
        source = (APP / 'push/java/io/github/dawartariq/printly/owner/nativeapp/NativePush.kt').read_text()
        self.assertIn('setSmallIcon(R.drawable.ic_push_printly)', source)
        self.assertIn('setLargeIcon(BitmapFactory.decodeResource(context.resources, R.drawable.owner_icon))', source)
        self.assertTrue((APP / 'main/res/drawable-nodpi/owner_icon.png').is_file())


if __name__ == '__main__':
    unittest.main()
