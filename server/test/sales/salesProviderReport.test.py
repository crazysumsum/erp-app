import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('salesProviderReport',
    Path(__file__).resolve().parents[2] / 'test-support/salesProviderReport.py')
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class SupportingReportTest(unittest.TestCase):
    def test_preserves_names_and_all_statuses_without_claiming_sales_ids(self):
        raw = b'''<testsuites><testsuite>
        <testcase classname="provider" name="TC-018 and TC-027 lookup"/>
        <testcase name="failure"><failure/></testcase>
        <testcase name="error"><error/></testcase>
        <testcase name="skip"><skipped/></testcase>
        <testcase name="pending" status="notrun"/>
        </testsuite></testsuites>'''
        tests = report.normalized_tests(raw)['tests']
        self.assertEqual([t['status'] for t in tests], ['PASS', 'FAIL', 'FAIL', 'SKIPPED', 'NOT_RUN'])
        self.assertEqual(tests[0]['name'], 'provider.TC-018 and TC-027 lookup')
        self.assertTrue(all(set(t) == {'name', 'status'} for t in tests))
        with self.assertRaises(ValueError):
            report.normalized_tests(b'<!DOCTYPE test><test/>')


if __name__ == '__main__':
    unittest.main()
