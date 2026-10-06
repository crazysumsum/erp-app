"""Run supporting provider tests without claiming their case IDs as Sales coverage."""
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET


def normalized_tests(raw):
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('DTD/entity declarations are not accepted')
    tests = []
    for node in ET.fromstring(raw).iter('testcase'):
        children = {child.tag for child in node}
        status = ('FAIL' if children & {'failure', 'error'} else
                  'SKIPPED' if 'skipped' in children else
                  'NOT_RUN' if node.get('status', '').lower() in ('notrun', 'disabled') else 'PASS')
        tests.append({'name': (node.get('classname', '') + '.' + node.get('name', '')).strip('.'),
                      'status': status})
    return {'tests': tests}


if __name__ == '__main__':
    root = Path(os.environ['HARNESS_RUN_DIR'])
    raw_path = root / 'original-provider-tests.xml'
    result = subprocess.run(['node', '--test', '--test-concurrency=1', '--import',
                             './server/test-support/testEnv.js', '--test-reporter=junit',
                             f'--test-reporter-destination={raw_path}', *sys.argv[1:]], check=False)
    raw = raw_path.read_bytes()
    # The Harness captures/redacts stdout as an artifact, retaining the original report.
    sys.stdout.buffer.write(raw)
    Path(os.environ['HARNESS_RESULT_PATH']).write_text(json.dumps(normalized_tests(raw)) + '\n')
    sys.exit(result.returncode)
