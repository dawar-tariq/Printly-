#!/usr/bin/env python3
"""Fail closed if a required emulator testcase is absent, failed or skipped."""
import glob
import sys
import xml.etree.ElementTree as ET

if len(sys.argv) != 3:
    raise SystemExit('Usage: ci-verify-instrumented-case.py CLASS TEST')
expected_class, expected_name = sys.argv[1:]
found = 0
for path in sorted(glob.glob('app/build/outputs/androidTest-results/connected/**/TEST-*.xml', recursive=True)):
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError) as error:
        raise SystemExit(f'Could not inspect instrumented test result {path}: {error}')
    for case in root.iter('testcase'):
        if case.get('classname') != expected_class or case.get('name') != expected_name:
            continue
        found += 1
        # Inspect every matching result; a duplicate pass must not hide a
        # failed or skipped execution from another connected device or report.
        if any(case.find(tag) is not None for tag in ('failure', 'error', 'skipped')):
            raise SystemExit(f'{expected_class}.{expected_name} did not pass')
if not found:
    raise SystemExit(f'Missing instrumented test result: {expected_class}.{expected_name}')
print(f'Verified instrumented test: {expected_class}.{expected_name}')
