#!/usr/bin/env python3
"""GB-U01..80: synthetic verifier-unit models, never Inventory execution proof.

Only the installed Harness boundary is substituted. Its returned issues model
already-discovered failures; these tests require the adapter to retain them and
call that boundary with the original Context, raw record and suite objects.
"""
from __future__ import annotations

import sys
sys.dont_write_bytecode = True
import argparse
import contextlib
import io
import tempfile
from unittest import mock
import copy
import importlib
import hashlib
import json
from pathlib import Path
import sys
sys.dont_write_bytecode = True
from types import SimpleNamespace
import unittest


MODULE = 'inventory-management'
SUITE = 'synthetic-original-suite'
TOOLS = (
    'server/scripts/inventoryPhase005Gate.py',
    'server/scripts/inventoryPhase005Gate.test.py',
    'server/test-support/inventoryPhase005GateNative.mjs.txt',
)


def issue(code, path=None):
    return {'code': code, 'path': path or 'evidence/synthetic-run',
            'message': 'Synthetic verifier boundary: ' + code}


def entry(digit='a', mode='100644', symlink=None):
    return {'sha256': digit * 64, 'mode': mode, 'symlink': symlink}


def synthetic_contract_hash(suite):
    # Installed Harness contract_hash -> digest -> canonical_bytes, preserved
    # here so standard-library CI fixtures do not require the local Harness.
    canonical = json.dumps(suite, ensure_ascii=False, sort_keys=True,
                           separators=(',', ':'), allow_nan=False).encode('utf-8')
    return hashlib.sha256(canonical).hexdigest()


class SyntheticCoreBoundary:
    """No test execution is simulated; only the original gate's issue boundary."""

    def __init__(self, issues=()):
        self.issues = copy.deepcopy(list(issues))
        self.calls = []

    def evidence_issues(self, ctx, raw, suite, stage):
        self.calls.append((ctx, raw, suite, stage))
        return copy.deepcopy(self.issues)


class GateBindingTests(unittest.TestCase):
    def setUp(self):
        # Import per test so an absent implementation is an honest unittest ERROR.
        self.gate = importlib.import_module('inventoryPhase005Gate')
        self.suite = {'id': SUITE, 'kind': 'UNIT', 'argv': ['python', 'synthetic.py'],
                      'cwd': '.', 'timeout_seconds': 300, 'min_tests': 1,
                      'max_skipped': 0, 'required_case_ids': [],
                      'stages': ['DEVELOPER'], 'result_adapter': 'HARNESS_JSON',
                      'result_path': 'synthetic.json', 'tool_probes': [],
                      'side_effects': ['FILES'], 'env_keys': []}
        self.ctx = SimpleNamespace(module_id=MODULE, phase='PHASE-005',
            gate='MERGE_READY', state={'runtime': {'instance_id': 'synthetic-current'}},
            profile={'environment': {'id': 'synthetic-env', 'data_reference': 'synthetic-data'}})
        self.raw = {'run_id': 'synthetic-run', 'module_id': MODULE, 'suite_id': SUITE,
            'stage': 'DEVELOPER', 'result': 'PASS', 'exit_code': 0, 'timed_out': False,
            'started_at': '2020-01-01T00:00:00Z', 'ended_at': '2020-01-01T00:01:00Z',
            'runtime_instance_id': 'synthetic-current', 'source_fingerprint': 'a' * 64,
            'spec_baseline': 'b' * 64, 'code_unchanged': True, 'spec_unchanged': True,
            'counts': {'total': 1, 'passed': 1, 'failed': 0, 'skipped': 0, 'not_run': 0},
            'cases': [], 'command': ['python', 'synthetic.py'], 'cwd': '.',
            'environment_id': 'synthetic-env', 'data_reference': 'synthetic-data'}
        self.raw['command_contract_sha256'] = synthetic_contract_hash(self.suite)
        self.expected = {'owner': 'synthetic-owner', 'workspace': '/synthetic/workspace',
                'node_sha256': 'c' * 64, 'mysql_sha256': 'd' * 64,
                'config_sha256': 'e' * 64, 'data_reference': 'synthetic-data',
                'root': '/synthetic/private-root', 'schema': 'synthetic_schema',
                'socket': '/synthetic/private-root/mysql.sock',
                'datadir': '/synthetic/private-root/data/', 'pid': 1234,
                'incarnation': 'synthetic-incarnation'}
        self.resource_expected = {key: self.expected[key] for key in ('schema', 'socket', 'datadir')}
        self.resource_snapshot = {
            'mysql': {'version': '26.7.0', 'isolated': 1,
                      'socket': self.resource_expected['socket'],
                      'datadir': self.resource_expected['datadir']},
            'schema': self.resource_expected['schema'],
            **{key: [] for key in ('connections', 'transactions', 'locks',
                                  'threads', 'statements', 'waits')}}
        self.before = {'server/src/synthetic.js': entry(), '.github/workflows/ci.yml': entry('b')}
        self.current = copy.deepcopy(self.before)
        self.excluded = {'before': {'synthetic-excluded-fixture.txt': entry('c')},
            'after': {'synthetic-excluded-fixture.txt': entry('c')},
            'dependency_complete': True, 'approved': True, 'original_suite': True,
            'ci_before_sha256': 'b' * 64, 'ci_patch_verified': True}
        self.suite_map = {SUITE: copy.deepcopy(self.suite)}
        self.receipt = self.normal_receipt()
        self.proof = self.exact_proof()
        self.classification = self.gate.classify_attempt(self.raw, self.suite, self.proof)

    def normal_receipt(self):
        binding = copy.deepcopy(self.expected)
        receipt = {'approved': True, 'binding': binding, 'recovery': None,
            'runtime_instance_id': self.raw['runtime_instance_id'],
            'resource_proof': {key: True for key in ('worker_terminal', 'sql_terminal',
                'transaction_terminal', 'lock_terminal', 'socket_terminal',
                'schema_dropped', 'daemon_exit_zero', 'root_removed')},
            'observation': {'kind': 'FROZEN_CANDIDATE_FULL_NATIVE_RUNTIME',
                'repo': binding['workspace'], 'root': binding['root'],
                'schema': binding['schema'], 'suiteId': SUITE,
                'selectedSuite': copy.deepcopy(self.suite),
                'sourceFreeze': 'MATCHED', 'hashesBefore': {'synthetic.js': 'a' * 64,
                    'executedNode': binding['node_sha256'], 'executedMySQL': binding['mysql_sha256']},
                'hashesAfter': {'synthetic.js': 'a' * 64,
                    'executedNode': binding['node_sha256'], 'executedMySQL': binding['mysql_sha256']}, 'cleanupErrors': [],
                'cleanup': 'OWN_SCHEMA_DROPPED_NORMAL_DAEMON_EXIT0_EXACT_ROOT_REMOVED',
                'mysql': {'version': '26.7.0', 'isolated': 1,
                    'socket': binding['socket'], 'datadir': binding['datadir']},
                'postTestSql': {'connections': 0, 'transactions': 0, 'locks': 0},
                'processes': [{'label': 'daemon', 'pid': binding['pid'], 'settled': True,
                    'groupTerminal': True, 'result': {'code': 0, 'signal': None}}],
                'nativeOwnership': {'ownedStops': [{'pid': 1235,
                    'incarnation': 'synthetic-worker', 'terminal': True, 'connections': [11, 12],
                    'exit': {'code': 0, 'signal': None}}]},
                'terminal': {'sqlTerminal': True, 'dropped': True, 'normalShutdown': True,
                    'observerSocketClosed': True, 'observerSocketDestroyed': True}}}
        observation = receipt['observation']
        observation.update(mysqlBinaryHash=binding['mysql_sha256'],
            runnerExit={'code': 0, 'signal': None},
            runnerResponse={'status': 'RECORDED', 'run_result': 'PASS',
                'evidence_file': 'evidence/' + self.raw['run_id'] + '/run.json', 'issues': []},
            expandedArgv=copy.deepcopy(self.raw['command']),
            deadlinesMs={'initialize': 30000, 'startup': 10000,
                'test': self.suite['timeout_seconds'] * 1000, 'end': 10000,
                'term': 5000, 'kill': 5000})
        observation['commands'] = [{'label': 'harness-runner', 'executable': 'python',
            'args': ['/synthetic/harness/run_check.py', 'docs/inventory_management',
                '--repo-root', binding['workspace'], '--suite', self.raw['suite_id'],
                '--stage', 'DEVELOPER', '--execute', '--json'], 'cwd': binding['workspace']}]
        for number, label in enumerate(('runtime-acquire', 'initialize', 'migrations',
                                       'harness-runner', 'runtime-release')):
            observation['processes'].append({'label': label, 'pid': 2000 + number,
                'settled': True, 'groupTerminal': True,
                'result': {'code': 0, 'signal': None}})
        text = json.dumps(self.raw, sort_keys=True, separators=(',', ':')) + '\n'
        digest = hashlib.sha256(text.encode()).hexdigest()
        path = 'evidence/' + self.raw['run_id'] + '/run.json'
        receipt['typed_record'] = {'path': path, 'raw': copy.deepcopy(self.raw),
                                 'original_text': text, 'sha256': digest}
        observation['typedEvidence'] = {'path': path, 'sha256': digest,
                                       'counts': copy.deepcopy(self.raw['counts'])}
        self.bind_native_report(receipt)
        return receipt

    def bind_native_report(self, receipt):
        stops = receipt['observation']['nativeOwnership']['ownedStops']
        report = {'ownedStops': copy.deepcopy(stops), 'workerCleanupErrors': [],
            'cleanup': 'CHILD_EXIT_AND_SQL_TERMINAL_CONFIRMED',
            'ownedSql': {'status': 'SQL_TERMINAL_CONFIRMED', 'workers': [
                {'incarnation': stop['incarnation'], 'status': 'SQL_TERMINAL_CONFIRMED',
                 'connections': [{'threadId': thread, 'performanceThreadId': thread + 100,
                    'incarnation': stop['incarnation'],
                    'nonce': '00000000-0000-4000-8000-%012d' % thread,
                    'provenance': 'SAME_CONNECTION_DRIVER_QUERY', 'childObservedAt': 1,
                    'observedTransactionIds': [], 'observedEngineTokens': []}
                    for thread in stop['connections']],
                 'connectionEvents': [{'threadId': thread,
                    'nonce': '00000000-0000-4000-8000-%012d' % thread}
                    for thread in stop['connections']],
                 'latest': [{'terminal': True, 'states': [], 'threads': [],
                    'threadId': thread, 'performanceThreadId': thread + 100,
                    'activeStatement': False, 'transactions': 0, 'locks': 0, 'waits': 0,
                    'observedTransactionIds': [], 'observedEngineTokens': [],
                    'retainedTransactions': 0, 'relatedWaits': 0}
                    for thread in stop['connections']],
                 'completeMs': 10}
                for stop in stops]}}
        receipt['native_report'] = {'path': 'evidence/synthetic-native-report.json', 'raw': report}
        self.seal_native_report(receipt)

    def seal_native_report(self, receipt):
        original = receipt['native_report']
        text = json.dumps(original['raw'], sort_keys=True, separators=(',', ':')) + '\n'
        digest = hashlib.sha256(text.encode()).hexdigest()
        original.update(original_text=text, sha256=digest)
        receipt['observation']['nativeOwnership'].update(reportPath=original['path'], sha256=digest)

    def exact_proof(self):
        return {'kind': 'EXACT', 'before_suite': copy.deepcopy(self.suite),
            'after_suite': copy.deepcopy(self.suite),
            'before_source_map': copy.deepcopy(self.before),
            'current_source_map': copy.deepcopy(self.current),
            'allowed_tools': {}, 'ci_expected_hash': None,
            'excluded_inputs': copy.deepcopy(self.excluded),
            'before_plan': self.raw['spec_baseline'], 'after_plan': self.raw['spec_baseline'],
            'approved_plan_pair': [self.raw['spec_baseline'], self.raw['spec_baseline']],
            'approved_plan_scope': 'INVENTORY_PHASE005_GATE_ONLY',
            'approval_ref': 'synthetic-adoption',
            'independent_review_ref': 'synthetic-independent-scope-review',
            'external_inputs': {'before': {'synthetic-data': 'a' * 64},
                'after': {'synthetic-data': 'a' * 64}, 'immutable': True},
            'original_source': self.raw['source_fingerprint'],
            'current_source': self.raw['source_fingerprint']}

    def classify(self):
        self.classification = self.gate.classify_attempt(self.raw, self.suite, self.proof)
        return self.classification

    def check_attempt(self, issues=(), runtime_issues=(), expected='APPLICABLE'):
        core = SyntheticCoreBoundary(issues)
        original = copy.deepcopy((vars(self.ctx), self.raw, self.suite))
        result = self.gate.validate_attempt(self.ctx, self.suite, self.raw,
            self.classification, list(runtime_issues), core)
        self.assertEqual(len(core.calls), 1, 'Historical runs must receive direct core validation')
        call = core.calls[0]
        self.assertIs(call[0], self.ctx)
        self.assertIs(call[1], self.raw)
        self.assertIs(call[2], self.suite)
        self.assertEqual(call[3], 'DEVELOPER')
        self.assertEqual((vars(self.ctx), self.raw, self.suite), original)
        if expected == 'NOT_APPLICABLE':
            self.assertIn(result['status'], ('NOT_APPLICABLE', 'UNKNOWN'))
        else:
            self.assertEqual(result['status'], expected)
        self.assertNotEqual(result['status'], 'PASS', 'Applicability is not a new execution')
        return result

    def assert_retained(self, *codes):
        original = [issue(code) for code in codes]
        result = self.check_attempt(original, expected='NOT_APPLICABLE')
        for item in original:
            self.assertIn(item, result['issues'])

    def runtime_issues(self, approved=None):
        return self.gate.runtime_proof_issues(self.raw, self.receipt,
            {'expected': self.expected, 'approved_recovery': approved, 'suite_map': self.suite_map})

    def source_issues(self, tools=None, ci=None):
        return self.gate.source_issues(self.before, self.current, tools or {}, ci, self.excluded)

    def test_GB_U01_exact_current_proof(self):
        original = copy.deepcopy((self.resource_snapshot, self.resource_expected))
        self.assertEqual(self.gate.resource_snapshot_issues(
            self.resource_snapshot, self.resource_expected), [])
        self.assertEqual((self.resource_snapshot, self.resource_expected), original)
        self.assertEqual(self.runtime_issues(), [])
        self.assertEqual(self.source_issues(), [])
        result = self.check_attempt()
        self.assertEqual(result['issues'], [])

    def test_GB_U02_distinct_historical_normal_runtime(self):
        self.raw['runtime_instance_id'] = 'synthetic-historical'
        self.receipt = self.normal_receipt()
        self.proof['kind'] = 'ADMIN_EQUIVALENT'
        self.classify()
        self.assertEqual(self.runtime_issues(), [])
        result = self.check_attempt([issue('EVIDENCE_RUNTIME')])
        self.assertEqual(result['issues'], [])
        self.assertEqual(self.raw['runtime_instance_id'], 'synthetic-historical')
        # Original Characterization permits a known forced worker stop once its
        # incarnation's owned SQL is positively terminal. IPC diagnostics alone
        # do not change the final terminal result or require graceful exit zero.
        stop = self.receipt['observation']['nativeOwnership']['ownedStops'][0]
        stop.update(forced=True, exit={'code': None, 'signal': 'SIGTERM'},
            errors=[{'stage': 'IPC_STOP', 'error': {'codes': ['UNCLASSIFIED_ERROR']}}])
        self.bind_native_report(self.receipt)
        self.assertEqual(self.runtime_issues(), [])
        original_receipt = copy.deepcopy(self.receipt)
        original_expected = copy.deepcopy(self.expected)
        for variant in ('position-associated-native-samples', 'runner-response-scope', 'explicit-profile-preview'):
            with self.subTest(actual_producer_format=variant):
                self.receipt = copy.deepcopy(original_receipt)
                self.expected = copy.deepcopy(original_expected)
                if variant == 'position-associated-native-samples':
                    worker = self.receipt['native_report']['raw']['ownedSql']['workers'][0]
                    for index, (connection, sample) in enumerate(zip(worker['connections'], worker['latest'])):
                        connection['observedTransactionIds'] = [str(900 + index)]
                        connection['observedEngineTokens'] = [{'engine': 'INNODB', 'token': str(800 + index),
                            'performanceThreadId': connection['performanceThreadId'], 'observedAt': 1}]
                        sample['observedTransactionIds'] = copy.deepcopy(connection['observedTransactionIds'])
                        sample['observedEngineTokens'] = copy.deepcopy(connection['observedEngineTokens'])
                        del sample['threadId']
                        del sample['performanceThreadId']
                    self.seal_native_report(self.receipt)
                elif variant == 'runner-response-scope':
                    self.receipt['observation']['runnerResponse']['scope'] = (
                        'Run evidence written. Register evidence_file with state_tool checkpoint; '
                        'no state/approval was silently changed.')
                else:
                    preview = ['python', '--report=/synthetic/private-root/unused-preview.json', 'synthetic.py']
                    self.expected['preview_argv'] = preview
                    self.receipt['observation']['expandedArgv'] = copy.deepcopy(preview)
                self.assertEqual(self.runtime_issues(), [])
        self.receipt, self.expected = original_receipt, original_expected

    def test_GB_U03_exact_disclosed_files_recovery(self):
        self.make_files_recovery()
        frozen = copy.deepcopy(self.receipt)
        self.assertEqual(self.runtime_issues(self.adoption), [])
        self.assertEqual(self.receipt, frozen)
        self.assertEqual(len(self.receipt['typed_records']), 33)
        for result in self.receipt['files_batch']['results']:
            path = result['result']['evidence_file']
            original = self.receipt['typed_records'][path]
            self.assertEqual(hashlib.sha256(original['original_text'].encode()).hexdigest(),
                             self.adoption['original_sha256'][path])
        self.assertEqual(self.receipt['observation']['cleanup'], 'UNKNOWN_OWN_ROOT_RETAINED')

    def test_GB_U04_approved_plan_preserves_original_contract(self):
        self.proof.update(kind='ADMIN_EQUIVALENT', after_plan='f' * 64,
            approved_plan_pair=['b' * 64, 'f' * 64])
        self.classify()
        result = self.check_attempt([issue('EVIDENCE_SPEC')])
        self.assertEqual(result['issues'], [])

    def test_GB_U05_only_exact_tools_and_ci_delta(self):
        allowed = {path: entry('d') for path in TOOLS}
        self.current.update(allowed)
        self.current['.github/workflows/ci.yml'] = entry('e')
        self.assertEqual(self.source_issues(allowed, 'e' * 64), [])

    def test_GB_U06_adapter_checks_accept_exact_own_source_only(self):
        self.excluded['original_suite'] = False
        self.assertEqual(self.source_issues(), [])
        self.suite['id'] = 'inventory-task041-gate-binding-unit'
        self.raw['suite_id'] = self.suite['id']
        self.proof['before_suite'] = copy.deepcopy(self.suite)
        self.proof['after_suite'] = copy.deepcopy(self.suite)
        self.proof['excluded_inputs']['original_suite'] = False
        self.classify()
        self.check_attempt()

    def test_GB_U07_unrelated_document_proof_is_applicability_only(self):
        self.proof.update(kind='ADMIN_EQUIVALENT', current_source='f' * 64,
            reviewed_unrelated={'changed_paths': ['docs/other_module/readme.md'],
                'suite_inputs': ['server/src/synthetic.js'],
                'independent_review_ref': 'synthetic-independent-input-scope-review'})
        self.proof['before_source_map']['docs/other_module/readme.md'] = entry('d')
        self.proof['current_source_map']['docs/other_module/readme.md'] = entry('e')
        self.classify()
        original = copy.deepcopy(self.raw)
        self.check_attempt([issue('EVIDENCE_SOURCE')])
        self.assertEqual(self.raw, original)

    def test_GB_U08_later_actual_pass_supersedes_earlier_failure(self):
        earlier = self.attempt('FAIL', '2020-01-01T00:00:00Z')
        later = self.attempt('PASS', '2020-01-01T00:02:00Z')
        originals = copy.deepcopy([earlier, later])
        self.assertIs(self.gate.select_latest([earlier, later]), later)
        self.assertEqual([earlier, later], originals)
        unrelated = self.attempt('FAIL', '2020-01-01T00:03:00Z')
        changed = self.exact_proof()
        changed.update(kind='NON_EQUIVALENT', current_source='f' * 64)
        changed['current_source_map']['server/src/synthetic.js'] = entry('d')
        unrelated['classification'] = self.gate.classify_attempt(unrelated['raw'], self.suite, changed)
        self.assertEqual(unrelated['classification']['kind'], 'NON_EQUIVALENT')
        self.assertIs(unrelated['classification']['verified'], True)
        self.assertIs(self.gate.select_latest([earlier, later, unrelated]), later)

    def test_GB_U09_missing_actual_run_cannot_resolve(self):
        missing = issue('REQUIRED_RUN_MISSING', 'gate/DEVELOPER/' + SUITE)
        self.assertEqual(self.gate.resolve_core_issues([missing], {}, [SUITE]), [missing])

    def test_GB_U10_wrong_module_suite_stage_retained(self):
        self.assert_retained('EVIDENCE_MODULE', 'EVIDENCE_STAGE', 'EVIDENCE_COMMAND')

    def test_GB_U11_actual_argv_cwd_contract_tool_retained(self):
        self.assert_retained('EVIDENCE_COMMAND_ACTUAL', 'EVIDENCE_COMMAND', 'TOOL_PROBE_MISMATCH', 'TOOL_VERSION')

    def test_GB_U12_validation_minima_data_deadline_skip_change(self):
        self.proof.update(kind='ADMIN_EQUIVALENT', after_plan='f' * 64,
            approved_plan_pair=['b' * 64, 'f' * 64])
        for field, value in (('timeout_seconds', 301), ('min_tests', 0),
                ('max_skipped', 1), ('required_case_ids', ['TC-999']),
                ('env_keys', ['CHANGED_DATA_INPUT']),
                ('validation', {'coverage_floor': 0, 'p95_threshold_ms': 9000})):
            with self.subTest(field=field):
                self.proof['after_suite'] = dict(self.suite, **{field: value})
                self.classify()
                self.check_attempt([issue('EVIDENCE_SPEC')], expected='NOT_APPLICABLE')
        self.assert_retained('EVIDENCE_ENVIRONMENT', 'TEST_COUNTS', 'CASE_NOT_PASSED')

    def test_GB_U13_malformed_duplicate_counts_case_metadata_retained(self):
        self.assert_retained('REPORT_VERIFICATION_BLOCKED', 'DUPLICATE_CASE_RESULT',
            'REPORT_METADATA_MISMATCH', 'COUNT_INCONSISTENCY')

    def test_GB_U14_missing_tampered_artifact_and_escape_retained(self):
        self.assert_retained('REQUIRED_ARTIFACT', 'ARTIFACT_MISSING', 'ARTIFACT_TAMPERED',
            'ARTIFACT_RUN_SCOPE', 'DUPLICATE_ARTIFACT')

    def test_GB_U15_failure_timeout_skip_not_run_discovery_retained(self):
        for field, value in [('result', 'FAIL'), ('timed_out', True), ('exit_code', 1)]:
            with self.subTest(field=field):
                original = copy.deepcopy(self.raw)
                self.raw[field] = value
                self.assert_retained('EVIDENCE_NOT_PASS', 'TEST_COUNTS')
                self.raw = original

    def test_GB_U16_later_equivalent_failure_blocks_old_green(self):
        attempts = [self.attempt('PASS', '2020-01-01T00:01:00Z'),
                    self.attempt('FAIL', '2020-01-01T00:02:00Z', 'ADMIN_EQUIVALENT')]
        with self.assertRaises(self.gate.Blocked):
            self.gate.select_latest(attempts)

    def test_GB_U17_later_unknown_failure_blocks_old_green(self):
        attempts = [self.attempt('PASS', '2020-01-01T00:01:00Z'),
                    self.attempt('FAIL', '2020-01-01T00:02:00Z', 'UNKNOWN')]
        with self.assertRaises(self.gate.Blocked):
            self.gate.select_latest(attempts)

        # A caller's label is not positive proof that an unchanged attempt is unrelated.
        self.proof['kind'] = 'NON_EQUIVALENT'
        self.assertNotEqual(self.classify()['kind'], 'NON_EQUIVALENT')
        for label in ('NON_EQUIVALENT', {'kind': 'NON_EQUIVALENT', 'verified': False}):
            with self.subTest(unverified_exclusion=label):
                unverified = self.attempt('FAIL', '2020-01-01T00:03:00Z')
                unverified['classification'] = label
                with self.assertRaises(self.gate.Blocked):
                    self.gate.select_latest([self.attempt('PASS', '2020-01-01T00:01:00Z'), unverified])
        with self.subTest(ambiguous_tied_attempts=True):
            tied = [self.attempt('FAIL', '2020-01-01T00:02:00Z'),
                    self.attempt('PASS', '2020-01-01T00:02:00Z')]
            with self.assertRaises(self.gate.Blocked):
                self.gate.select_latest(tied)

    def test_GB_U18_missing_maps_or_excluded_fixture_pin(self):
        for field in ('before', 'after', 'dependency_complete'):
            with self.subTest(field=field):
                excluded = copy.deepcopy(self.excluded)
                self.excluded.pop(field)
                self.assertTrue(self.source_issues())
                self.excluded = excluded
        self.assertTrue(self.gate.source_issues({}, self.current, {}, None, self.excluded))
        self.proof.pop('before_suite')
        self.assertEqual(self.classify()['kind'], 'UNKNOWN')
        self.classification = {'kind': 'ADMIN_EQUIVALENT'}
        self.check_attempt([issue('EVIDENCE_SPEC')], expected='NOT_APPLICABLE')

    def test_GB_U19_arbitrary_hash_mode_symlink_dependency_change(self):
        historical = self.gate.historical_excluded_inputs(
            self.excluded['before'], {'before_sha256': 'e' * 64})
        errors = self.gate.source_issues(self.before, self.before, {}, None, historical)
        self.assertIn('INPUT_CLOSURE_UNKNOWN', [row['code'] for row in errors])
        for metadata in (entry('f'), entry(mode='100755'), entry(symlink='../outside')):
            with self.subTest(metadata=metadata):
                self.current['server/src/synthetic.js'] = metadata
                self.assertTrue(self.source_issues())
        self.current = copy.deepcopy(self.before)
        self.excluded['dependency_complete'] = False
        self.assertTrue(self.source_issues())
        self.excluded['dependency_complete'] = True
        self.current['.github/workflows/ci.yml'] = entry('f')
        self.assertTrue(self.source_issues(ci='e' * 64))

    def test_GB_U20_ci_head_human_review_are_current_only(self):
        self.assert_retained('CI_REQUIRED', 'EVIDENCE_COMMIT', 'APPROVAL_MISSING_STALE',
            'SOURCE_REVIEW_REQUIRED')

    def test_GB_U21_owner_workspace_tool_config_data_mismatch(self):
        for section, field, value in (
                (None, 'schema', 'different_schema'),
                ('mysql', 'socket', '/synthetic/another/mysql.sock'),
                ('mysql', 'datadir', '/synthetic/another/data/'),
                ('mysql', 'version', '8.4.0'), ('mysql', 'isolated', 0),
                ('mysql', 'isolated', True), ('mysql', 'isolated', 1.0),
                ('mysql', 'isolated', '1'), ('mysql', 'version', 26.7),
                (None, 'schema', True), ('mysql', 'socket', 1),
                ('mysql', 'datadir', False)):
            with self.subTest(snapshot_identity=(section, field, value)):
                snapshot = copy.deepcopy(self.resource_snapshot)
                target = snapshot[section] if section else snapshot
                target[field] = value
                self.assertTrue(self.gate.resource_snapshot_issues(snapshot, self.resource_expected))
        for key in ('schema', 'socket', 'datadir'):
            with self.subTest(missing_expected_identity=key):
                expected = copy.deepcopy(self.resource_expected)
                del expected[key]
                self.assertTrue(self.gate.resource_snapshot_issues(self.resource_snapshot, expected))
            for value in (True, 1):
                with self.subTest(matching_but_invalid_identity=(key, value)):
                    snapshot = copy.deepcopy(self.resource_snapshot)
                    expected = copy.deepcopy(self.resource_expected)
                    expected[key] = value
                    (snapshot if key == 'schema' else snapshot['mysql'])[key] = value
                    self.assertTrue(self.gate.resource_snapshot_issues(snapshot, expected))
        for field in ('owner', 'workspace', 'node_sha256', 'mysql_sha256',
                      'config_sha256', 'data_reference', 'pid', 'incarnation'):
            with self.subTest(field=field):
                original = copy.deepcopy(self.receipt)
                self.receipt['binding'][field] = 'different-synthetic-identity'
                self.assertTrue(self.runtime_issues())
                self.receipt = original
        for section, field in ((None, 'repo'), (None, 'root'), (None, 'schema'),
                               ('mysql', 'socket'), ('mysql', 'datadir')):
            with self.subTest(observation_section=section, field=field):
                original = copy.deepcopy(self.receipt)
                target = self.receipt['observation']
                if section:
                    target = target[section]
                target[field] = '/synthetic/contradicts-independent-binding'
                self.assertTrue(self.runtime_issues())
                self.receipt = original
        for location, value in (
                (('suiteId',), 'different-suite'),
                (('selectedSuite', 'id'), 'different-suite'),
                (('selectedSuite', 'argv'), ['changed-command']),
                (('typedEvidence', 'path'), 'evidence/wrong/run.json'),
                (('typedEvidence', 'sha256'), 'f' * 64),
                (('typedEvidence', 'counts', 'passed'), 999),
                (('runnerResponse', 'status'), 'UNKNOWN'),
                (('runnerResponse', 'run_result'), 'FAIL'),
                (('runnerResponse', 'issues'), [issue('ACTUAL_RUN_FAILURE')]),
                (('runnerResponse', 'evidence_file'), 'evidence/wrong/run.json'),
                (('runnerExit', 'code'), 1),
                (('expandedArgv',), ['changed-command']),
                (('mysqlBinaryHash',), 'f' * 64),
                (('deadlinesMs', 'test'), 1)):
            with self.subTest(actual_observation=location):
                original = copy.deepcopy(self.receipt)
                target = self.receipt['observation']
                for field in location[:-1]:
                    target = target[field]
                target[location[-1]] = value
                self.assertTrue(self.runtime_issues())
                self.receipt = original
        for field in ('executedNode', 'executedMySQL'):
            with self.subTest(executed_binary=field):
                original = copy.deepcopy(self.receipt)
                for freeze in ('hashesBefore', 'hashesAfter'):
                    self.receipt['observation'][freeze][field] = 'f' * 64
                self.assertTrue(self.runtime_issues())
                self.receipt = original
        for label in ('runtime-acquire', 'initialize', 'migrations', 'harness-runner', 'runtime-release'):
            with self.subTest(other_process=label):
                original = copy.deepcopy(self.receipt)
                process = next(row for row in self.receipt['observation']['processes'] if row['label'] == label)
                process['settled'] = False
                self.assertTrue(self.runtime_issues())
                self.receipt = original

        original_commands_receipt = copy.deepcopy(self.receipt)
        for mutation in ('missing-commands', 'missing-runner', 'wrong-script', 'wrong-suite', 'wrong-stage', 'wrong-cwd'):
            with self.subTest(actual_harness_runner=mutation):
                self.receipt = copy.deepcopy(original_commands_receipt)
                original = copy.deepcopy(self.receipt)
                command = self.receipt['observation']['commands'][0]
                if mutation == 'missing-commands':
                    del self.receipt['observation']['commands']
                elif mutation == 'missing-runner':
                    self.receipt['observation']['commands'] = []
                elif mutation == 'wrong-script':
                    command['args'][0] = '/synthetic/harness/not_the_runner.py'
                elif mutation == 'wrong-suite':
                    command['args'][5] = 'different-suite'
                elif mutation == 'wrong-stage':
                    command['args'][7] = 'TECHNICAL_ACCEPTANCE'
                else:
                    command['cwd'] = '/synthetic/another-workspace'
                self.assertTrue(self.runtime_issues())
                self.receipt = original
        with self.subTest(changed_explicit_preview=True):
            original = copy.deepcopy(self.receipt)
            self.expected['preview_argv'] = ['python', '/synthetic/private-root/reviewed-preview.py']
            self.receipt['observation']['expandedArgv'] = ['python', '/synthetic/private-root/changed-preview.py']
            self.assertTrue(self.runtime_issues())
            del self.expected['preview_argv']
            self.receipt = original

    def test_GB_U22_missing_or_unapproved_receipt(self):
        self.assertTrue(self.gate.runtime_proof_issues(self.raw, None,
            {'expected': self.expected, 'approved_recovery': None}))
        self.receipt['approved'] = False
        self.assertTrue(self.runtime_issues())

    def test_GB_U23_live_or_unknown_terminal_resources(self):
        for field in ('connections', 'transactions', 'locks', 'threads', 'statements', 'waits'):
            with self.subTest(live_snapshot_resource=field):
                snapshot = copy.deepcopy(self.resource_snapshot)
                snapshot[field] = [{'id': 42, 'owner': 'synthetic-owned-worker'}]
                self.assertTrue(self.gate.resource_snapshot_issues(snapshot, self.resource_expected))
            with self.subTest(missing_snapshot_resource=field):
                snapshot = copy.deepcopy(self.resource_snapshot)
                del snapshot[field]
                self.assertTrue(self.gate.resource_snapshot_issues(snapshot, self.resource_expected))
            for invalid in (None, False, 0, {}):
                with self.subTest(non_array_snapshot_resource=(field, invalid)):
                    snapshot = copy.deepcopy(self.resource_snapshot)
                    snapshot[field] = invalid
                    self.assertTrue(self.gate.resource_snapshot_issues(snapshot, self.resource_expected))
        for field in ('worker_terminal', 'sql_terminal', 'transaction_terminal',
                      'lock_terminal', 'socket_terminal'):
            for value in (False, None):
                with self.subTest(field=field, value=value):
                    self.receipt['resource_proof'][field] = value
                    self.assertTrue(self.runtime_issues())
                    self.receipt['resource_proof'][field] = True
        for field in ('connections', 'transactions', 'locks'):
            with self.subTest(actual_sql=field):
                self.receipt['observation']['postTestSql'][field] = 1
                self.assertTrue(self.runtime_issues())
                self.receipt['observation']['postTestSql'][field] = 0
        for field, value in (('settled', False), ('groupTerminal', False),
                             ('result', {'code': 1, 'signal': None}),
                             ('result', {'code': None, 'signal': 'SIGTERM'})):
            with self.subTest(actual_daemon=field, value=value):
                original = copy.deepcopy(self.receipt)
                self.receipt['observation']['processes'][0][field] = value
                self.assertTrue(self.runtime_issues())
                self.receipt = original
        for value in (False, None):
            with self.subTest(actual_worker_terminal=value):
                self.receipt['observation']['nativeOwnership']['ownedStops'][0]['terminal'] = value
                self.assertTrue(self.runtime_issues())
        self.receipt['observation']['nativeOwnership']['ownedStops'] = []
        self.assertTrue(self.runtime_issues())
        self.receipt = self.normal_receipt()
        self.receipt['observation']['nativeOwnership']['ownedStops'][0]['exit'] = None
        self.assertTrue(self.runtime_issues())
        self.receipt = self.normal_receipt()
        self.receipt['native_report']['raw']['ownedSql']['workers'][0]['status'] = 'SQL_TERMINAL_UNKNOWN'
        self.seal_native_report(self.receipt)
        self.assertTrue(self.runtime_issues())
        self.receipt = self.normal_receipt()
        self.receipt['native_report']['raw']['ownedSql']['workers'][0]['incarnation'] = 'different-worker'
        self.seal_native_report(self.receipt)
        self.assertTrue(self.runtime_issues())
        # Each altered native report is internally rehashed: these assert SQL
        # proof semantics, rather than relying on an incidental hash mismatch.
        for mutation in ('missing-sample', 'duplicate-connection', 'empty-connections',
                         'unmapped-performance-thread', 'missing-provenance',
                         'unknown-provenance', 'missing-nonce', 'foreign-incarnation',
                         'missing-active-statement', 'missing-transactions', 'missing-locks',
                         'missing-waits', 'missing-retainedTransactions', 'missing-relatedWaits',
                         'deadline-exceeded'):
            with self.subTest(native_sql_boundary=mutation):
                self.receipt = self.normal_receipt()
                native = self.receipt['native_report']['raw']
                worker = native['ownedSql']['workers'][0]
                if mutation == 'missing-sample':
                    worker['latest'].pop()
                elif mutation == 'duplicate-connection':
                    worker['connections'].append(copy.deepcopy(worker['connections'][0]))
                    worker['latest'].append(copy.deepcopy(worker['latest'][0]))
                    native['ownedStops'][0]['connections'].append(11)
                    self.receipt['observation']['nativeOwnership']['ownedStops'][0]['connections'].append(11)
                elif mutation == 'empty-connections':
                    worker['connections'] = []
                    native['ownedStops'][0]['connections'] = []
                    self.receipt['observation']['nativeOwnership']['ownedStops'][0]['connections'] = []
                elif mutation == 'unmapped-performance-thread':
                    worker['connections'][0]['performanceThreadId'] = None
                elif mutation in ('missing-provenance', 'missing-nonce'):
                    del worker['connections'][0][mutation.removeprefix('missing-')]
                elif mutation == 'unknown-provenance':
                    worker['connections'][0]['provenance'] = 'UNVERIFIED_CACHED_ID'
                elif mutation == 'foreign-incarnation':
                    worker['connections'][0]['incarnation'] = 'foreign-worker'
                elif mutation == 'deadline-exceeded':
                    worker['completeMs'] = 20001
                else:
                    field = mutation.removeprefix('missing-')
                    del worker['latest'][0]['activeStatement' if field == 'active-statement' else field]
                self.seal_native_report(self.receipt)
                self.assertTrue(self.runtime_issues())
        for mutation in ('thread-id-only', 'performance-id-only', 'wrong-thread-id', 'wrong-performance-id',
                         'positional-transaction-history', 'positional-engine-history',
                         'identified-transaction-history', 'identified-engine-history'):
            with self.subTest(actual_native_sample_protocol=mutation):
                self.receipt = self.normal_receipt()
                worker = self.receipt['native_report']['raw']['ownedSql']['workers'][0]
                if mutation.startswith(('positional-', 'identified-')):
                    if mutation.startswith('positional-'):
                        for sample in worker['latest']:
                            del sample['threadId']
                            del sample['performanceThreadId']
                    history = ('observedTransactionIds' if mutation.endswith('transaction-history')
                               else 'observedEngineTokens')
                    worker['latest'][0][history] = ['different-history']
                elif mutation == 'thread-id-only':
                    del worker['latest'][0]['performanceThreadId']
                elif mutation == 'performance-id-only':
                    del worker['latest'][0]['threadId']
                elif mutation == 'wrong-thread-id':
                    worker['latest'][0]['threadId'] = 999
                else:
                    worker['latest'][0]['performanceThreadId'] = 999
                self.seal_native_report(self.receipt)
                self.assertTrue(self.runtime_issues())
        for invalid in ('', '   ', False, True, 1):
            with self.subTest(coherent_invalid_incarnation=invalid):
                self.receipt = self.normal_receipt()
                native = self.receipt['native_report']['raw']
                native['ownedStops'][0]['incarnation'] = invalid
                self.receipt['observation']['nativeOwnership']['ownedStops'][0]['incarnation'] = invalid
                worker = native['ownedSql']['workers'][0]
                worker['incarnation'] = invalid
                for connection in worker['connections']:
                    connection['incarnation'] = invalid
                self.seal_native_report(self.receipt)
                self.assertTrue(self.runtime_issues(), 'Matching labels cannot establish a missing worker identity')

    def test_GB_U24_driver_flags_and_empty_tables_are_insufficient(self):
        self.receipt['resource_proof'] = {}
        self.receipt['observation']['terminal'] = {'observerSocketDestroyed': True}
        self.receipt['observation']['callback'] = True
        self.receipt['observation']['cancelled'] = True
        self.receipt['observation']['ownedSchemaEmpty'] = {'tableCount': 0}
        self.assertTrue(self.runtime_issues())

    def test_GB_U25_fictitious_runtime_and_relabelled_raw_rejected(self):
        self.raw['runtime_instance_id'] = 'synthetic-shared-idle-runtime'
        self.expected['root'] = '/synthetic/shared-idle-root'
        self.assertTrue(self.runtime_issues())
        self.classification['kind'] = 'EXACT'
        self.check_attempt([issue('EVIDENCE_RUNTIME')],
            runtime_issues=[issue('RUNTIME_IDENTITY')], expected='NOT_APPLICABLE')

    def test_GB_U26_files_recovery_cannot_cover_native_or_no_adoption(self):
        self.make_files_recovery()
        self.assertTrue(self.runtime_issues(None))
        complete = copy.deepcopy(self.receipt)
        original_contracts = copy.deepcopy(self.suite_map)
        for field, value in (
                ('status', 'PASS'), ('kind', 'FROZEN_CANDIDATE_FULL_NATIVE_RUNTIME'),
                ('cleanup', 'OWN_SCHEMA_DROPPED_NORMAL_DAEMON_EXIT0_EXACT_ROOT_REMOVED')):
            with self.subTest(relabelled_original_field=field):
                self.receipt = copy.deepcopy(complete)
                self.receipt['observation'][field] = value
                self.assertTrue(self.runtime_issues(self.adoption), 'Recovery must retain the exact original disposition')
        with self.subTest(relabelled_as_normal_pass=True):
            self.receipt = copy.deepcopy(complete)
            self.receipt['observation'].update(status='PASS',
                kind='FROZEN_CANDIDATE_FULL_NATIVE_RUNTIME',
                cleanup='OWN_SCHEMA_DROPPED_NORMAL_DAEMON_EXIT0_EXACT_ROOT_REMOVED', cleanupErrors=[])
            self.assertTrue(self.runtime_issues(self.adoption))
        self.receipt = copy.deepcopy(complete)
        child_id = self.receipt['files_batch']['results'][-1]['suite']
        self.assertNotEqual(child_id, self.raw['suite_id'])
        for field, value in (('argv', ['python', '--version']), ('min_tests', 0),
                             ('required_case_ids', ['TC-999']), ('timeout_seconds', 301)):
            with self.subTest(changed_nonselected_child_contract=field):
                self.suite_map = copy.deepcopy(original_contracts)
                self.suite_map[child_id][field] = value
                self.assertEqual(self.suite_map[child_id]['side_effects'], ['FILES'])
                self.assertTrue(self.runtime_issues(self.adoption), 'All 33 contracts must match their own original hash')
        self.suite_map = original_contracts
        path = self.receipt['files_batch']['results'][-1]['result']['evidence_file']
        del self.receipt['typed_records'][path]
        self.assertTrue(self.runtime_issues(self.adoption), 'A declared count cannot replace an original record')
        self.receipt = copy.deepcopy(complete)
        self.receipt['typed_records'][path]['raw']['result'] = 'FAIL'
        self.assertTrue(self.runtime_issues(self.adoption), 'Normalized metadata must agree with original bytes')
        self.receipt = copy.deepcopy(complete)
        self.receipt['typed_records'][path]['original_text'] += ' '
        self.assertTrue(self.runtime_issues(self.adoption), 'Original byte hash must match exact approved registry')
        self.receipt = copy.deepcopy(complete)
        self.receipt['files_batch']['results'][-1]['result']['evidence_file'] = 'evidence/not-an-original/run.json'
        self.assertTrue(self.runtime_issues(self.adoption), 'Batch paths must identify all original typed records')
        self.receipt = complete
        original_observation = copy.deepcopy(self.receipt['observation'])
        self.suite_map[self.raw['suite_id']]['side_effects'] = ['FILES', 'ISOLATED_DATA']
        self.assertTrue(self.runtime_issues(self.adoption))
        self.assertEqual(self.receipt['observation'], original_observation)

    def test_GB_U27_unrelated_and_unknown_core_issues_all_block(self):
        codes = ('CI_REQUIRED', 'TASK_NOT_DONE', 'DIRTY_WORKTREE', 'MODULE_BOUNDARY',
                 'HUMAN_DECISION_REQUIRED', 'FUTURE_UNKNOWN_ISSUE')
        issues = [issue(code) for code in codes]
        proof = {SUITE: {'suite_id': SUITE, 'status': 'APPLICABLE', 'issues': [],
                         'raw': self.raw, 'resource_proven': True}}
        self.assertEqual(self.gate.resolve_core_issues(issues, proof, [SUITE]), issues)
        other = issue('EVIDENCE_RUNTIME', 'evidence/other-run')
        self.assertEqual(self.gate.resolve_core_issues([other], proof, [SUITE]), [other])
        resource = issue('RUNTIME_RESOURCE', 'state/runtime/resources/mysql-schema')
        self.assertEqual(self.gate.resolve_core_issues([resource], proof, [SUITE, 'missing']), [resource])

    def test_GB_U28_adapter_source_cannot_borrow_old_suite_exception(self):
        self.excluded['original_suite'] = False
        allowed = {TOOLS[0]: entry('d')}
        self.current.update(allowed)
        self.assertTrue(self.source_issues(allowed))
        self.suite['id'] = 'inventory-task041-gate-binding-unit'
        self.raw['suite_id'] = self.suite['id']
        self.proof.update(before_suite=copy.deepcopy(self.suite),
                          after_suite=copy.deepcopy(self.suite), allowed_tools=allowed)
        self.proof['current_source_map'].update(allowed)
        self.proof['excluded_inputs']['original_suite'] = True
        classification = self.classify()
        self.assertFalse(classification['verified'], 'A new-suite identity overrides a contradictory original-suite flag')
        self.check_attempt([issue('EVIDENCE_SOURCE')], expected='NOT_APPLICABLE')

    def test_GB_U29_coverage_floors_global_browser_cli_required(self):
        self.assert_retained('COVERAGE_REQUIRED', 'COVERAGE_FLOOR', 'COVERAGE_GLOBAL',
            'PLAYWRIGHT_REQUIRED', 'CLI_REQUIRED')

    def test_GB_U30_other_phase_formal_release_cannot_escalate(self):
        self.ctx.phase = 'PHASE-006'
        self.ctx.gate = 'RELEASE_APPROVAL'
        self.assert_retained('GATE_SCOPE', 'FORMAL_AUTHORITY_REQUIRED')

    def test_GB_U31_invalid_future_time_and_external_equivalence(self):
        for ended_at in ('not-a-timestamp', '2999-01-01T00:00:00Z'):
            with self.subTest(ended_at=ended_at):
                with self.assertRaises(self.gate.Blocked):
                    self.gate.select_latest([self.attempt('PASS', ended_at)])
        self.proof['external_inputs']['immutable'] = False
        self.classify()
        self.check_attempt(expected='NOT_APPLICABLE')
        self.assert_retained('EVIDENCE_TIMESTAMP')

    def test_GB_U32_harness_drift_and_final_source_review_block(self):
        self.assert_retained('HARNESS_DRIFT', 'ADAPTER_SOURCE_REVIEW_REQUIRED')

    def hd233_inputs(self):
        # Invented bytes/paths model complete observations; never execution proof.
        observed = {name: entry(digit) for name, digit in (
            ('node', 'a'), ('python', 'b'), ('mysql', 'c'),
            ('harness', 'd'), ('path', 'e'), ('tools', 'f'),
            ('harness/run_check.py', 'd'), ('harness/evidence.schema.json', 'e'),
            ('python/imported/json.py', 'f'), ('node_modules/synthetic/index.js', '1'))}
        observed['PATH/node'] = dict(entry('a', symlink='/synthetic/bin/node'),
                                     resolved_target=entry('a', mode='100755'))
        observed['PATH/mysql'] = dict(entry('c', symlink='/synthetic/bin/mysql'),
                                      resolved_target=entry('c', mode='100755'))
        return {'before': copy.deepcopy(observed), 'after': copy.deepcopy(observed),
                'complete': True, 'resolved': True}

    def hd233_mapping(self, suite_id='inventory-task041-draft-lock-range-unit'):
        self.suite['id'] = suite_id
        self.raw.update(suite_id=suite_id,
            source_fingerprint='a1a3109e9c6e53be4ce81ff245f0ce4198d90beda4c1621c4ac01d6657058b8b',
            spec_baseline='4101de16c8ea1b3a94920b3ab6f3a56734660c502c11e3a2a283edc6dca192dc')
        self.raw['command_contract_sha256'] = synthetic_contract_hash(self.suite)
        self.proof = self.exact_proof()
        self.proof.update(kind='ADMIN_EQUIVALENT', original_source=self.raw['source_fingerprint'],
            current_source='f' * 64, before_plan=self.raw['spec_baseline'],
            after_plan='d34893c1ad544206f95f5e48283cd2df9149c201ccc9a80ccac05705abcd3eef')
        self.proof['approved_plan_pair'] = [self.proof['before_plan'], self.proof['after_plan']]
        canonical = ['docs/inventory_management/' + name for name in
                     ('03_design_spec.md', '05_development_tasks.md',
                      '00_module_manifest.json', '00_project_profile.json')]
        before, after = copy.deepcopy(self.before), copy.deepcopy(self.before)
        for name in list(TOOLS) + canonical:
            before[name], after[name] = entry('2'), entry('3')
        self.proof.update(before_source_map=before, current_source_map=after,
                          allowed_tools={name: after[name] for name in TOOLS})
        self.proof['hd233'] = {
            'baseline_source': self.raw['source_fingerprint'],
            'baseline_plan': self.raw['spec_baseline'], 'candidate_plan': self.proof['after_plan'],
            'canonical_before': {name: before[name] for name in canonical},
            'canonical_after': {name: after[name] for name in canonical},
            'canonical_expected': {name: {'before': before[name], 'after': after[name]}
                                   for name in canonical},
            'observational_paths': {name: {'before': before[name], 'after': after[name],
                'role': 'OBSERVATIONAL_HASH_READ', 'review_ref': 'synthetic-exact-role-review'}
                for name in list(TOOLS) + [canonical[-1]]},
            'suite_inputs': ['server/src/synthetic.js'],
            'producer_imports': ['server/src/synthetic.js'],
            'installed_inputs': self.hd233_inputs()}
        return self.proof

    def hd233_direct_receipt(self, pair=('inventory-task041-draft-lock-range-unit',
                                         'inventory-task041-draft-lock-range-database')):
        # Retains archived unitEvidence/top-level typedEvidence recipe layout.
        unit, native = (dict(copy.deepcopy(self.suite), id=sid) for sid in pair)
        unit['argv'], native['argv'] = ['node', '--test', 'synthetic-unit.js'], ['node', '--test', 'synthetic-native.js']
        self.suite_map = {unit['id']: unit, native['id']: native}
        self.suite = native
        self.raw.update(suite_id=native['id'], run_id='synthetic-native', command=native['argv'],
            started_at='2020-01-01T00:02:00Z', ended_at='2020-01-01T00:03:00Z')
        self.raw['command_contract_sha256'] = synthetic_contract_hash(native)
        self.receipt = self.normal_receipt()
        observation = self.receipt['observation']
        observation['suiteId'] = native['id']
        observation.pop('nativeOwnership')
        self.receipt.pop('native_report')
        unit_raw = dict(copy.deepcopy(self.raw), suite_id=unit['id'], run_id='synthetic-unit',
            command=unit['argv'], started_at='2020-01-01T00:00:30Z', ended_at='2020-01-01T00:01:00Z',
            command_contract_sha256=synthetic_contract_hash(unit))
        text = json.dumps(unit_raw, sort_keys=True, separators=(',', ':')) + '\n'
        unit_record = {'path': 'evidence/synthetic-unit/run.json', 'raw': unit_raw,
                       'original_text': text, 'sha256': hashlib.sha256(text.encode()).hexdigest()}
        self.receipt['typed_records'] = {record['path']: record for record in
                                        (unit_record, self.receipt['typed_record'])}
        observation['unitEvidence'] = {'selectedSuite': unit,
            'runnerExit': {'code': 0, 'signal': None},
            'runnerResponse': {'status': 'RECORDED', 'run_result': 'PASS',
                'evidence_file': unit_record['path'], 'issues': []},
            'expandedArgv': unit_raw['command'], 'typedEvidence': {
                'path': unit_record['path'], 'sha256': unit_record['sha256'], 'counts': unit_raw['counts']}}
        command = copy.deepcopy(observation['commands'][0])
        command['label'], command['args'][5] = 'unit-harness-runner', unit['id']
        observation['commands'].insert(0, command)
        observation['processes'].append({'label': 'unit-harness-runner', 'pid': 3000,
            'settled': True, 'groupTerminal': True, 'result': {'code': 0, 'signal': None}})
        producer_text = '// Synthetic verifier-only direct producer\nawait run(unit); await run(native);\n'
        producer_hash = hashlib.sha256(producer_text.encode()).hexdigest()
        self.receipt['recipe'] = {'kind': 'HD231_DIRECT',
            'producer': {'path': '/synthetic/hd231-small-coordinator.mjs',
                         'original_text': producer_text, 'sha256': producer_hash},
            'inputs': self.hd233_inputs(),
            'registered_records': {path: row['sha256'] for path, row in self.receipt['typed_records'].items()},
            'started_at': '2020-01-01T00:00:00Z', 'ended_at': '2020-01-01T00:04:00Z'}
        self.direct_policy = {'expected': self.expected, 'approved_recovery': None,
            'suite_map': self.suite_map, 'recipe': {'kind': 'HD231_DIRECT',
            'producer_sha256': producer_hash, 'suites': list(pair),
            'optional_missing_report': pair[0] == 'inventory-task036-unit'}}
        return self.receipt

    def hd233_direct_issues(self, raw=None):
        return self.gate.runtime_proof_issues(raw or self.raw, self.receipt, self.direct_policy)

    def hd233_coverage(self):
        # Synthetic V8/LCOV bytes are deliberately not usable coverage artifacts.
        producer = '// SYNTHETIC_VERIFIER_ONLY native collection producer\n'
        producer_hash = hashlib.sha256(producer.encode()).hexdigest()
        thresholds = {'lines': 92, 'branches': 83, 'functions': 90}
        command = 'npm run test:coverage:merge --workspace server'
        parts = []
        for shard in range(1, 5):
            raw = 'SYNTHETIC_VERIFIER_ONLY V8 shard %d' % shard
            parts.append({'shard': shard, 'source': 'a' * 64, 'commit': 'synthetic-head',
                'run_id': 'synthetic-ci', 'attempt': 1, 'job_id': 'job-%d' % shard,
                'artifact_id': 'artifact-%d' % shard, 'origin_verified': True,
                'manifest': {'shard': shard, 'total': 4, 'commit': 'synthetic-head',
                             'node': 'v26.6.0', 'cwd': '/synthetic/server', 'count': 1},
                'raw_text': raw, 'sha256': hashlib.sha256(raw.encode()).hexdigest()})
        lcov = 'SYNTHETIC_VERIFIER_ONLY emitted LCOV\n'
        lcov_hash = hashlib.sha256(lcov.encode()).hexdigest()
        expected = {'source': 'a' * 64, 'commit': 'synthetic-head',
            'producer_sha256': producer_hash, 'inputs': self.hd233_inputs(),
            'command': command, 'thresholds': thresholds,
            'floor_command': 'node scripts/checkCoverageFloors.js', 'checker_sha256': 'b' * 64,
            'ci_run_id': 'synthetic-ci', 'ci_attempt': 1, 'parts': 4}
        record = {'label': 'SYNTHETIC_VERIFIER_ONLY', 'recipe': 'CI_FOUR_SHARD',
            'source': expected['source'], 'commit': expected['commit'],
            'producer': {'path': '/synthetic/native-producer.mjs', 'original_text': producer,
                         'sha256': producer_hash}, 'inputs': copy.deepcopy(expected['inputs']),
            'command': command, 'thresholds': copy.deepcopy(thresholds),
            'started_at': '2020-01-01T00:00:00Z', 'ended_at': '2020-01-01T00:04:00Z',
            'exit_code': 0, 'parts': parts, 'merge_inputs': [part['sha256'] for part in parts],
            'global_enforcement': {'engine': 'NATIVE_V8', 'input_sha256': [part['sha256'] for part in parts],
                'thresholds': copy.deepcopy(thresholds), 'exit_code': 0,
                'emitted_lcov_sha256': lcov_hash},
            'lcov': {'original_text': lcov, 'sha256': lcov_hash},
            'floor': {'command': expected['floor_command'], 'input_sha256': lcov_hash,
                      'exit_code': 0, 'checker_sha256': expected['checker_sha256'], 'files': 39}}
        # These independent original observations are not derived by the verifier
        # from the record's own claimed PASS/identities/hashes.
        observations = {
            'inputs': {'kind': 'EXECUTION_INPUTS', 'source': expected['source'],
                'commit': expected['commit'], 'producer_sha256': producer_hash,
                'inputs': copy.deepcopy(expected['inputs'])},
            'download': {'kind': 'CI_ARTIFACT_DOWNLOAD', 'source': expected['source'],
                'commit': expected['commit'], 'run_id': expected['ci_run_id'],
                'attempt': expected['ci_attempt'], 'artifacts': [
                    {key: part[key] for key in ('shard', 'job_id', 'artifact_id', 'sha256')}
                    for part in parts]},
            'merge': {'kind': 'NATIVE_EXECUTION', 'source': expected['source'],
                'commit': expected['commit'], 'command': command, 'node': 'v26.6.0',
                'cwd': '/synthetic/server', 'thresholds': copy.deepcopy(thresholds),
                'input_sha256': list(record['merge_inputs']), 'output_lcov_sha256': lcov_hash,
                'exit_code': 0},
            'floor': {'kind': 'FLOOR_EXECUTION', 'source': expected['source'],
                'commit': expected['commit'], 'command': expected['floor_command'],
                'input_lcov_sha256': lcov_hash, 'checker_sha256': expected['checker_sha256'],
                'files': 39, 'exit_code': 0}}
        expected['observations'], record['execution_refs'] = {}, {}
        for kind, raw in observations.items():
            text = json.dumps(raw, sort_keys=True, separators=(',', ':')) + '\n'
            digest = hashlib.sha256(text.encode()).hexdigest()
            expected['observations'][kind] = {'raw': copy.deepcopy(raw),
                'original_text': text, 'sha256': digest}
            record['execution_refs'][kind] = digest
        return record, expected

    def test_GB_U33_hd231_mapping_preserves_raw_identity(self):
        self.hd233_mapping()
        original = copy.deepcopy(self.raw)
        self.assertEqual(self.classify()['kind'], 'ADMIN_EQUIVALENT')
        self.assertEqual(self.raw, original)
        self.proof['hd233']['observational_paths'][TOOLS[0]]['role'] = 'EXECUTED'
        self.assertEqual(self.classify()['kind'], 'UNKNOWN')

    def test_GB_U34_product_change_and_historical_gap_never_projected(self):
        self.hd233_mapping()
        self.assertEqual(self.classify()['kind'], 'ADMIN_EQUIVALENT')
        self.raw['source_fingerprint'] = self.gate.SEED_SOURCE
        self.proof['original_source'] = self.raw['source_fingerprint']
        self.proof['current_source_map']['server/src/synthetic.js'] = entry('f')
        self.assertEqual(self.classify()['kind'], 'UNKNOWN')
        self.hd233_mapping()
        del self.proof['hd233']['installed_inputs']['before']['harness/run_check.py']
        self.proof['excluded_inputs']['approved'] = True
        self.assertEqual(self.classify()['kind'], 'UNKNOWN')

    def test_GB_U35_exact_delta_rejects_extra_input_or_metadata(self):
        self.hd233_mapping()
        self.assertEqual(self.classify()['kind'], 'ADMIN_EQUIVALENT')
        original = copy.deepcopy(self.proof)
        for name, value in (('server/src/unlisted.js', entry('f')),
                (TOOLS[0], entry('3', mode='100755')),
                (TOOLS[0], entry('3', symlink='../outside')),
                ('docs/inventory_management/00_project_profile.json', entry('f'))):
            with self.subTest(changed=name, value=value):
                self.proof = copy.deepcopy(original)
                self.proof['current_source_map'][name] = value
                self.assertEqual(self.classify()['kind'], 'UNKNOWN')
        self.proof = copy.deepcopy(original)
        self.proof['hd233']['installed_inputs']['after']['PATH/node']['resolved_target'] = entry('f')
        self.assertEqual(self.classify()['kind'], 'UNKNOWN')

    def test_GB_U36_six_run_exception_excludes_consumers(self):
        self.hd233_mapping()
        self.assertEqual(self.classify()['kind'], 'ADMIN_EQUIVALENT')
        for sid in ('inventory-task041-gate-binding-unit', 'inventory-task041-gate-binding-native',
                    'lint', 'synthetic-broad-discovery'):
            with self.subTest(suite=sid):
                self.hd233_mapping(sid)
                self.assertEqual(self.classify()['kind'], 'UNKNOWN')
        self.hd233_mapping()
        self.proof['hd233']['producer_imports'].append(TOOLS[0])
        self.assertEqual(self.classify()['kind'], 'UNKNOWN')

    def test_GB_U37_direct_pair_binds_both_original_registered_runs(self):
        self.hd233_direct_receipt()
        self.assertEqual(self.hd233_direct_issues(), [])
        unit_raw = self.receipt['typed_records']['evidence/synthetic-unit/run.json']['raw']
        self.assertEqual(self.hd233_direct_issues(unit_raw), [])
        original = copy.deepcopy(self.receipt)
        for mutation in ('missing', 'tampered', 'unregistered', 'same-command', 'outside-interval'):
            with self.subTest(binding=mutation):
                self.receipt = copy.deepcopy(original)
                if mutation == 'missing': del self.receipt['typed_records']['evidence/synthetic-unit/run.json']
                elif mutation == 'tampered': self.receipt['typed_records']['evidence/synthetic-unit/run.json']['original_text'] += ' '
                elif mutation == 'unregistered': del self.receipt['recipe']['registered_records']['evidence/synthetic-unit/run.json']
                elif mutation == 'same-command': self.receipt['observation']['unitEvidence']['expandedArgv'] = self.raw['command']
                else: self.receipt['recipe']['started_at'] = '2020-01-01T00:00:45Z'
                self.assertTrue(self.hd233_direct_issues())

    def test_GB_U38_direct_optional_report_and_child_requirements(self):
        self.hd233_direct_receipt(('inventory-task036-unit', 'inventory-task036-database'))
        self.receipt['observation']['nativeObservation'] = {'missing': True, 'error': {'code': 'ENOENT',
            'message': "ENOENT: open 'evidence/synthetic-native/draft-lock-range-observations.json'"}}
        self.assertEqual(self.hd233_direct_issues(), [])
        self.direct_policy['recipe']['optional_missing_report'] = False
        self.assertTrue(self.hd233_direct_issues())
        self.hd233_direct_receipt()
        self.direct_policy['recipe']['kind'] = 'GATE_NATIVE_CHILD'
        self.receipt['recipe']['kind'] = 'GATE_NATIVE_CHILD'
        self.assertTrue(self.hd233_direct_issues())

    def test_GB_U39_producer_inputs_and_raw_integrity_fail_closed(self):
        self.hd233_direct_receipt()
        self.assertEqual(self.hd233_direct_issues(), [])
        original = copy.deepcopy(self.receipt)
        for mutation in ('producer-bytes', 'producer-kind', 'raw-hash', 'node-tree',
                         'PATH', 'Python', 'Harness', 'symlink-target'):
            with self.subTest(input=mutation):
                self.receipt = copy.deepcopy(original)
                recipe = self.receipt['recipe']
                if mutation == 'producer-bytes': recipe['producer']['original_text'] += '// changed'
                elif mutation == 'producer-kind': recipe['kind'] = 'UNRECOGNIZED_APPROVED'
                elif mutation == 'raw-hash': self.receipt['typed_record']['sha256'] = 'f' * 64
                elif mutation == 'node-tree': recipe['inputs']['after']['node_modules/synthetic/index.js'] = entry('f')
                elif mutation == 'PATH': recipe['inputs']['resolved'] = False
                elif mutation == 'Python': del recipe['inputs']['before']['python/imported/json.py']
                elif mutation == 'Harness': del recipe['inputs']['before']['harness/evidence.schema.json']
                else: del recipe['inputs']['before']['PATH/node']['resolved_target']
                self.receipt['approved'] = True
                self.assertTrue(self.hd233_direct_issues())
        with self.subTest(collector='reviewed-producer'):
            module = Path(__file__).resolve().parents[2] / 'docs/inventory_management'
            reviewed = self.gate.reviewed_producer(module)
            self.assertEqual(reviewed['sha256'], self.gate.HD233_COORDINATOR_SHA)
            with tempfile.TemporaryDirectory(prefix='hd233-producer-') as directory:
                root = Path(directory)
                producer = root / self.gate.HD233_COORDINATOR
                producer.parent.mkdir(parents=True)
                producer.write_text('// Synthetic unapproved producer with consistent own bytes\n')
                with self.assertRaises(self.gate.Blocked):
                    self.gate.reviewed_producer(root)
        with self.subTest(collector='mysql-daemon'), \
                tempfile.TemporaryDirectory(prefix='hd233-daemon-') as directory:
            root = Path(directory)
            daemon = root / 'synthetic-mysqld'
            daemon.write_bytes(b'SYNTHETIC_VERIFIER_ONLY daemon binary')
            daemon.chmod(0o755)
            binary = {'path': str(daemon), 'realpath': str(daemon.resolve()),
                'executable': True, 'sha256': hashlib.sha256(daemon.read_bytes()).hexdigest()}
            self.assertEqual(self.gate.mysql_daemon_issues(binary, expected_path=daemon), [])
            for field, value in (('path', str(root / 'different-mysqld')),
                                 ('realpath', str(root / 'different-mysqld')),
                                 ('executable', False)):
                with self.subTest(daemon_identity=field):
                    changed = dict(binary, **{field: value})
                    self.assertTrue(self.gate.mysql_daemon_issues(changed, expected_path=daemon))
            daemon.write_bytes(b'SYNTHETIC_VERIFIER_ONLY replaced daemon binary')
            self.assertTrue(self.gate.mysql_daemon_issues(binary, expected_path=daemon))

    def test_GB_U40_direct_cleanup_requires_all_terminal_resources(self):
        self.hd233_direct_receipt()
        self.assertEqual(self.hd233_direct_issues(), [])
        original = copy.deepcopy(self.receipt)
        for field in ('worker_terminal', 'sql_terminal', 'transaction_terminal', 'lock_terminal',
                      'socket_terminal', 'schema_dropped', 'daemon_exit_zero', 'root_removed'):
            for value in (False, None):
                with self.subTest(resource=field, value=value):
                    self.receipt = copy.deepcopy(original)
                    self.receipt['resource_proof'][field] = value
                    self.assertTrue(self.hd233_direct_issues())
        self.receipt = copy.deepcopy(original)
        self.receipt['recovery'] = {'approved': True, 'kind': 'FILES'}
        self.assertTrue(self.hd233_direct_issues())
        self.receipt = copy.deepcopy(original)
        self.receipt['observation']['processes'][0]['settled'] = False
        self.assertTrue(self.hd233_direct_issues())

    def test_GB_U41_all_later_attempts_and_ties_block_selected_pins(self):
        old = self.attempt('PASS', '2020-01-01T00:01:00Z')
        self.assertIs(self.gate.select_latest([old]), old)
        for later in (self.attempt('FAIL', '2020-01-01T00:02:00Z'),
                      self.attempt('PASS', '2020-01-01T00:02:00Z', 'UNKNOWN'),
                      self.attempt('PASS', '2020-01-01T00:01:00Z')):
            with self.subTest(later=later['raw']):
                with self.assertRaises(self.gate.Blocked):
                    self.gate.select_latest([old, later])
        # Exercise the collector's registry boundary with actual fixture bytes:
        # a later registered FAIL must survive discovery before selection.
        with tempfile.TemporaryDirectory(prefix='hd233-registry-') as directory:
            module = Path(directory)
            records = [dict(self.raw, run_id='synthetic-old', result='PASS'),
                       dict(self.raw, run_id='synthetic-later', result='FAIL',
                            ended_at='2020-01-01T00:02:00Z')]
            paths = []
            for raw in records:
                path = 'evidence/' + raw['run_id'] + '/run.json'
                (module / path).parent.mkdir(parents=True)
                (module / path).write_text(json.dumps(raw))
                paths.append(path)
            ctx = SimpleNamespace(module_dir=module, module_id=MODULE,
                                  state={'evidence_files': paths})
            core = SimpleNamespace(inside=lambda root, path, required: root / path,
                typed_json=lambda path, kind: json.loads(path.read_text()))
            found = self.gate.registered_attempts(ctx, core, [self.suite['id']])
            self.assertEqual([row['path'] for row in found[self.suite['id']]], paths)
            self.assertEqual([row['raw']['result'] for row in found[self.suite['id']]], ['PASS', 'FAIL'])
            for row in found[self.suite['id']]:
                row['classification'] = copy.deepcopy(self.classification)
            with self.assertRaises(self.gate.Blocked):
                self.gate.select_latest(found[self.suite['id']])
            ctx.state['evidence_files'].append(paths[0])
            with self.assertRaises(self.gate.Blocked):
                self.gate.registered_attempts(ctx, core, [self.suite['id']])

    def test_GB_U42_cli_preflight_is_bounded_read_only_dispatch(self):
        sid = 'inventory-task041-gate-binding-unit'
        payload = {'status': 'RECEIPT_PREFLIGHT_PASS', 'applicability': [], 'issues': []}
        with tempfile.TemporaryDirectory(prefix='hd233-unit-') as directory:
            repo = Path(directory)
            (repo / 'docs/inventory_management').mkdir(parents=True)
            (repo / 'docs/elsewhere').mkdir()
            argv = ['inventoryPhase005Gate.py', '--receipt-preflight', '--suite', sid,
                    '--repo-root', str(repo), '--module', 'docs/inventory_management', '--json']
            with mock.patch.object(self.gate, 'collect_receipt_preflight', return_value=payload) as collect, \
                    mock.patch.object(sys, 'argv', argv), contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(self.gate.main(), 0)
                self.assertEqual(json.loads(output.getvalue())['status'], 'RECEIPT_PREFLIGHT_PASS')
                collect.assert_called_once()
            for extra in (['--suite', 'lint'], ['--module', 'docs/elsewhere'],
                          ['--phase', 'PHASE-999'], ['--approved-json', 'synthetic.json']):
                with self.subTest(arguments=extra), \
                        mock.patch.object(self.gate, 'collect_receipt_preflight', return_value=payload) as collect, \
                        mock.patch.object(sys, 'argv', argv + extra), \
                        contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    try: code = self.gate.main()
                    except SystemExit as error: code = error.code
                    self.assertNotEqual(code, 0)
                    collect.assert_not_called()
        # Receipt discovery must not open an unrelated archived runtime.
        with tempfile.TemporaryDirectory(prefix='hd233-receipt-index-') as directory:
            root = Path(directory); raw = {'suite_id': sid, 'run_id': 'synthetic-current'}
            ref = root / 'evidence/synthetic-current/runtime-complete-ref.json'
            ref.parent.mkdir(parents=True)
            target = 'evidence/task041-hd233-small-synthetic/observation.json'
            ref.write_text(json.dumps({'path': target, 'sha256': 'e' * 64}))
            candidate = {'source_recipes': [{'observation': 'evidence/unrelated-missing/observation.json',
                'observation_sha256': 'f' * 64, 'typed_records': [{'path': 'evidence/unrelated/run.json'}]}]}
            self.assertEqual(self.gate.receipt_references(root, raw, candidate), [(target, None, 'e' * 64)])
            for digest in ('', None, False, 'xyz', 'A' * 64):
                with self.subTest(receipt_reference_sha256=digest):
                    ref.write_text(json.dumps({'path': target, 'sha256': digest}))
                    with self.assertRaises(self.gate.Blocked) as rejected:
                        self.gate.receipt_references(root, raw, candidate)
                    self.assertEqual(rejected.exception.code, 'RECEIPT_REFERENCE_INTEGRITY')
        core = SyntheticCoreBoundary()
        value = self.gate.validate_attempt(self.ctx, self.suite, self.raw,
                                          self.classification, [], core)
        self.assertEqual(value['status'], 'APPLICABLE')
        self.assertIs(core.calls[0][0], self.ctx)
        self.assertIs(core.calls[0][1], self.raw)

    def test_GB_U43_outer_receipt_cannot_attest_own_future_cleanup(self):
        self.hd233_direct_receipt()
        self.assertEqual(self.hd233_direct_issues(), [])
        original = copy.deepcopy(self.receipt)
        for mutation in ('live-outer', 'future-receipt', 'missing-native-record'):
            with self.subTest(receipt=mutation):
                self.receipt = copy.deepcopy(original)
                if mutation == 'live-outer': self.receipt['resource_proof']['root_removed'] = False
                elif mutation == 'future-receipt': self.receipt['recipe']['ended_at'] = '2999-01-01T00:00:00Z'
                else: del self.receipt['typed_records']['evidence/synthetic-native/run.json']
                self.assertTrue(self.hd233_direct_issues())

    def test_GB_U44_native_v8_output_binds_same_lcov_to_floor(self):
        record, expected = self.hd233_coverage()
        self.assertEqual(self.gate.coverage_provenance_issues(record, expected), [])
        self.assertEqual(record['label'], 'SYNTHETIC_VERIFIER_ONLY')
        self.assertNotEqual(record['global_enforcement']['input_sha256'], [record['lcov']['sha256']])
        record['floor']['input_sha256'] = 'f' * 64
        self.assertTrue(self.gate.coverage_provenance_issues(record, expected))

    def test_GB_U45_partial_stale_duplicate_unverified_coverage_rejected(self):
        original, expected = self.hd233_coverage()
        self.assertEqual(self.gate.coverage_provenance_issues(original, expected), [])
        for mutation in ('unit-only', 'partial', 'duplicate', 'conflicting', 'stale-source',
                         'stale-lcov', 'unverified-origin', 'wrong-run', 'wrong-attempt'):
            with self.subTest(coverage=mutation):
                record = copy.deepcopy(original)
                if mutation == 'unit-only': record['recipe'] = 'UNIT_ONLY'
                elif mutation == 'partial': record['parts'].pop()
                elif mutation == 'duplicate': record['parts'][3] = copy.deepcopy(record['parts'][0])
                elif mutation == 'conflicting': record['parts'][0]['manifest']['commit'] = 'other-head'
                elif mutation == 'stale-source': record['source'] = 'f' * 64
                elif mutation == 'stale-lcov': record['lcov']['original_text'] += 'changed'
                elif mutation == 'unverified-origin': record['parts'][0]['origin_verified'] = False
                elif mutation == 'wrong-run': record['parts'][0]['run_id'] = 'other-run'
                else: record['parts'][0]['attempt'] = 2
                self.assertTrue(self.gate.coverage_provenance_issues(record, expected))
        for mutation in ('consistent-unverified-run', 'substituted-jobs', 'substituted-artifacts',
                         'different-node', 'different-cwd'):
            with self.subTest(independent_origin=mutation):
                record, claimed = copy.deepcopy(original), copy.deepcopy(expected)
                for part in record['parts']:
                    if mutation == 'consistent-unverified-run':
                        part['run_id'] = claimed['ci_run_id'] = 'other-self-consistent-run'
                    elif mutation == 'substituted-jobs': part['job_id'] += '-unverified'
                    elif mutation == 'substituted-artifacts': part['artifact_id'] += '-unverified'
                    elif mutation == 'different-node': part['manifest']['node'] = 'v26.7.0'
                    else: part['manifest']['cwd'] = '/synthetic/different-server'
                self.assertTrue(self.gate.coverage_provenance_issues(record, claimed))
        # An ordinary successful Lint observation is not a coverage authority.
        ctx = SimpleNamespace(repo=Path('/synthetic/repo'), module_dir=Path('/synthetic/module'),
            state={'baseline': {'plan': 'b' * 64}, 'observations': [{
                'kind': 'CI', 'subject': 'Lint', 'code_commit': expected['commit'],
                'spec_baseline': 'b' * 64, 'source_fingerprint': expected['source'],
                'status': 'PASS', 'actor': 'GitHub Actions',
                'observed_at': '2020-01-01T00:05:00Z',
                'source_ref': 'evidence/synthetic-ci-origin.json#sha256=' + 'c' * 64}]},
            baselines=lambda: {'plan': 'b' * 64})
        core = SimpleNamespace(current_commit=lambda repo: expected['commit'])
        with self.assertRaises(self.gate.Blocked) as rejected:
            self.gate.coverage_origin(ctx, core, expected['source'])
        self.assertEqual(rejected.exception.code, 'COVERAGE_CI_ORIGIN_REQUIRED')

    def test_GB_U46_global_native_threshold_producer_chain_is_exact(self):
        original, expected = self.hd233_coverage()
        self.assertEqual(self.gate.coverage_provenance_issues(original, expected), [])
        for mutation in ('lcov-as-native-input', 'global-output', 'merge-input', 'threshold',
                         'command', 'dependency', 'missing-producer', 'producer-bytes', 'floor-checker'):
            with self.subTest(provenance=mutation):
                record = copy.deepcopy(original)
                if mutation == 'lcov-as-native-input': record['global_enforcement']['input_sha256'] = [record['lcov']['sha256']]
                elif mutation == 'global-output': record['global_enforcement']['emitted_lcov_sha256'] = 'f' * 64
                elif mutation == 'merge-input': record['merge_inputs'][0] = 'f' * 64
                elif mutation == 'threshold': record['global_enforcement']['thresholds']['lines'] = 91
                elif mutation == 'command': record['command'] = 'node --test synthetic-unit.js'
                elif mutation == 'dependency': record['inputs']['after']['node_modules/synthetic/index.js'] = entry('f')
                elif mutation == 'missing-producer': del record['producer']
                elif mutation == 'producer-bytes': record['producer']['original_text'] += '//changed'
                else: record['floor']['checker_sha256'] = 'f' * 64
                self.assertTrue(self.gate.coverage_provenance_issues(record, expected))
        for mutation in ('missing-original', 'hashes-without-execution', 'empty-lcov'):
            with self.subTest(original_execution=mutation):
                record, claimed = copy.deepcopy(original), copy.deepcopy(expected)
                if mutation == 'missing-original':
                    del claimed['observations']['merge']
                elif mutation == 'hashes-without-execution':
                    raw = {'kind': 'NATIVE_EXECUTION', 'status': 'PASS',
                           'output_lcov_sha256': record['lcov']['sha256']}
                    text = json.dumps(raw, sort_keys=True, separators=(',', ':')) + '\n'
                    digest = hashlib.sha256(text.encode()).hexdigest()
                    claimed['observations']['merge'] = {'raw': raw,
                        'original_text': text, 'sha256': digest}
                    record['execution_refs']['merge'] = digest
                else:
                    digest = hashlib.sha256(b'').hexdigest()
                    record['lcov'] = {'original_text': '', 'sha256': digest}
                    record['global_enforcement']['emitted_lcov_sha256'] = digest
                    record['floor']['input_sha256'] = digest
                    for kind, field in (('merge', 'output_lcov_sha256'), ('floor', 'input_lcov_sha256')):
                        raw = claimed['observations'][kind]['raw']
                        raw[field] = digest
                        text = json.dumps(raw, sort_keys=True, separators=(',', ':')) + '\n'
                        observation_hash = hashlib.sha256(text.encode()).hexdigest()
                        claimed['observations'][kind].update(original_text=text, sha256=observation_hash)
                        record['execution_refs'][kind] = observation_hash
                self.assertTrue(self.gate.coverage_provenance_issues(record, claimed))
        for mutation in ('consistent-input-replacement', 'consistent-producer-replacement'):
            with self.subTest(independent_inputs=mutation):
                record, claimed = copy.deepcopy(original), copy.deepcopy(expected)
                if mutation == 'consistent-input-replacement':
                    for side in ('before', 'after'):
                        record['inputs'][side]['node_modules/synthetic/index.js'] = entry('9')
                    claimed['inputs'] = copy.deepcopy(record['inputs'])
                else:
                    record['producer']['original_text'] += '// replacement producer\n'
                    digest = hashlib.sha256(record['producer']['original_text'].encode()).hexdigest()
                    record['producer']['sha256'] = claimed['producer_sha256'] = digest
                self.assertTrue(self.gate.coverage_provenance_issues(record, claimed))
        with self.subTest(container='actual-collector-record-list'):
            with tempfile.TemporaryDirectory(prefix='hd233-coverage-shape-') as directory:
                module = Path(directory)
                path = module / 'evidence/native-coverage-provenance/observation.json'
                path.parent.mkdir(parents=True)
                path.write_text(json.dumps({'record': []}))
                ctx = SimpleNamespace(module_dir=module)
                core = SimpleNamespace(HarnessError=RuntimeError)
                with mock.patch.object(self.gate, 'coverage_origin', return_value={}):
                    errors = self.gate.collect_coverage_provenance(ctx, core, expected['source'])
                self.assertIn('COVERAGE_RECORD_SHAPE', [error['code'] for error in errors])
        with self.subTest(container='native-v8-object-boundary'):
            raw = {'result': []}
            self.assertIs(self.gate.coverage_object(raw, 'NATIVE_V8_INPUT_SHAPE'), raw)
            for invalid in ([], None):
                with self.subTest(native_v8_container=invalid):
                    with self.assertRaises(self.gate.Blocked) as rejected:
                        self.gate.coverage_object(invalid, 'NATIVE_V8_INPUT_SHAPE')
                    self.assertEqual(rejected.exception.code, 'NATIVE_V8_INPUT_SHAPE')

    def test_GB_U47_preflight_and_coverage_do_not_clear_other_core_blockers(self):
        record, expected = self.hd233_coverage()
        self.assertEqual(self.gate.coverage_provenance_issues(record, expected), [])
        blockers = [issue(code) for code in ('CI_REQUIRED', 'EVIDENCE_COMMIT', 'LATEST_MAIN_REQUIRED',
            'SOURCE_REVIEW_REQUIRED', 'TASK_DOD', 'DIRTY_SCOPE', 'UNRECOGNIZED_CORE_FINDING')]
        good = {sid: {'status': 'APPLICABLE', 'issues': [], 'resource_proven': True,
                     'raw': dict(self.raw, run_id='synthetic-%d' % number)}
                for number, sid in enumerate(('inventory-task041-gate-binding-unit',
                                              'inventory-task041-gate-binding-native'))}
        self.assertEqual(self.gate.resolve_core_issues(blockers, good, list(good)), blockers)
        closed = issue('REQUIRED_RUN_MISSING', 'gate/DEVELOPER/inventory-task041-gate-binding-unit')
        self.assertEqual(self.gate.resolve_core_issues([closed], good, list(good)), [])

    def test_GB_U48_absent_other_groups_support_and_hold_stay_distinct(self):
        required = ['synthetic-other-%02d' % number for number in range(60)]
        support = ['synthetic-support-%d' % number for number in range(3)]
        hold = ['synthetic-full-load-%d' % number for number in range(4)]
        blockers = [issue('REQUIRED_RUN_MISSING', 'gate/DEVELOPER/' + sid) for sid in required]
        blockers += [issue('SUPPORT_ONLY', sid) for sid in support] + [issue('HOLD', sid) for sid in hold]
        self.assertEqual(self.gate.resolve_core_issues(blockers, {}, required), blockers)
        self.assertEqual((len(required), len(support), len(hold)), (60, 3, 4))
        # A supporting receipt cannot make the absent Characterization run exist.
        characterization = issue('REQUIRED_RUN_MISSING', 'gate/DEVELOPER/inventory-task041-characterization')
        self.assertEqual(self.gate.resolve_core_issues([characterization], {}, required), [characterization])
        with self.assertRaises(self.gate.Blocked):
            self.gate.select_latest([])

    def hd235_registry(self):
        module = Path(__file__).resolve().parents[2] / 'docs/inventory_management'
        manifest = json.loads((module / 'implementation/task041-hd235-completion-manifest.json').read_text())
        return {row['suite_id']: copy.deepcopy(row['candidate_suite']) for row in manifest['rows']}

    def hd235_receipt(self, transport='FILES_DIRECT'):
        self.expected.update(schema_prefix='synthetic_', account='synthetic-account')
        self.receipt = self.normal_receipt()
        self.receipt['observation']['mysql']['account'] = self.expected['account']
        producer = '// SYNTHETIC_VERIFIER_ONLY HD235 producer\n'
        digest = hashlib.sha256(producer.encode()).hexdigest()
        self.receipt['recipe'] = {'kind': 'HD235', 'transport': transport,
            'producer': {'path': '/synthetic/hd235-runtime.mjs', 'original_text': producer, 'sha256': digest},
            'inputs': self.hd233_inputs(),
            'registered_records': {self.receipt['typed_record']['path']: self.receipt['typed_record']['sha256']},
            'started_at': '2020-01-01T00:00:00Z', 'ended_at': '2020-01-01T00:04:00Z',
            'lifecycle': {'state': 'COMPLETE', 'finalized_at': '2020-01-01T00:04:00Z',
                          'registered_before_validation': True}}
        self.hd235_policy = {'expected': copy.deepcopy(self.expected), 'suite_map': {self.suite['id']: self.suite},
            'recipe': {'kind': 'HD235', 'transport': transport, 'producer_sha256': digest}}
        if transport in ('FILES_DIRECT', 'BROWSER_DECLARED_MOCK'):
            for key in ('schema', 'socket', 'datadir', 'pid', 'mysql_sha256', 'schema_prefix', 'account'):
                self.receipt['binding'].pop(key)
                self.hd235_policy['expected'].pop(key)
            self.receipt.pop('native_report')
            obs = self.receipt['observation']
            for key in ('mysql', 'mysqlBinaryHash', 'postTestSql', 'nativeOwnership', 'terminal', 'schema'):
                obs.pop(key)
            obs['processes'] = [row for row in obs['processes'] if row['label'] == 'harness-runner']
            obs['cleanup'] = 'OWN_FILES_ROOT_REMOVED'
            self.receipt['resource_proof'] = {'worker_terminal': True, 'root_removed': True}
        elif transport in ('MYSQL_HTTP', 'BROWSER_REAL_APP'):
            native = {'requests': [{'method': 'POST', 'path': '/synthetic/fail', 'status': 403,
                'jwt_path': 'actual-request-authentication', 'device': 'synthetic-device'}]}
            text = json.dumps(native, sort_keys=True, separators=(',', ':')) + '\n'
            digest = hashlib.sha256(text.encode()).hexdigest()
            self.receipt['http'] = {'transport': 'REAL_HTTP', 'suite_id': self.raw['suite_id'],
                'native_report': {'path': 'evidence/synthetic-http-native.json', 'raw': native,
                                  'original_text': text, 'sha256': digest}}
            self.hd235_policy['http'] = {'required_native_report_hash': digest}
        elif transport == 'MYSQL_IPC_PROCESS':
            for stop in self.receipt['observation']['nativeOwnership']['ownedStops']:
                stop.update(gracefulReply={'exitCode': 0}, forced=False)
            self.bind_native_report(self.receipt)
        if transport in ('BROWSER_DECLARED_MOCK', 'BROWSER_REAL_APP'):
            browser = {'mode': 'EXPLICIT_EXISTING_MOCK' if transport == 'BROWSER_DECLARED_MOCK' else 'REAL_APP',
                'config': self.suite['argv'][self.suite['argv'].index('--config') + 1],
                'origins': [{'role': 'client', 'url': 'http://127.0.0.1:4101', 'terminal': True}],
                'originalPlaywrightPassed': True, 'binariesCaptured': True}
            if transport == 'BROWSER_REAL_APP':
                browser['origins'].append({'role': 'api', 'url': 'http://127.0.0.1:4102', 'terminal': True})
            self.receipt['observation']['browser'] = browser
        return self.receipt

    def hd235_runtime(self):
        return self.gate.hd235_runtime_issues(self.raw, self.receipt, self.hd235_policy)

    def hd235_recorder(self, operation, payload):
        # Import the actual checked-in recorder. No Docker/network/CI is invoked.
        import subprocess
        module = Path(__file__).resolve().with_name('inventoryPhase005CoverageEvidence.mjs')
        program = '''import * as recorder from %s;
const input = JSON.parse(process.argv[1]);
try {
 const value = recorder[%s](...input);
 console.log(JSON.stringify({accepted: true, value}));
} catch (error) { console.log(JSON.stringify({accepted: false, error: String(error.message)})); }
''' % (json.dumps(module.as_uri()), json.dumps(operation))
        result = subprocess.run(['node', '--input-type=module', '-e', program, json.dumps(payload)],
            capture_output=True, text=True, timeout=10, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def hd235_node_probe(self, body, payload=None, cwd=None):
        import subprocess
        module = Path(__file__).resolve().with_name('inventoryPhase005CoverageEvidence.mjs')
        program = "import * as recorder from %s;\nconst input=JSON.parse(process.argv[1]);\n" % json.dumps(module.as_uri())
        result = subprocess.run(['node', '--input-type=module', '-e', program + body,
                                 json.dumps(payload)], cwd=cwd, capture_output=True,
                                text=True, timeout=5, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def hd235_shard_files(self, root):
        identity = {'commit': 'a' * 40, 'runId': '123', 'attempt': 1, 'job': 'regression'}
        terminal = {'connections': 0, 'transactions': 0, 'locks': 0,
                    'observerSocketClosed': True, 'containerExitCode': 0, 'forced': False}
        for number in range(1, 5):
            directory = root / ('server/coverage/shards/server-coverage-%d' % number)
            (directory / 'raw').mkdir(parents=True)
            (directory / 'inventory-proof').mkdir()
            raw_name = 'raw/coverage-%d-1234567890123-0.json' % number
            raw_text = json.dumps({'result': [{'scriptId': str(number), 'url': 'file:///synthetic.js',
                'functions': [{'functionName': '', 'ranges': [{'startOffset': 0, 'endOffset': 1, 'count': 1}],
                               'isBlockCoverage': True}]}]})
            (directory / raw_name).write_text(raw_text)
            manifest = {'commit': identity['commit'], 'node': 'v26.6.0', 'cwd': '/synthetic/server',
                        'shard': number, 'total': 4, 'reports': 1}
            manifest_text = json.dumps(manifest)
            (directory / 'manifest.json').write_text(manifest_text)
            proof = {'kind': 'CI_NATIVE_SHARD', 'identity': dict(identity, job='server-tests'),
                'shard': number, 'before': {'source': 'a' * 64, 'commit': identity['commit'],
                    'node': manifest['node'], 'cwd': manifest['cwd']},
                'terminal': terminal, 'manifestSha256': hashlib.sha256(manifest_text.encode()).hexdigest(),
                'rawFiles': [{'path': raw_name, 'sha256': hashlib.sha256(raw_text.encode()).hexdigest()}]}
            proof['after'] = copy.deepcopy(proof['before'])
            (directory / 'inventory-proof/complete.json').write_text(json.dumps(proof))
        return identity

    def hd235_ci_env(self):
        return {'GITHUB_ACTIONS': 'true', 'GITHUB_SHA': 'a' * 40, 'GITHUB_RUN_ID': '123',
            'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_JOB': 'server-tests',
            'INVENTORY_CI_MYSQL_CONTAINER': '1' * 64}

    def hd235_merge(self):
        before = {'source': 'a' * 64, 'commit': 'a' * 40, 'plan': 'b' * 64, 'node': 'v26.6.0', 'npm': '10.9.2',
            'cwd': '/synthetic/server', 'command': 'npm run test:coverage:merge --workspace server',
            'inputs': self.hd233_inputs(), 'thresholds': {'lines': 92, 'branches': 83, 'functions': 90}}
        return {'before': before, 'after': copy.deepcopy(before),
            'outcome': {'exitCode': 0, 'signal': None}, 'lcovSha256': 'b' * 64,
            'parts': [{'shard': n, 'sha256': str(n) * 64, 'run_id': '123', 'attempt': 1,
                       'commit': 'a' * 40} for n in range(1, 5)]}

    def hd235_coverage(self):
        record, expected = self.hd233_coverage()
        record['workflow_sha256'] = expected['workflow_sha256'] = 'd' * 64
        artifacts = expected['observations']['download']['raw']['artifacts']
        for part, artifact in zip(record['parts'], artifacts):
            for item in (part, artifact):
                item.update(expired=False, downloaded=True, publisher_job_id=part['job_id'])
        document = expected['observations']['download']
        document['original_text'] = json.dumps(document['raw'], sort_keys=True, separators=(',', ':')) + '\n'
        document['sha256'] = hashlib.sha256(document['original_text'].encode()).hexdigest()
        record['execution_refs']['download'] = document['sha256']
        return record, expected

    def hd236_native_mechanics(self, scenario):
        """SYNTHETIC_MECHANICS_ONLY: own files and mock Node; no native/DB PASS."""
        import os
        from uuid import uuid4
        private_tmp_root = Path(tempfile.gettempdir()).resolve()

        @contextlib.contextmanager
        def owner_root():
            target = private_tmp_root / ('erp-inventory-task041-gate-binding-mysql-2670.' + uuid4().hex[:12])
            target.mkdir(mode=0o700)
            try: yield str(target)
            finally: self.gate.shutil.rmtree(target)

        with tempfile.TemporaryDirectory(prefix='hd236-unit-repo-', dir=private_tmp_root) as workspace, \
                owner_root() as owned:
            repo, owner = Path(workspace), Path(owned)
            owner.chmod(0o700)
            source = repo / 'server/test-support/inventoryPhase005GateNative.mjs.txt'
            source.parent.mkdir(parents=True)
            source_bytes = b'// SYNTHETIC_MECHANICS_ONLY mocked Node; never Inventory/native PASS\n'
            source.write_bytes(source_bytes)
            directory = repo / 'docs/inventory_management/evidence/synthetic-mechanics'
            directory.mkdir(parents=True)
            node = repo / 'mock-node-never-executed'
            node.write_bytes(b'SYNTHETIC_NODE_NEVER_EXECUTED')
            node.chmod(0o700)
            archive = directory / 'inventoryPhase005GateNative.mjs.txt'
            report = directory / 'inventory-phase005-gate-native.json'
            proof_path = directory / 'inventory-phase005-native-executable.json'
            native = owner / 'inventoryPhase005GateNative.mjs'
            report_bytes = b'{"claim":"SYNTHETIC_MOCK_REPORT_NOT_NATIVE_OR_GATE_PASS"}\n'
            protected_bytes = b'PREEXISTING_ARCHIVE_MUST_NOT_BE_OVERWRITTEN\n'
            env = {'DB_INTEGRATION_TESTS': '1', 'INVENTORY_GATE_BINDING_TESTS': '1',
                'DB_USER': 'root', 'DB_NAME': 'erp_inventory_gate_binding_' + 'a' * 12,
                'DB_SOCKET_PATH': str(owner / 'mysql.sock'), 'TMPDIR': str(owner)}
            if scenario == 'wrong-owner':
                wrong = owner / 'different-owner'
                wrong.mkdir(mode=0o700)
                env['TMPDIR'] = str(wrong)
            elif scenario == 'owner-0755': owner.chmod(0o755)
            elif scenario == 'duplicate-archive': archive.write_bytes(protected_bytes)
            elif scenario == 'duplicate-report': report.write_bytes(protected_bytes)
            calls = []

            def mocked_node(argv, **kwargs):
                calls.append((argv, kwargs))
                self.assertEqual(Path(argv[-1]), native, 'Executable must be inside the actual owned TMPDIR')
                self.assertEqual(native.read_bytes(), source_bytes)
                self.assertEqual(native.stat().st_mode & 0o777, 0o600)
                self.assertEqual(archive.read_bytes(), source_bytes)
                if scenario != 'missing-report':
                    (owner / 'inventory-phase005-gate-native.json').write_bytes(report_bytes)
                if scenario == 'mutated-executable': native.write_bytes(b'// changed executed bytes\n')
                elif scenario == 'mutated-archive': archive.write_bytes(b'// changed archived bytes\n')
                return SimpleNamespace(returncode=1 if scenario == 'native-exit1' else 0)

            rejected = scenario not in ('positive', 'native-exit1')
            with mock.patch.object(self.gate, 'LOCAL_PRIVATE_TMP_ROOT', private_tmp_root), \
                    mock.patch.object(self.gate, '__file__', str(repo / 'server/scripts/inventoryPhase005Gate.py')), \
                    mock.patch.dict(os.environ, env), \
                    mock.patch.object(self.gate.shutil, 'which', return_value=str(node)), \
                    mock.patch.object(self.gate.subprocess, 'run', side_effect=mocked_node):
                if rejected:
                    with self.assertRaises((self.gate.Blocked, OSError)):
                        self.gate.native_preflight(directory)
                else:
                    code = self.gate.native_preflight(directory)
                    self.assertEqual(code, 1 if scenario == 'native-exit1' else 0)
            if scenario in ('wrong-owner', 'owner-0755', 'duplicate-archive'):
                self.assertEqual(calls, [], 'Invalid execution ownership/archive must reject before Node')
            if scenario == 'duplicate-archive': self.assertEqual(archive.read_bytes(), protected_bytes)
            if scenario == 'duplicate-report': self.assertEqual(report.read_bytes(), protected_bytes)
            self.assertFalse(list(directory.glob('*.mjs')), 'Evidence may archive text, never executable .mjs')
            if scenario in ('positive', 'native-exit1', 'mutated-executable', 'mutated-archive', 'missing-report', 'duplicate-report'):
                proof = json.loads(proof_path.read_text())
                self.assertEqual(proof['kind'], 'ACTUAL_NATIVE_PRIVATE_EXECUTABLE')
                self.assertEqual(proof['exit_code'], 1 if scenario == 'native-exit1' else 0)
                self.assertEqual(proof['executed_path'], str(native))
                self.assertEqual(proof['owner_root'], str(owner))
                self.assertEqual(proof['node'], {'path': str(node), 'realpath': str(node),
                    'sha256': hashlib.sha256(node.read_bytes()).hexdigest()})
                self.assertEqual(proof['command'], calls[0][0])
                self.assertEqual(proof['cwd'], str(repo))
                self.assertLessEqual(self.gate.timestamp(proof['started_at']), self.gate.timestamp(proof['ended_at']))
                if rejected:
                    self.assertEqual(proof['status'], 'UNKNOWN', 'Mutated/missing report cannot become usable execution proof')
                else:
                    digest = hashlib.sha256(source_bytes).hexdigest()
                    self.assertEqual(proof['status'], 'EXECUTED_SOURCE_UNCHANGED')
                    for field in ('source_sha256', 'archive_sha256', 'executed_before_sha256',
                                  'executed_after_sha256', 'archive_after_sha256'):
                        self.assertEqual(proof[field], digest, field)
                    self.assertEqual(archive.read_bytes(), source_bytes)
                    self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
                    self.assertEqual(report.read_bytes(), report_bytes)
                    self.assertEqual(report.stat().st_mode & 0o777, 0o600)
                    self.assertEqual((owner / 'inventory-phase005-gate-native.json').read_bytes(), report_bytes)
                    self.assertEqual(proof['native_report'], {'executed_path': str(owner / 'inventory-phase005-gate-native.json'),
                        'archive_path': report.relative_to(repo).as_posix(),
                        'sha256': hashlib.sha256(report_bytes).hexdigest()})
            owner.chmod(0o700)

    def test_GB_U49_finite_registry_rejects_unknown_and_altered_contract(self):
        expected = self.hd235_registry()
        self.assertEqual(len(expected), 73)
        self.assertEqual(self.gate.hd235_registry_issues(copy.deepcopy(expected), expected), [])
        for mutation in ('unknown', 'cross-module', 'contract'):
            registry = copy.deepcopy(expected)
            if mutation == 'contract': registry['lint']['argv'] = ['true']
            else: registry['sales-foreign' if mutation == 'cross-module' else 'arbitrary'] = registry.pop('lint')
            self.assertTrue(self.gate.hd235_registry_issues(registry, expected), mutation)

    def test_GB_U50_files_accepts_real_process_and_artifact_without_database(self):
        self.hd235_receipt()
        frozen = copy.deepcopy((self.raw, self.receipt, self.hd235_policy))
        self.assertEqual(self.hd235_runtime(), [])
        self.assertNotIn('mysql', self.receipt['observation'])
        self.assertEqual((self.raw, self.receipt, self.hd235_policy), frozen)
        self.receipt['observation']['processes'][0]['groupTerminal'] = False
        self.assertTrue(self.hd235_runtime())

    def test_GB_U51_files_missing_executed_input_closure_is_unknown(self):
        self.hd235_receipt()
        self.assertEqual(self.hd235_runtime(), [])
        original = copy.deepcopy(self.receipt)
        for name in ('python/imported/json.py', 'harness/run_check.py', 'harness/evidence.schema.json',
                     'node_modules/synthetic/index.js', 'PATH/node'):
            with self.subTest(missing=name):
                self.receipt = copy.deepcopy(original)
                del self.receipt['recipe']['inputs']['before'][name]
                self.assertTrue(self.hd235_runtime())
        with tempfile.TemporaryDirectory(prefix='hd235-node-toolchain-') as directory:
            prefix = Path(directory).resolve() / 'node-prefix'
            npm_root = prefix / 'lib/node_modules/npm'
            (prefix / 'bin').mkdir(parents=True)
            (npm_root / 'bin').mkdir(parents=True)
            (npm_root / 'node_modules/dependency').mkdir(parents=True)
            node = prefix / 'bin/node'
            node.write_bytes(b'SYNTHETIC_NODE_NEVER_EXECUTED')
            node.chmod(0o755)
            (npm_root / 'package.json').write_text('{"name":"synthetic-npm"}\n')
            for name in ('npm-cli.js', 'npx-cli.js'):
                script = npm_root / 'bin' / name
                script.write_text('// SYNTHETIC_TOOL_NEVER_EXECUTED ' + name + '\n')
                script.chmod(0o755)
            for name, target in (('npm', '../lib/node_modules/npm/bin/npm-cli.js'),
                                 ('npx', '../lib/node_modules/npm/bin/npx-cli.js')):
                (prefix / 'bin' / name).symlink_to(target)
            dependency = npm_root / 'node_modules/dependency/index.js'
            dependency.write_text('// original npm dependency\n')
            alias = npm_root / 'dependency-link.js'
            alias.symlink_to('node_modules/dependency/index.js')
            library = prefix / 'lib/libnode.dylib'
            library.write_bytes(b'SYNTHETIC_NATIVE_LIBRARY_NEVER_LOADED')
            library.chmod(0o644)

            def record_file(path):
                return {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                        'executable': bool(path.stat().st_mode & 0o111)}

            def record_tree(path):
                if path.is_symlink():
                    return {str(path): {'symlink': str(path.readlink()),
                        'realpath': str(path.resolve()), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}}
                if path.is_dir():
                    result = {str(path): {'directory': True, 'children': sorted(item.name for item in path.iterdir())}}
                    for child in path.iterdir(): result.update(record_tree(child))
                    return result
                return {str(path): record_file(path)}

            observed = {'path': {name: dict(path=str(prefix / 'bin' / name), realpath=str(path),
                    symlink=str((prefix / 'bin' / name).readlink()) if (prefix / 'bin' / name).is_symlink() else None,
                    executable=True, sha256=record_file(path)['sha256'])
                for name, path in (('node', node), ('npm', npm_root / 'bin/npm-cli.js'),
                                   ('npx', npm_root / 'bin/npx-cli.js'))},
                'node': {'globalNpm': {'root': str(npm_root), 'files': record_tree(npm_root)},
                    'nativeLibraries': {'root': str(prefix / 'lib'), 'names': ['libnode.dylib'],
                                        'files': {str(library): record_file(library)}}}}
            def toolchain_issues(groups, current_lookup=None):
                current = current_lookup or {name: row['path'] for name, row in observed['path'].items()}
                with mock.patch.object(self.gate.shutil, 'which', side_effect=lambda name: current.get(name)):
                    return self.gate.hd235_node_toolchain_issues(groups)

            original_observed = copy.deepcopy(observed)
            self.assertEqual(toolchain_issues(observed), [])
            self.assertEqual(observed, original_observed, 'Toolchain validation must preserve captured metadata')
            for missing in ('npm', 'npx'):
                changed = copy.deepcopy(observed)
                del changed['path'][missing]
                self.assertTrue(toolchain_issues(changed), missing)
            for root_key in ('globalNpm', 'nativeLibraries'):
                changed = copy.deepcopy(observed)
                changed['node'][root_key]['root'] = str(prefix / 'unrelated-prefix-label')
                self.assertTrue(toolchain_issues(changed), root_key)
            spoof_bin = prefix.parent / 'prepend-bin'
            spoof_bin.mkdir()
            for name in ('npm', 'npx'):
                spoof = spoof_bin / name
                spoof.write_text('// spoofed PATH implementation, never executed\n')
                spoof.chmod(0o755)
                current_lookup = {key: row['path'] for key, row in observed['path'].items()}
                current_lookup[name] = str(spoof)
                self.assertTrue(toolchain_issues(observed, current_lookup), 'Prepending only ' + name + ' changes executed input')
            for field, value in (('path', str(spoof_bin / 'npm')), ('symlink', '../unobserved/npm-cli.js')):
                changed = copy.deepcopy(observed)
                changed['path']['npm'][field] = value
                self.assertTrue(toolchain_issues(changed), 'Recorded npm lookup ' + field + ' identity changed')
            changed = copy.deepcopy(observed)
            del changed['node']['nativeLibraries']['files'][str(library)]['executable']
            self.assertTrue(toolchain_issues(changed), 'Unknown native executable mode')
            changed = copy.deepcopy(observed)
            changed['path']['npm']['realpath'] = str(npm_root / 'bin/missing-npm.js')
            self.assertTrue(toolchain_issues(changed), 'Missing actual npm lookup')
            changed = copy.deepcopy(observed)
            del changed['node']['globalNpm']['files'][str(dependency)]
            self.assertTrue(toolchain_issues(changed), 'Full npm tree cannot omit dependency bytes')
            dependency_original = dependency.read_bytes()
            dependency.write_text('// replaced npm dependency\n')
            self.assertTrue(toolchain_issues(observed), 'Changed npm dependency bytes')
            dependency.write_bytes(dependency_original)
            extra_dependency = npm_root / 'node_modules/dependency/added.js'
            extra_dependency.write_text('// newly installed npm dependency\n')
            self.assertTrue(toolchain_issues(observed), 'Directory membership catches new npm files')
            extra_dependency.unlink()
            library_original = library.read_bytes()
            library.write_bytes(b'CHANGED_SYNTHETIC_NATIVE_LIBRARY')
            self.assertTrue(toolchain_issues(observed), 'Changed native library bytes')
            library.write_bytes(library_original)
            library.chmod(0o755)
            self.assertTrue(toolchain_issues(observed), 'Changed native library executable mode')
            library.chmod(0o644)
            extra_library = prefix / 'lib/libextra.dylib'
            extra_library.write_bytes(b'UNOBSERVED_NATIVE_LIBRARY')
            self.assertTrue(toolchain_issues(observed), 'Native dylib membership is complete')
            extra_library.unlink()
            alias.unlink()
            alias.symlink_to('package.json')
            self.assertTrue(toolchain_issues(observed), 'Changed npm symlink target')

    def test_GB_U52_mysql_direct_binds_original_run_and_complete_ownership(self):
        self.hd235_receipt('MYSQL_DIRECT')
        self.assertEqual(self.hd235_runtime(), [])
        self.receipt['typed_record']['raw']['run_id'] = 'borrowed-run'
        self.assertTrue(self.hd235_runtime())

    def test_GB_U53_mysql_identity_namespace_account_and_ownership_reject(self):
        self.hd235_receipt('MYSQL_DIRECT')
        self.assertEqual(self.hd235_runtime(), [])
        original = copy.deepcopy(self.receipt)
        for name in ('schema', 'socket', 'datadir', 'schema_prefix', 'account', 'owner'):
            with self.subTest(identity=name):
                self.receipt = copy.deepcopy(original)
                self.receipt['binding'][name] = 'borrowed-' + name
                self.assertTrue(self.hd235_runtime())
        self.receipt = copy.deepcopy(original)
        self.receipt['observation']['mysql']['account'] = 'borrowed-observed-account'
        self.assertTrue(self.hd235_runtime())

    def test_GB_U54_http_requires_matching_app_request_jwt_device_and_native(self):
        self.hd235_receipt('MYSQL_HTTP')
        self.assertEqual(self.hd235_runtime(), [])
        original = copy.deepcopy(self.receipt)
        for mutation in ('suite', 'native-bytes', 'native-hash'):
            self.receipt = copy.deepcopy(original)
            if mutation == 'suite': self.receipt['http']['suite_id'] = 'other-suite'
            elif mutation == 'native-bytes':
                self.receipt['http']['native_report']['raw']['requests'][0]['path'] = '/fixture-mock'
            else: self.receipt['http']['native_report']['sha256'] = 'f' * 64
            self.assertTrue(self.hd235_runtime(), mutation)

        # Original JUnit is accepted only as the pinned execution artifact, never a status-only replacement.
        for body, accepted in (('<testsuite><testcase name="native request"/></testsuite>', True),
                               ('<testsuite><testcase name="native request"><failure/></testcase></testsuite>', False),
                               ('<testsuite/>', False), ('<broken', False)):
            self.hd235_receipt('MYSQL_HTTP')
            self.hd235_policy['suite_map'][self.raw['suite_id']]['min_tests'] = 1
            native = self.receipt['http']['native_report']
            native.update(raw=None, original_text=body, sha256=hashlib.sha256(body.encode()).hexdigest())
            self.hd235_policy['http']['required_native_report_hash'] = native['sha256']
            self.receipt['http']['format'] = 'ORIGINAL_JUNIT'
            self.assertEqual(self.hd235_runtime() == [], accepted, body)
        self.hd235_receipt('MYSQL_HTTP')
        self.receipt['http']['format'] = 'UNREVIEWED_FORMAT'
        self.assertTrue(self.hd235_runtime(), 'Unrecognized evidence format must fail closed')

    def test_GB_U55_http_status_and_mock_fixture_cannot_replace_native_execution(self):
        self.hd235_receipt('MYSQL_HTTP')
        self.assertEqual(self.hd235_runtime(), [])
        self.receipt['http']['transport'] = 'MOCK_HTTP'
        self.assertTrue(self.hd235_runtime())
        self.receipt['http']['transport'] = 'REAL_HTTP'
        self.receipt['http'].pop('native_report')
        self.assertTrue(self.hd235_runtime(), 'HTTP 403 alone proves neither app execution nor cleanup')

    def test_GB_U56_ipc_binds_all_owned_connections_and_transaction_history(self):
        self.hd235_receipt('MYSQL_IPC_PROCESS')
        worker = self.receipt['native_report']['raw']['ownedSql']['workers'][0]
        worker['connections'][0]['observedTransactionIds'] = ['transaction-17']
        worker['latest'][0]['observedTransactionIds'] = ['transaction-17']
        self.seal_native_report(self.receipt)
        self.assertEqual(self.hd235_runtime(), [])
        worker['latest'][0]['observedTransactionIds'] = []
        self.seal_native_report(self.receipt)
        self.assertTrue(self.hd235_runtime())

        # SYNTHETIC_PARSER_SHAPE_ONLY: no original runtime or native PASS claim.
        observations = [
            {'kind': 'realRuntime', 'mysql': '26.7.0', 'schema': 'synthetic_hd235_parser',
             'synthetic': True, 'parentPid': 100},
            {'kind': 'ownedChildTerminated', 'pid': 101, 'connectionIds': [201],
             'transactionIds': [201], 'exit': {'code': None, 'signal': 'SIGKILL'},
             'databaseConnectionsGone': True, 'noWorkSentBeforeReady': False}]
        original_text = json.dumps(observations)
        runtime = next(row for row in observations if row['kind'] == 'realRuntime')
        expected = {'schema': runtime['schema']}
        sid = 'inventory-task041-safety'
        self.assertEqual(self.gate.hd235_fixture_terminal_issues(sid, original_text, expected), [])
        stop_index = next(index for index, row in enumerate(observations) if row['kind'] == 'ownedChildTerminated')
        for exit_state in ({'code': 0, 'signal': None}, {'code': None, 'signal': 'SIGKILL'}):
            changed = copy.deepcopy(observations)
            changed[stop_index]['exit'] = exit_state
            self.assertEqual(self.gate.hd235_fixture_terminal_issues(sid, json.dumps(changed), expected), [])
        no_work = copy.deepcopy(observations)
        no_work[stop_index].update(connectionIds=[], transactionIds=[], noWorkSentBeforeReady=True,
                                   databaseConnectionsGone=False)
        self.assertEqual(self.gate.hd235_fixture_terminal_issues(sid, json.dumps(no_work), expected), [])
        mutations = ('foreign-schema', 'runtime-version', 'runtime-synthetic', 'runtime-parent',
                     'duplicate-runtime', 'missing-events', 'child-pid', 'missing-ids', 'duplicate-ids',
                     'boolean-id', 'foreign-transaction-id', 'sql-not-gone', 'bad-exit',
                     'unapproved-signal', 'unexpected-sigterm', 'inconsistent-exit')
        runtime_index = observations.index(runtime)
        for mutation in mutations:
            with self.subTest(supporting_safety_parser=mutation):
                changed = copy.deepcopy(observations)
                stop = changed[stop_index]
                if mutation == 'foreign-schema': changed[runtime_index]['schema'] = 'foreign_schema'
                elif mutation == 'runtime-version': changed[runtime_index]['mysql'] = '8.0.0'
                elif mutation == 'runtime-synthetic': changed[runtime_index]['synthetic'] = False
                elif mutation == 'runtime-parent': changed[runtime_index]['parentPid'] = 0
                elif mutation == 'duplicate-runtime': changed.append(copy.deepcopy(runtime))
                elif mutation == 'missing-events': changed = [row for row in changed if row['kind'] != 'ownedChildTerminated']
                elif mutation == 'child-pid': stop['pid'] = 0
                elif mutation == 'missing-ids': stop['connectionIds'] = []
                elif mutation == 'duplicate-ids': stop['connectionIds'] = [61, 61]
                elif mutation == 'boolean-id': stop['connectionIds'] = [True]
                elif mutation == 'foreign-transaction-id': stop['transactionIds'] = [max(stop['connectionIds']) + 1000000]
                elif mutation == 'sql-not-gone': stop['databaseConnectionsGone'] = False
                elif mutation == 'bad-exit': stop['exit'] = {'code': 1, 'signal': None}
                elif mutation == 'unapproved-signal': stop['exit'] = {'code': None, 'signal': 'SIGABRT'}
                elif mutation == 'unexpected-sigterm': stop['exit'] = {'code': None, 'signal': 'SIGTERM'}
                else: stop['exit'] = {'code': 0, 'signal': 'SIGKILL'}
                self.assertTrue(self.gate.hd235_fixture_terminal_issues(sid, json.dumps(changed), expected), mutation)
        self.assertTrue(self.gate.hd235_fixture_terminal_issues(sid, '{malformed-json', expected))

    def test_GB_U57_ipc_exit_zero_without_ack_or_sql_terminal_rejects(self):
        self.hd235_receipt('MYSQL_IPC_PROCESS')
        self.assertEqual(self.hd235_runtime(), [])
        self.receipt['observation']['nativeOwnership']['ownedStops'][0]['gracefulReply'] = None
        self.bind_native_report(self.receipt)
        self.assertTrue(self.hd235_runtime())
        self.hd235_receipt('MYSQL_IPC_PROCESS')
        self.receipt['native_report']['raw']['ownedSql']['workers'][0]['latest'][0]['terminal'] = False
        self.seal_native_report(self.receipt)
        self.assertTrue(self.hd235_runtime())

        # SYNTHETIC_PARSER_SHAPE_ONLY: faithful JUnit/comment layout, never native PASS.
        import xml.etree.ElementTree as ET
        fixture = ET.Element('testsuites')
        diagnostics = {
            8: {'generatedSize': 2048, 'clientBodyBytes': 1024, 'nativeReadsStarted': 1,
                'barrierReleased': False, 'endObserved': False, 'prematureClose': True,
                'positiveExit': {'code': None, 'signal': 'SIGKILL'}},
            11: {'observedWait': {'threadId': 202, 'state': 'Waiting for table metadata lock'},
                 'positiveExit': {'code': None, 'signal': 'SIGKILL'},
                 'exitBeforeBlockerRelease': True, 'recordedIds': [201, 202],
                 'terminalSqlObservations': [
                     {'elapsedMs': 0, 'state': {'processIds': [202], 'transactions': [{'threadId': 202}]}},
                     {'elapsedMs': 1, 'state': {'processIds': [], 'transactions': []}}]},
            17: {'rounds': [{'round': number, 'kind': kind,
                    'positiveExit': {'code': None, 'signal': 'SIGKILL'} if kind == 'crash' else {'code': 0, 'signal': None},
                    'terminalSql': [{'elapsedMs': 0, 'state': {'processIds': [], 'transactions': []}}]}
                for number, kind in enumerate(('normal', 'abort', 'fail', 'crash', 'normal',
                                                'abort', 'fail', 'crash', 'normal', 'normal'), 1)]}}
        for number in range(1, 19):
            ET.SubElement(fixture, 'testcase', name='ST041-ED%02d SYNTHETIC_PARSER_SHAPE_ONLY' % number)
            if number in diagnostics: fixture.append(ET.Comment(json.dumps(diagnostics[number])))
        for summary in ('tests 18', 'pass 18', 'fail 0', 'skipped 0'): fixture.append(ET.Comment(summary))
        original_text = ET.tostring(fixture, encoding='unicode')
        sid = 'inventory-task041-export-recovery-process'
        self.assertEqual(self.gate.hd235_fixture_terminal_issues(sid, original_text, {}), [])

        def export_tree():
            return ET.fromstring(original_text, parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))

        def case_and_comment(root, case_id):
            previous = None
            for child in root:
                if child.tag == 'testcase': previous = child
                elif child.tag is ET.Comment and previous is not None and case_id in previous.attrib['name']:
                    if (child.text or '').strip().startswith(('{', '[')): return previous, child
            self.fail('Original parser fixture lacks diagnostic for ' + case_id)

        mutations = ('missing-case', 'duplicate-case', 'skipped-case', 'failed-case', 'missing-ed08-exit',
                     'wrong-ed08-signal', 'wrong-ed11-exit', 'missing-ed11-comment', 'missing-recorded-ids',
                     'nonterminal-process', 'nonterminal-transaction', 'malformed-json-comment',
                     'nonterminal-nested-round', 'missing-nested-terminal', 'unapproved-nested-signal',
                     'crash-normal-exit', 'normal-killed-exit', 'wrong-comment-association')
        for mutation in mutations:
            with self.subTest(supporting_export_parser=mutation):
                tree = export_tree()
                ed08_case, ed08_comment = case_and_comment(tree, 'ST041-ED08 ')
                ed11_case, ed11_comment = case_and_comment(tree, 'ST041-ED11 ')
                _ed17_case, ed17_comment = case_and_comment(tree, 'ST041-ED17 ')
                ed08, ed11, ed17 = (json.loads(comment.text) for comment in (ed08_comment, ed11_comment, ed17_comment))
                if mutation == 'missing-case': tree.remove(next(case for case in tree if case.tag == 'testcase' and 'ST041-ED18 ' in case.attrib['name']))
                elif mutation == 'duplicate-case': tree.append(copy.deepcopy(ed08_case))
                elif mutation in ('skipped-case', 'failed-case'):
                    ed08_case.append(ET.Element('skipped' if mutation == 'skipped-case' else 'failure'))
                elif mutation == 'missing-ed08-exit': del ed08['positiveExit']
                elif mutation == 'wrong-ed08-signal': ed08['positiveExit']['signal'] = 'SIGABRT'
                elif mutation == 'wrong-ed11-exit': ed11['positiveExit'] = {'code': 1, 'signal': None}
                elif mutation == 'missing-ed11-comment': tree.remove(ed11_comment)
                elif mutation == 'missing-recorded-ids': ed11['recordedIds'] = []
                elif mutation == 'nonterminal-process': ed11['terminalSqlObservations'][-1]['state']['processIds'] = [53]
                elif mutation == 'nonterminal-transaction': ed11['terminalSqlObservations'][-1]['state']['transactions'] = [{'threadId': 53}]
                elif mutation == 'malformed-json-comment': ed08_comment.text = '{"broken":'
                elif mutation == 'nonterminal-nested-round': ed17['rounds'][0]['terminalSql'][-1]['state']['processIds'] = [999]
                elif mutation == 'missing-nested-terminal': ed17['rounds'][0]['terminalSql'] = []
                elif mutation == 'unapproved-nested-signal': ed17['rounds'][0]['positiveExit'] = {'code': None, 'signal': 'SIGABRT'}
                elif mutation == 'crash-normal-exit':
                    next(row for row in ed17['rounds'] if row['kind'] == 'crash')['positiveExit'] = {'code': 0, 'signal': None}
                elif mutation == 'normal-killed-exit':
                    next(row for row in ed17['rounds'] if row['kind'] == 'normal')['positiveExit'] = {'code': None, 'signal': 'SIGKILL'}
                else:
                    tree.remove(ed08_comment)
                    tree.insert(list(tree).index(ed11_case), ed08_comment)
                if mutation != 'malformed-json-comment': ed08_comment.text = json.dumps(ed08)
                ed11_comment.text = json.dumps(ed11)
                ed17_comment.text = json.dumps(ed17)
                self.assertTrue(self.gate.hd235_fixture_terminal_issues(sid, ET.tostring(tree, encoding='unicode'), {}), mutation)
        self.assertTrue(self.gate.hd235_fixture_terminal_issues('arbitrary-fixture', original_text, {}))
        self.assertTrue(self.gate.hd235_fixture_terminal_issues(sid, '<testsuites><testcase', {}),
                        'Malformed XML must return an issue instead of escaping as a parser exception')

    def test_GB_U58_recipe_substitution_cannot_supply_another_transport(self):
        for transport in ('FILES_DIRECT', 'MYSQL_DIRECT', 'MYSQL_HTTP', 'MYSQL_IPC_PROCESS'):
            self.hd235_receipt(transport)
            self.assertEqual(self.hd235_runtime(), [])
            self.hd235_policy['recipe']['transport'] = 'MYSQL_HTTP' if transport == 'FILES_DIRECT' else 'FILES_DIRECT'
            self.assertTrue(self.hd235_runtime(), transport)

        # SYNTHETIC_VERIFIER_ONLY: browser receipt shapes never mean Playwright ran.
        self.suite['argv'] = ['npx', 'playwright', 'test', '--config', 'synthetic-playwright.config.js']
        self.raw['command'] = copy.deepcopy(self.suite['argv'])
        self.raw['command_contract_sha256'] = synthetic_contract_hash(self.suite)
        originals = {}
        for transport in ('BROWSER_DECLARED_MOCK', 'BROWSER_REAL_APP'):
            self.hd235_receipt(transport)
            if transport == 'BROWSER_REAL_APP':
                text = '<testsuites><testcase name="SYNTHETIC_REAL_APP_SHAPE_NOT_EXECUTION"/></testsuites>\n'
                native = self.receipt['http']['native_report']
                native.update(original_text=text, sha256=hashlib.sha256(text.encode()).hexdigest())
                self.receipt['http']['format'] = 'ORIGINAL_JUNIT'
                self.hd235_policy['http']['required_native_report_hash'] = native['sha256']
            with self.subTest(synthetic_browser_receipt=transport):
                self.assertEqual(self.hd235_runtime(), [])
                originals[transport] = copy.deepcopy((self.receipt, self.hd235_policy))
                for mutation in ('missing-browser', 'wrong-mode', 'wrong-config', 'foreign-origin',
                                 'duplicate-role', 'live-port', 'playwright-failed', 'binaries-missing'):
                    with self.subTest(browser_counterexample=mutation):
                        self.receipt, self.hd235_policy = copy.deepcopy(originals[transport])
                        browser = self.receipt['observation']['browser']
                        if mutation == 'missing-browser': del self.receipt['observation']['browser']
                        elif mutation == 'wrong-mode': browser['mode'] = 'REAL_APP' if transport == 'BROWSER_DECLARED_MOCK' else 'EXPLICIT_EXISTING_MOCK'
                        elif mutation == 'wrong-config': browser['config'] = 'unapproved-playwright.config.js'
                        elif mutation == 'foreign-origin': browser['origins'][0]['url'] = 'http://203.0.113.7:4101'
                        elif mutation == 'duplicate-role': browser['origins'].append(copy.deepcopy(browser['origins'][0]))
                        elif mutation == 'live-port': browser['origins'][0]['terminal'] = False
                        elif mutation == 'playwright-failed': browser['originalPlaywrightPassed'] = False
                        else: browser['binariesCaptured'] = False
                        self.assertTrue(self.hd235_runtime(), mutation)
        self.receipt, self.hd235_policy = copy.deepcopy(originals['BROWSER_DECLARED_MOCK'])
        self.assertNotIn('mysql', self.receipt['observation'])
        self.assertNotIn('schema', self.receipt['binding'])
        self.receipt, self.hd235_policy = copy.deepcopy(originals['BROWSER_REAL_APP'])
        del self.receipt['observation']['mysql']
        self.assertTrue(self.hd235_runtime(), 'Real app browser evidence still requires its real MySQL owner')
        self.receipt, self.hd235_policy = copy.deepcopy(originals['BROWSER_REAL_APP'])
        del self.receipt['http']['native_report']
        self.assertTrue(self.hd235_runtime(), 'Real app browser outcome requires pinned original HTTP JUnit')
        self.receipt, self.hd235_policy = copy.deepcopy(originals['BROWSER_REAL_APP'])
        self.receipt['recipe']['transport'] = self.hd235_policy['recipe']['transport'] = 'BROWSER_DECLARED_MOCK'
        self.receipt['observation']['browser'] = copy.deepcopy(originals['BROWSER_DECLARED_MOCK'][0]['observation']['browser'])
        self.assertTrue(self.hd235_runtime(), 'A declared mock must not borrow a real app database receipt')

        # SYNTHETIC_TYPED_METADATA_ONLY: this does not launch or authenticate a CLI process.
        import os
        workspace, uid = '/synthetic/hd235-cli-workspace', os.getuid()
        workspace_hash = hashlib.sha1(workspace.encode()).hexdigest()[:16]
        cache_root = str(Path.home() / 'Library/Caches/ms-playwright/daemon' / workspace_hash)

        def cli_record(prefix):
            name = prefix + '1234abcd'
            return {'workspace': workspace, 'workspaceCreatedPrivate': True, 'cacheRoot': cache_root,
                'sessions': [{'name': name, 'channel': 'chrome', 'attached': False, 'persistent': False,
                    'daemon': {'pid': 1101, 'pgid': 1101, 'startedAt': '2020-01-01T00:00:00Z',
                               'commandSha256': 'a' * 64, 'groupTerminal': True},
                    'browser': {'pid': 1102, 'pgid': 1102, 'ppid': 1101, 'startedAt': '2020-01-01T00:00:00Z',
                                'commandSha256': 'b' * 64, 'groupTerminal': True},
                    'socket': {'path': '/tmp/pw-abcdef12/cli/' + workspace_hash + '-' + name + '.sock',
                               'uid': uid, 'dev': 1, 'ino': 101, 'terminal': True},
                    'sessionFile': {'path': cache_root + '/' + name + '.session', 'sha256': 'c' * 64, 'terminal': True},
                    'profile': {'path': '/tmp/playwright_chromiumdev_profile-AbCdEf',
                                'uid': uid, 'dev': 1, 'ino': 102, 'terminal': True},
                    'close': {'observed': True, 'pid': 1103, 'startedAtLowerBound': '2020-01-01T00:00:01Z',
                              'observedLiveAt': '2020-01-01T00:00:01.010Z',
                              'groupsAtStart': [
                                  {'pid': 1101, 'pgid': 1101, 'startedAt': '2020-01-01T00:00:00Z', 'commandSha256': 'a' * 64},
                                  {'pid': 1102, 'pgid': 1102, 'startedAt': '2020-01-01T00:00:00Z', 'commandSha256': 'b' * 64}],
                              'observedGoneAt': '2020-01-01T00:00:01.205Z', 'elapsedUpperBoundMs': 205}}]}

        for prefix in ('st039-', 'st040-'):
            record = cli_record(prefix)
            frozen = copy.deepcopy(record)
            self.assertEqual(self.gate.hd235_cli_terminal_issues(record, workspace, uid, prefix), [])
            self.assertEqual(record, frozen, 'Pure terminal metadata validation must preserve the record')
            mutations = ('wrong-workspace', 'nonprivate-workspace', 'cache-escape', 'wrong-name', 'wrong-channel',
                         'attached-session', 'persistent-session', 'missing-session', 'duplicate-session',
                         'missing-daemon', 'daemon-pgid', 'browser-pgid', 'browser-parent', 'same-process',
                         'daemon-command', 'browser-command', 'socket-uid', 'socket-dev', 'socket-inode',
                         'socket-basename', 'socket-root', 'session-file-path', 'session-file-hash',
                         'profile-root', 'profile-uid', 'profile-dev', 'profile-inode', 'live-socket',
                         'live-session-file', 'live-profile', 'live-daemon-group', 'live-browser-group',
                         'unobserved-close', 'invalid-close-pid', 'negative-elapsed', 'deadline-elapsed',
                         'over-deadline', 'inconsistent-elapsed', 'reversed-close-time', 'invalid-close-time',
                         'late-browser-start', 'missing-start-groups', 'empty-start-groups', 'duplicate-start-group',
                         'missing-browser-start-group', 'wrong-start-pid', 'wrong-start-birth',
                         'wrong-start-command', 'wrong-start-pgid', 'missing-live-at', 'live-before-close',
                         'live-after-gone')
            for mutation in mutations:
                with self.subTest(synthetic_cli_terminal=prefix + mutation):
                    changed = copy.deepcopy(record)
                    session = changed['sessions'][0]
                    if mutation == 'wrong-workspace': changed['workspace'] = '/synthetic/foreign-workspace'
                    elif mutation == 'nonprivate-workspace': changed['workspaceCreatedPrivate'] = False
                    elif mutation == 'cache-escape': changed['cacheRoot'] = str(Path.home() / 'Library/Caches/ms-playwright/daemon/foreign')
                    elif mutation == 'wrong-name': session['name'] = 'foreign-' + '1234abcd'
                    elif mutation == 'wrong-channel': session['channel'] = 'chromium'
                    elif mutation == 'attached-session': session['attached'] = True
                    elif mutation == 'persistent-session': session['persistent'] = True
                    elif mutation == 'missing-session': changed['sessions'] = []
                    elif mutation == 'duplicate-session': changed['sessions'].append(copy.deepcopy(session))
                    elif mutation == 'missing-daemon': del session['daemon']
                    elif mutation == 'daemon-pgid': session['daemon']['pgid'] = 999
                    elif mutation == 'browser-pgid': session['browser']['pgid'] = 999
                    elif mutation == 'browser-parent': session['browser']['ppid'] = 999
                    elif mutation == 'same-process': session['browser']['pid'] = session['browser']['pgid'] = session['daemon']['pid']
                    elif mutation == 'daemon-command': session['daemon']['commandSha256'] = 'not-a-hash'
                    elif mutation == 'browser-command': session['browser']['commandSha256'] = ''
                    elif mutation == 'socket-uid': session['socket']['uid'] = uid + 1
                    elif mutation == 'socket-dev': session['socket']['dev'] = 0
                    elif mutation == 'socket-inode': session['socket']['ino'] = -1
                    elif mutation == 'socket-basename': session['socket']['path'] = '/tmp/pw-abcdef12/cli/foreign-session.sock'
                    elif mutation == 'socket-root': session['socket']['path'] = '/tmp/foreign/cli/' + workspace_hash + '-' + session['name'] + '.sock'
                    elif mutation == 'session-file-path': session['sessionFile']['path'] = cache_root + '/foreign.session'
                    elif mutation == 'session-file-hash': session['sessionFile']['sha256'] = 'f' * 63
                    elif mutation == 'profile-root': session['profile']['path'] = '/tmp/foreign-profile'
                    elif mutation == 'profile-uid': session['profile']['uid'] = uid + 1
                    elif mutation == 'profile-dev': session['profile']['dev'] = 0
                    elif mutation == 'profile-inode': session['profile']['ino'] = None
                    elif mutation == 'live-socket': session['socket']['terminal'] = False
                    elif mutation == 'live-session-file': session['sessionFile']['terminal'] = False
                    elif mutation == 'live-profile': session['profile']['terminal'] = False
                    elif mutation == 'live-daemon-group': session['daemon']['groupTerminal'] = False
                    elif mutation == 'live-browser-group': session['browser']['groupTerminal'] = False
                    elif mutation == 'unobserved-close': session['close']['observed'] = False
                    elif mutation == 'invalid-close-pid': session['close']['pid'] = 0
                    elif mutation == 'negative-elapsed': session['close']['elapsedUpperBoundMs'] = -1
                    elif mutation == 'deadline-elapsed': session['close']['elapsedUpperBoundMs'] = 30000
                    elif mutation == 'over-deadline': session['close']['elapsedUpperBoundMs'] = 30001
                    elif mutation == 'inconsistent-elapsed': session['close']['elapsedUpperBoundMs'] = 100
                    elif mutation == 'reversed-close-time': session['close']['observedGoneAt'] = '2020-01-01T00:00:00Z'
                    elif mutation == 'invalid-close-time': session['close']['observedGoneAt'] = 'invalid'
                    elif mutation == 'late-browser-start': session['browser']['startedAt'] = '2020-01-01T00:00:02Z'
                    elif mutation == 'missing-start-groups': del session['close']['groupsAtStart']
                    elif mutation == 'empty-start-groups': session['close']['groupsAtStart'] = []
                    elif mutation == 'duplicate-start-group': session['close']['groupsAtStart'][1] = copy.deepcopy(session['close']['groupsAtStart'][0])
                    elif mutation == 'missing-browser-start-group': session['close']['groupsAtStart'].pop()
                    elif mutation == 'wrong-start-pid': session['close']['groupsAtStart'][1]['pid'] = 999
                    elif mutation == 'wrong-start-birth': session['close']['groupsAtStart'][1]['startedAt'] = '2019-01-01T00:00:00Z'
                    elif mutation == 'wrong-start-command': session['close']['groupsAtStart'][1]['commandSha256'] = 'd' * 64
                    elif mutation == 'wrong-start-pgid': session['close']['groupsAtStart'][1]['pgid'] = 999
                    elif mutation == 'missing-live-at': del session['close']['observedLiveAt']
                    elif mutation == 'live-before-close': session['close']['observedLiveAt'] = '2020-01-01T00:00:00.999Z'
                    else: session['close']['observedLiveAt'] = '2020-01-01T00:00:01.206Z'
                    self.assertTrue(self.gate.hd235_cli_terminal_issues(changed, workspace, uid, prefix), mutation)

        import re
        producer = Path(__file__).resolve().parents[2] / 'docs/inventory_management/implementation/task041-hd235-verification-runtime.mjs.txt'
        helper = re.search(r'^function cliGroupTerminal\([^\n]+', producer.read_text(), re.MULTILINE)
        self.assertIsNotNone(helper)
        observed = self.hd235_node_probe("""
import assert from 'node:assert/strict';
""" + helper.group() + """
const original=process.kill;
const checks=[];
try {
  for(const code of ['EPERM','ESRCH',null]) {
    process.kill=()=>{if(code)throw Object.assign(new Error(code),{code});};
    checks.push(cliGroupTerminal(1234));
  }
  process.kill=()=>{throw Object.assign(new Error('unknown'),{code:'EIO'});};
  assert.throws(()=>cliGroupTerminal(1234),{code:'EIO'});
} finally {process.kill=original;}
console.log(JSON.stringify(checks));
""")
        self.assertEqual(observed, [False, True, False], 'EPERM remains unproven, never terminal; only ESRCH proves absence')

    def test_GB_U59_later_equivalent_failure_blocks_without_erasing_attempts(self):
        attempts = [self.attempt('PASS', '2020-01-01T00:01:00Z')]
        self.assertIs(self.gate.select_latest(attempts), attempts[0])
        attempts.append(self.attempt('FAIL', '2020-01-01T00:02:00Z'))
        original = copy.deepcopy(attempts)
        with self.assertRaises(self.gate.Blocked) as blocked: self.gate.select_latest(attempts)
        self.assertEqual(blocked.exception.code, 'LATEST_ATTEMPT_NOT_PASS')
        self.assertEqual(attempts, original)

    def test_GB_U60_unknown_later_or_equal_timestamp_cannot_be_excluded(self):
        first = self.attempt('PASS', '2020-01-01T00:01:00Z')
        self.assertIs(self.gate.select_latest([first]), first)
        later = self.attempt('PASS', '2020-01-01T00:02:00Z')
        later['classification'] = {'kind': 'NON_EQUIVALENT', 'verified': False}
        with self.assertRaises(self.gate.Blocked) as blocked: self.gate.select_latest([first, later])
        self.assertEqual(blocked.exception.code, 'LATER_EQUIVALENCE_UNKNOWN')
        with self.assertRaises(self.gate.Blocked) as blocked: self.gate.select_latest([first, copy.deepcopy(first)])
        self.assertEqual(blocked.exception.code, 'ATTEMPT_ORDER_AMBIGUOUS')

    def test_GB_U61_typed_failure_retained_before_validation_missing_run_blocked(self):
        attempt = self.gate.hd235_attempt(self.raw, self.suite, self.raw['source_fingerprint'], self.raw['spec_baseline'])
        self.assertEqual(attempt['classification']['kind'], 'EXACT')
        self.raw['result'], self.raw['exit_code'] = 'FAIL', 1
        attempt = self.gate.hd235_attempt(self.raw, self.suite, self.raw['source_fingerprint'], self.raw['spec_baseline'])
        self.assertEqual(attempt['raw'], self.raw)
        self.assertEqual(attempt['raw']['result'], 'FAIL')
        with self.assertRaises(self.gate.Blocked): self.gate.select_latest([attempt])
        with self.assertRaises(self.gate.Blocked) as blocked:
            self.gate.hd235_attempt(None, self.suite, 'a' * 64, 'b' * 64)
        self.assertEqual(blocked.exception.code, 'REQUIRED_RUN_MISSING')
        producer = Path(__file__).resolve().parents[2] / 'docs/inventory_management/implementation/task041-hd235-verification-runtime.mjs.txt'
        result = self.hd235_node_probe("""
import fs from 'node:fs/promises';
const text = await fs.readFile(input,'utf8');
const body = text.slice(text.indexOf('async function registerTyped('),text.indexOf('async function publishReceiptReferences('));
const execute = new Function('return (async()=>{'+
 `const labels=new Set(),processes=[],repo='/synthetic',python='synthetic-python',harness='/synthetic/harness',baseEnv={};
 const assert={deepEqual(a,b){if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Result mismatch');}};
 const bounded=async work=>work,groupEnd=async()=>{};
 const launch=async(_exe,_args,_env,label)=>{if(labels.has(label))throw Error('EEXIST log collision');labels.add(label);processes.push(label);return{exit:Promise.resolve({code:0,signal:null})};};`
 +body+`await registerTyped('evidence/synthetic/run.json','synthetic-hash');
 await registerTyped('evidence/synthetic/run.json','synthetic-hash');return [...labels];})()`);
try { console.log(JSON.stringify({accepted:true,labels:await execute()})); }
catch(error){console.log(JSON.stringify({accepted:false,error:error.message}));}
""", str(producer))
        self.assertTrue(result['accepted'], result)
        self.assertEqual(len(set(result['labels'])), 2, 'A cleanup-time repeat must not overwrite an earlier CAS log')

        for scenario in ('positive', 'native-exit1'):
            with self.subTest(synthetic_hd236_mechanics=scenario):
                self.hd236_native_mechanics(scenario)

    def test_GB_U62_live_receipt_blocks_until_final_encompassing_cleanup(self):
        self.hd235_receipt()
        self.assertEqual(self.hd235_runtime(), [])
        obs = self.receipt['observation']
        preflight = copy.deepcopy(obs['processes'][0])
        preflight.update(label='live-preflight', result={'code': 1, 'signal': None})
        obs['processes'].append(preflight)
        obs['commands'].append({'label': 'live-preflight', 'cwd': self.expected['workspace'],
            'args': [self.expected['workspace'] + '/server/scripts/inventoryPhase005Gate.py',
                '--receipt-preflight', '--suite', self.raw['suite_id'], '--phase', 'PHASE-005',
                '--module', 'docs/inventory_management', '--repo-root', self.expected['workspace'],
                '--harness-scripts', '/Users/sam/.agents/skills/software-engineering-harness/scripts', '--json']})
        self.assertEqual(self.hd235_runtime(), [], 'Live BLOCKED exit1 must not invalidate final normal completion')
        obs['commands'][-1]['args'][1] = '--unknown-command'
        self.assertTrue(self.hd235_runtime(), 'Only the exact live preflight may finish with expected BLOCKED')
        for mutation in ('live', 'future', 'unregistered'):
            self.hd235_receipt()
            lifecycle = self.receipt['recipe']['lifecycle']
            if mutation == 'live': lifecycle['state'] = 'LIVE'
            elif mutation == 'future': lifecycle['finalized_at'] = '2999-01-01T00:00:00Z'
            else: lifecycle['registered_before_validation'] = False
            self.assertTrue(self.hd235_runtime(), mutation)

    def test_GB_U63_cleanup_cannot_claim_rollback_or_forced_normal_exit(self):
        self.hd235_receipt('MYSQL_IPC_PROCESS')
        self.assertEqual(self.hd235_runtime(), [])
        self.receipt['recipe']['claims'] = ['applicationrollback']
        self.assertTrue(self.hd235_runtime())
        self.hd235_receipt('MYSQL_IPC_PROCESS')
        stop = self.receipt['observation']['nativeOwnership']['ownedStops'][0]
        stop.update(forced=True, exit={'code': 0, 'signal': None})
        self.bind_native_report(self.receipt)
        self.assertTrue(self.hd235_runtime())

    def test_GB_U64_present_snapshot_cannot_backfill_historical_missing_inputs(self):
        self.hd233_mapping()
        self.assertEqual(self.classify()['kind'], 'ADMIN_EQUIVALENT')
        inputs = self.proof['hd233']['installed_inputs']
        del inputs['before']['python/imported/json.py']
        inputs['present_snapshot'] = copy.deepcopy(inputs['after'])
        inputs['same_versions'] = True
        self.assertEqual(self.classify()['kind'], 'UNKNOWN')

    def test_GB_U65_historical_mapping_rejects_create_lock_and_business_delta(self):
        self.hd233_mapping()
        self.assertEqual(self.classify()['kind'], 'ADMIN_EQUIVALENT')
        for name in ('server/src/services/InventoryLockService.js',
                     'server/src/services/InventoryStocktakeService.js', 'server/src/synthetic.js'):
            self.hd233_mapping()
            self.proof['before_source_map'][name] = entry('a')
            self.proof['current_source_map'][name] = entry('f')
            self.assertEqual(self.classify()['kind'], 'UNKNOWN', name)

    def test_GB_U66_observational_tools_cannot_prove_changed_executed_inputs(self):
        self.hd233_mapping()
        self.assertEqual(self.classify()['kind'], 'ADMIN_EQUIVALENT')
        self.proof['hd233']['installed_inputs']['after']['node_modules/synthetic/index.js'] = entry('f')
        self.proof['hd233']['all_observational_tools_reviewed'] = True
        self.assertEqual(self.classify()['kind'], 'UNKNOWN')

        # HD235 business receipts may retain proved observational tool deltas;
        # their original within-run inputs and tool-suite obligations stay exact.
        core = SimpleNamespace(digest=lambda value: synthetic_contract_hash(value), current_commit=lambda repo: '0' * 40)
        repo = Path('/synthetic/repo')
        suite = copy.deepcopy(self.suite)
        suite['id'] = 'inventory-task036-unit'
        raw = dict(copy.deepcopy(self.raw), suite_id=suite['id'], code_commit='0' * 40)
        raw['command_contract_sha256'] = synthetic_contract_hash(suite)
        names = sorted(self.gate.HD235_OBSERVATIONAL_PATHS)
        records = [[name, False, 'a' * 64] for name in names] + [
            ['server/src/app.js', False, 'b' * 64], ['server/test/business.test.js', False, 'c' * 64]]
        raw['source_fingerprint'] = core.digest(records)
        groups = {key: {'captured': True} for key in ('node', 'python', 'mysql', 'harness', 'path', 'tools')}
        groups['node']['installedInputs'] = {'node_modules/actual.js': {'sha256': 'd' * 64}}
        groups['python'] = {'files': {'python': {'sha256': 'e' * 64}},
            'importFiles': {str(repo / name): {'sha256': 'a' * 64, 'executable': False} for name in names}}
        groups['harness']['files'] = {'harness': {'sha256': 'e' * 64}}
        groups['path'] = {key: {'realpath': '/synthetic/' + key, 'sha256': 'e' * 64}
                          for key in ('node', 'mysql', 'git', 'python')}
        groups['tools']['sourceMap'] = {'source_fingerprint': raw['source_fingerprint'], 'records': records}
        obs = {'selectedSuite': copy.deepcopy(suite), 'sourceFreeze': 'MATCHED',
               'hashesBefore': {'hd233Inputs': copy.deepcopy(groups)}, 'hashesAfter': {'hd233Inputs': groups}}
        current = self.gate.source_map(records)
        for name in names: current[name] = entry('f')
        original_obs = copy.deepcopy(obs)
        def project(raw_value=raw, suite_value=suite, current_value=current, observation=obs, plan=None):
            return self.gate.hd235_observational_applicability(raw_value, suite_value, 'f' * 64,
                current_value, plan or raw['spec_baseline'], observation, core, repo)
        classification, projected = project()
        self.assertEqual(classification['kind'], 'ADMIN_EQUIVALENT')
        self.assertEqual(obs, original_obs, 'Projection must not rewrite archived observations')
        self.assertEqual(projected['node'], groups['node'], 'Actual installed inputs remain strict')
        for name in names:
            self.assertEqual(projected['python']['importFiles'][str(repo / name)]['sha256'], 'f' * 64)
        for name in ('server/src/app.js', 'server/test/business.test.js', 'docs/another-module/design.md'):
            changed = copy.deepcopy(current)
            changed[name] = entry('f')
            with self.assertRaises(self.gate.Blocked): project(current_value=changed)
        for field, value in (('argv', ['wrong-command']), ('env_keys', ['WRONG_ENV'])):
            changed = copy.deepcopy(suite)
            changed[field] = value
            with self.assertRaises(self.gate.Blocked): project(suite_value=changed)
        with self.assertRaises(self.gate.Blocked): project(plan='f' * 64)
        for mutation in ('dependency', 'within-run-tool', 'failed-freeze'):
            changed = copy.deepcopy(obs)
            if mutation == 'dependency': changed['hashesAfter']['hd233Inputs']['node']['installedInputs']['node_modules/actual.js']['sha256'] = 'f' * 64
            elif mutation == 'within-run-tool': changed['hashesAfter']['hd233Inputs']['python']['files']['python']['sha256'] = 'f' * 64
            else: changed['sourceFreeze'] = 'MISMATCHED'
            with self.assertRaises(self.gate.Blocked): project(observation=changed)
        for mutation in ('mode', 'symlink', 'missing-observational-record'):
            changed, observation = copy.deepcopy(current), copy.deepcopy(obs)
            if mutation == 'mode': changed[names[0]]['mode'] = '100755'
            elif mutation == 'symlink': changed[names[0]]['symlink'] = 'other-target'
            else:
                for side in ('hashesBefore', 'hashesAfter'):
                    del observation[side]['hd233Inputs']['python']['importFiles'][str(repo / names[0])]
            with self.assertRaises(self.gate.Blocked): project(current_value=changed, observation=observation)
        for sid in ('lint', 'inventory-task041-gate-binding-unit', 'inventory-task041-gate-binding-native', 'inventory-task039-unit'):
            changed_raw, changed_suite, observation = copy.deepcopy(raw), copy.deepcopy(suite), copy.deepcopy(obs)
            changed_raw['suite_id'] = changed_suite['id'] = sid
            changed_raw['command_contract_sha256'] = synthetic_contract_hash(changed_suite)
            observation['selectedSuite'] = copy.deepcopy(changed_suite)
            with self.assertRaises(self.gate.Blocked): project(changed_raw, changed_suite, observation=observation)
        with mock.patch.object(self.gate, 'HD235_COORDINATOR_SHA',
                               '866139fa5ef822aefa18fd017d5ec79d1090ec03d90b7c6269e32054cd77210f'):
            for digest in ('27f5c7b01c8cd0a9837b108ff7f266c240fcf7cd11dbcb18064f7fbfb51182aa',
                           '866139fa5ef822aefa18fd017d5ec79d1090ec03d90b7c6269e32054cd77210f'):
                roles = self.gate.hd235_output_roles(digest, 'inventory-task039-browser')
                self.assertEqual('server/logs' in roles, not digest.startswith('27f5c7'))
            old_sha = '27f5c7b01c8cd0a9837b108ff7f266c240fcf7cd11dbcb18064f7fbfb51182aa'
            with self.assertRaises(self.gate.Blocked): self.gate.hd235_output_roles(old_sha, 'inventory-p3-browser-regression')
            with mock.patch.dict(self.gate.HD235_GENERATED_OUTPUTS, {'inventory-task039-browser': ['future-output']}):
                self.assertEqual(self.gate.hd235_output_roles(old_sha, 'inventory-task039-browser'), ['client/node_modules/.vite/deps'])
        with mock.patch.object(self.gate, 'HD235_COORDINATOR_SHA', old_sha), \
             mock.patch.dict(self.gate.HD235_GENERATED_OUTPUTS, {'inventory-task039-browser': ['future-output']}):
            self.assertEqual(self.gate.hd235_output_roles(
                '866139fa5ef822aefa18fd017d5ec79d1090ec03d90b7c6269e32054cd77210f',
                'inventory-task039-browser'), ['client/node_modules/.vite/deps', 'server/logs'])
        with self.assertRaises(self.gate.Blocked): self.gate.hd235_output_roles('f' * 64, suite['id'])
        good = {'raw': raw, 'classification': classification}
        for failure in ('FAIL', 'UNKNOWN'):
            later = copy.deepcopy(good)
            later['raw']['ended_at'] = '2020-01-01T00:02:00Z'
            if failure == 'FAIL': later['raw']['result'] = 'FAIL'
            else: later['classification'].update(kind='UNKNOWN', verified=False)
            with self.assertRaises(self.gate.Blocked): self.gate.select_latest([good, later])
        boundary = SyntheticCoreBoundary([issue('OTHER_GATE_STAYS')])
        result = self.gate.validate_attempt(self.ctx, suite, raw, classification, [], boundary)
        self.assertTrue(any(row['code'] == 'OTHER_GATE_STAYS' for row in result['issues']))
        self.assertIs(boundary.calls[0][1], raw, 'Original direct core validation still runs')

        with tempfile.TemporaryDirectory(prefix='hd235-projection-current-') as directory:
            actual_repo = Path(directory).resolve()
            for name in names:
                target = actual_repo / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('original tool\n')
            dependency = actual_repo / 'node_modules/dependency/index.js'
            dependency.parent.mkdir(parents=True)
            dependency.write_text('actual installed dependency\n')
            def actual_record(path):
                return {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'executable': bool(path.stat().st_mode & 0o111)}
            historical = copy.deepcopy(groups)
            historical['python']['importFiles'] = {str(actual_repo / name): actual_record(actual_repo / name) for name in names}
            executable = Path(sys.executable).resolve()
            harness_file = Path('/Users/sam/.agents/skills/software-engineering-harness/scripts/harness_core.py')
            historical['python'].update(files={str(executable): actual_record(executable)},
                importRoots=[{'path': str(actual_repo), 'realpath': str(actual_repo)}],
                importOrigins={'synthetic': str(actual_repo / names[0])})
            historical['harness']['files'] = {str(harness_file): actual_record(harness_file)}
            historical['node']['installedInputs'] = {'node_modules/dependency/index.js': actual_record(dependency)}
            historical['mysql']['daemon'] = {}
            historical['path'] = {key: {'realpath': str(executable), 'sha256': actual_record(executable)['sha256']}
                                  for key in ('node', 'mysql', 'git', 'python')}
            captured_records = [[name, False, actual_record(actual_repo / name)['sha256']] for name in names]
            historical['tools']['sourceMap'] = {'source_fingerprint': core.digest(captured_records), 'records': captured_records}
            actual_raw = dict(raw, source_fingerprint=core.digest(captured_records))
            actual_obs = dict(obs, hashesBefore={'hd233Inputs': copy.deepcopy(historical)},
                              hashesAfter={'hd233Inputs': historical})
            actual_current = self.gate.source_map(captured_records)
            for name in names:
                (actual_repo / name).write_text('reviewed observational tool correction\n')
                actual_current[name] = dict(entry(), sha256=actual_record(actual_repo / name)['sha256'])
            _, observed_projection = self.gate.hd235_observational_applicability(actual_raw, suite, 'f' * 64,
                actual_current, raw['spec_baseline'], actual_obs, core, actual_repo)
            with mock.patch.object(self.gate.shutil, 'which', return_value=str(executable)), \
                 mock.patch.object(self.gate, 'mysql_daemon_issues', return_value=[]):
                context = SimpleNamespace(repo=actual_repo)
                self.assertEqual(self.gate.current_manifest_issues(observed_projection, context), [])
                dependency.write_text('changed installed dependency must block\n')
                self.assertTrue(self.gate.current_manifest_issues(observed_projection, context))
                dependency.write_text('actual installed dependency\n')
                (actual_repo / 'unexpected.py').write_text('new lookup input\n')
                # The real producer supplies directory membership as well as files.
                observed_projection['python']['importFiles'][str(actual_repo)] = {
                    'directory': True, 'children': sorted(p.name for p in actual_repo.iterdir() if p.name != 'unexpected.py')}
                self.assertTrue(self.gate.current_manifest_issues(observed_projection, context))

        # Actual Git blobs anchor the unrelated Supplier integration, including
        # its newly added document; dirty docs and future product changes block.
        import subprocess
        with tempfile.TemporaryDirectory(prefix='hd235-supplier-main-') as directory:
            git_repo = Path(directory).resolve()
            def git(*args):
                return subprocess.run(['git', '-C', str(git_repo), *args], check=True,
                                      capture_output=True).stdout.decode()
            git('init', '-q')
            git('config', 'user.email', 'synthetic@example.invalid')
            git('config', 'user.name', 'Synthetic HD235 unit')
            document = git_repo / 'docs/supplier_management/existing.md'
            document.parent.mkdir(parents=True)
            document.write_text('original Supplier documentation\n')
            git_tool = git_repo / 'server/scripts/inventoryPhase005Gate.py'
            git_tool.parent.mkdir(parents=True)
            git_tool.write_text('original observational tool\n')
            git('add', '.')
            git('commit', '-qm', 'synthetic original')
            old_commit = git('rev-parse', 'HEAD').strip()
            def doc_record(path):
                return {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'mode': '100644', 'symlink': None}
            old_document = doc_record(document)
            old_tool = doc_record(git_tool)
            document.write_text('integrated Supplier documentation\n')
            addition = document.parent / 'new-review.md'
            addition.write_text('integrated independent review\n')
            git('add', '.')
            git('commit', '-qm', 'synthetic unrelated main documentation')
            git_core = SimpleNamespace(digest=core.digest, current_commit=lambda repo: git('rev-parse', 'HEAD').strip(),
                                       git=lambda repo, *args: git(*args))
            git_raw = dict(raw, code_commit=old_commit)
            delta = self.gate.hd235_supplier_doc_delta(git_raw, git_core, git_repo, {
                'docs/supplier_management/existing.md', 'docs/supplier_management/new-review.md'})
            self.assertEqual(delta['docs/supplier_management/existing.md'], (old_document, doc_record(document)))
            self.assertEqual(delta['docs/supplier_management/new-review.md'], (None, doc_record(addition)))
            supplier_records = [['docs/supplier_management/existing.md', False, old_document['sha256']],
                                ['server/scripts/inventoryPhase005Gate.py', False, old_tool['sha256']]]
            git_raw['source_fingerprint'] = core.digest(supplier_records)
            supplier_groups = copy.deepcopy(groups)
            supplier_groups['tools']['sourceMap'] = {'source_fingerprint': git_raw['source_fingerprint'], 'records': supplier_records}
            supplier_groups['python']['importFiles'] = {
                str(document): {'sha256': old_document['sha256'], 'executable': False},
                str(git_tool): {'sha256': old_tool['sha256'], 'executable': False},
                str(document.parent): {'directory': True, 'children': ['existing.md']}}
            supplier_obs = dict(obs, hashesBefore={'hd233Inputs': copy.deepcopy(supplier_groups)},
                                hashesAfter={'hd233Inputs': supplier_groups})
            supplier_current = {name: pair[1] for name, pair in delta.items()}
            supplier_current['server/scripts/inventoryPhase005Gate.py'] = old_tool
            classification, projection = self.gate.hd235_observational_applicability(
                git_raw, suite, 'f' * 64, supplier_current, raw['spec_baseline'], supplier_obs, git_core, git_repo)
            self.assertEqual(classification['kind'], 'ADMIN_EQUIVALENT')
            self.assertEqual(projection['python']['importFiles'][str(document.parent)]['children'], ['existing.md', 'new-review.md'])
            self.assertNotIn(str(addition), supplier_groups['python']['importFiles'])
            dirty = copy.deepcopy(supplier_current)
            dirty['docs/supplier_management/existing.md'] = entry('f')
            with self.assertRaises(self.gate.Blocked):
                self.gate.hd235_observational_applicability(git_raw, suite, 'f' * 64, dirty,
                    raw['spec_baseline'], supplier_obs, git_core, git_repo)
            document.write_text('second integrated Supplier documentation\n')
            git_tool.write_text('committed reviewed observational tool correction\n')
            git('add', '.')
            git('commit', '-qm', 'synthetic mixed observational tool and Supplier docs')
            supplier_current['docs/supplier_management/existing.md'] = doc_record(document)
            supplier_current['server/scripts/inventoryPhase005Gate.py'] = doc_record(git_tool)
            mixed, _ = self.gate.hd235_observational_applicability(git_raw, suite, 'f' * 64,
                supplier_current, raw['spec_baseline'], supplier_obs, git_core, git_repo)
            self.assertEqual(mixed['kind'], 'ADMIN_EQUIVALENT')
            exact_suite = dict(suite, id='inventory-task041-gate-binding-unit')
            exact_raw = dict(git_raw, suite_id=exact_suite['id'], code_commit=git('rev-parse', 'HEAD').strip(),
                             command_contract_sha256=synthetic_contract_hash(exact_suite))
            exact_groups = copy.deepcopy(supplier_groups)
            exact_records = [[name, False, record['sha256']] for name, record in sorted(supplier_current.items())]
            exact_raw['source_fingerprint'] = core.digest(exact_records)
            exact_groups['tools']['sourceMap'] = {'source_fingerprint': exact_raw['source_fingerprint'], 'records': exact_records}
            exact_obs = dict(supplier_obs, selectedSuite=exact_suite,
                             hashesBefore={'hd233Inputs': copy.deepcopy(exact_groups)},
                             hashesAfter={'hd233Inputs': exact_groups})
            inventory_doc = git_repo / 'docs/inventory_management/observation.md'
            inventory_doc.parent.mkdir(parents=True)
            inventory_doc.write_text('module documentation excluded by original fingerprint\n')
            git('add', '.')
            git('commit', '-qm', 'synthetic module-only documentation')
            for commit in ('module-only', 'empty'):
                if commit == 'empty': git('commit', '--allow-empty', '-qm', 'synthetic empty commit')
                exact, _ = self.gate.hd235_observational_applicability(exact_raw, exact_suite,
                    exact_raw['source_fingerprint'], supplier_current, raw['spec_baseline'], exact_obs, git_core, git_repo)
                self.assertEqual(exact['kind'], 'EXACT', commit)
            (git_repo / 'product.js').write_text('future product main change\n')
            git('add', '.')
            git('commit', '-qm', 'synthetic disallowed product change')
            changed_source = copy.deepcopy(supplier_current)
            changed_source['product.js'] = doc_record(git_repo / 'product.js')
            with self.assertRaises(self.gate.Blocked):
                self.gate.hd235_observational_applicability(git_raw, suite, 'f' * 64,
                    changed_source, raw['spec_baseline'], supplier_obs, git_core, git_repo)

        # Root SELF repair: committing already-tested dirty product bytes does
        # not change those actual inputs. Sam's final source disposition remains.
        with tempfile.TemporaryDirectory(prefix='hd235-captured-product-commit-') as directory:
            captured_repo = Path(directory).resolve()
            def captured_git(*args):
                return subprocess.run(['git', '-C', str(captured_repo), *args], check=True,
                                      capture_output=True).stdout.decode()
            captured_git('init', '-q')
            captured_git('config', 'user.email', 'synthetic@example.invalid')
            captured_git('config', 'user.name', 'Synthetic HD235 unit')
            supplier = captured_repo / 'docs/supplier_management/existing.md'
            tool = captured_repo / 'server/scripts/inventoryPhase005Gate.py'
            product = captured_repo / 'server/src/already-tested.js'
            for target, text in ((supplier, 'old Supplier documentation\n'), (tool, 'old observational tool\n')):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text)
            captured_git('add', '.')
            captured_git('commit', '-qm', 'synthetic original HEAD')
            original_head = captured_git('rev-parse', 'HEAD').strip()
            product.parent.mkdir(parents=True)
            product.write_text('already tested uncommitted product bytes\n')
            def captured_record(target):
                return [target.relative_to(captured_repo).as_posix(), False,
                        hashlib.sha256(target.read_bytes()).hexdigest()]
            captured_records = sorted(captured_record(target) for target in (supplier, tool, product))
            captured_raw = dict(raw, code_commit=original_head, source_fingerprint=core.digest(captured_records))
            captured_groups = copy.deepcopy(groups)
            captured_groups['tools']['sourceMap'] = {
                'source_fingerprint': captured_raw['source_fingerprint'], 'records': captured_records}
            captured_groups['python']['importFiles'] = {
                str(captured_repo / name): {'sha256': digest, 'executable': False}
                for name, mode, digest in captured_records}
            captured_obs = dict(obs, hashesBefore={'hd233Inputs': copy.deepcopy(captured_groups)},
                                hashesAfter={'hd233Inputs': captured_groups})
            supplier.write_text('integrated Supplier documentation\n')
            tool.write_text('reviewed observational tool correction\n')
            excluded_module_doc = captured_repo / 'docs/inventory_management/implementation/source-review.md'
            excluded_module_doc.parent.mkdir(parents=True)
            excluded_module_doc.write_text('module source review metadata excluded by original fingerprint\n')
            captured_git('add', '.')
            captured_git('commit', '-qm', 'synthetic commit of existing product with tools and Supplier docs')
            captured_core = SimpleNamespace(digest=core.digest,
                current_commit=lambda repo: captured_git('rev-parse', 'HEAD').strip(),
                git=lambda repo, *args: captured_git(*args))
            captured_current = self.gate.source_map(sorted(captured_record(target) for target in (supplier, tool, product)))
            classification, projection = self.gate.hd235_observational_applicability(captured_raw, suite,
                'f' * 64, captured_current, raw['spec_baseline'], captured_obs, captured_core, captured_repo)
            self.assertEqual(classification['kind'], 'ADMIN_EQUIVALENT')
            self.assertEqual(projection['python']['importFiles'][str(product)],
                             captured_groups['python']['importFiles'][str(product)])
            product.write_text('actual product change after the tested snapshot\n')
            changed_product = self.gate.source_map(sorted(captured_record(target) for target in (supplier, tool, product)))
            with self.assertRaises(self.gate.Blocked):
                self.gate.hd235_observational_applicability(captured_raw, suite, 'f' * 64,
                    changed_product, raw['spec_baseline'], captured_obs, captured_core, captured_repo)

        # Root SELF: later unrelated build/coverage outputs are not inputs of the
        # three original Vite-dev UI commands. Historical receipts stay intact.
        with tempfile.TemporaryDirectory(prefix='hd235-ui-inactive-outputs-') as directory:
            ui_repo = Path(directory).resolve()
            old_outputs = ['client/node_modules/.vite/deps', 'server/logs']
            fixture_files = ['client/src/app.js', 'server/src/app.js', 'client/vite.config.js',
                'client/node_modules/vite/package.json', 'client/node_modules/.vite/deps/used.js',
                'client/node_modules/.vite/vitest/results.json', 'client/coverage/old.info']
            for name in fixture_files:
                target = ui_repo / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(name + '\n')
            def file_record(target):
                return {'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                        'executable': bool(target.stat().st_mode & 0o111)}
            import_files = {}
            def capture_imports(target):
                relative = target.relative_to(ui_repo).as_posix()
                if relative == 'client/node_modules': return
                if any(relative == root or relative.startswith(root + '/') for root in old_outputs): return
                if target.is_dir():
                    generated = sorted(Path(root).name for root in old_outputs if (ui_repo / root).parent == target)
                    import_files[str(target)] = {'directory': True,
                        'children': sorted(child.name for child in target.iterdir() if child.name not in generated)}
                    if generated: import_files[str(target)]['generatedChildren'] = generated
                    for child in target.iterdir(): capture_imports(child)
                else: import_files[str(target)] = file_record(target)
            capture_imports(ui_repo)
            executable = Path(sys.executable).resolve()
            harness_file = Path('/Users/sam/.agents/skills/software-engineering-harness/scripts/harness_core.py')
            installed = {name: file_record(ui_repo / name) for name in fixture_files if '/node_modules/' in name}
            observed_groups = {'python': {'files': {str(executable): file_record(executable)},
                'importFiles': import_files, 'importRoots': [{'path': str(ui_repo), 'realpath': str(ui_repo)}],
                'importOrigins': {'actual_source': str(ui_repo / 'server/src/app.js')}},
                'harness': {'files': {str(harness_file): file_record(harness_file)}},
                'node': {'installedInputs': installed}, 'mysql': {'daemon': {}},
                'path': {name: {'realpath': str(executable), 'sha256': file_record(executable)['sha256']}
                         for name in ('node', 'mysql', 'git', 'python')}}
            original_groups = copy.deepcopy(observed_groups)
            context = SimpleNamespace(repo=ui_repo)
            with mock.patch.object(self.gate.shutil, 'which', return_value=str(executable)), \
                 mock.patch.object(self.gate, 'mysql_daemon_issues', return_value=[]):
                self.assertEqual(self.gate.current_manifest_issues(observed_groups, context, old_outputs), [])
                for name in ('client/dist/output.js', 'server/coverage/lcov.info',
                             'client/coverage/old.info', 'client/node_modules/.vite/vitest/results.json'):
                    target = ui_repo / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text('later unrelated generated output\n')
                self.assertTrue(self.gate.current_manifest_issues(observed_groups, context, old_outputs))
                for sid in ('inventory-p3-browser', 'inventory-task039-browser', 'inventory-task040-browser'):
                    current_groups, check_outputs = self.gate.hd235_ui_current_input_projection(
                        observed_groups, ui_repo, sid, old_outputs)
                    self.assertEqual(self.gate.current_manifest_issues(current_groups, context, check_outputs), [])
                    self.assertEqual(observed_groups, original_groups)
                    self.assertIn('client/node_modules/.vite/deps/used.js', current_groups['node']['installedInputs'])
                    self.assertNotIn('client/node_modules/.vite/vitest/results.json', current_groups['node']['installedInputs'])
                for name in ('client/src/app.js', 'server/src/app.js', 'client/vite.config.js',
                             'client/node_modules/vite/package.json', 'client/node_modules/.vite/deps/used.js'):
                    target = ui_repo / name
                    previous_bytes = target.read_bytes()
                    target.write_text('actual consumed input changed\n')
                    self.assertTrue(self.gate.current_manifest_issues(current_groups, context, check_outputs), name)
                    target.write_bytes(previous_bytes)
                unknown = ui_repo / 'client/unapproved-output'
                unknown.mkdir()
                (unknown / 'hidden.js').write_text('unreviewed output is still input\n')
                self.assertTrue(self.gate.current_manifest_issues(current_groups, context, check_outputs))
                foreign, foreign_outputs = self.gate.hd235_ui_current_input_projection(
                    observed_groups, ui_repo, 'inventory-task036-unit', old_outputs)
                self.assertIs(foreign, observed_groups)
                self.assertEqual(list(foreign_outputs), old_outputs)
                wrong_role = copy.deepcopy(observed_groups)
                wrong_role['python']['importFiles'][str(ui_repo / 'client')]['generatedChildren'] = ['arbitrary']
                with self.assertRaises(self.gate.Blocked):
                    self.gate.hd235_ui_current_input_projection(wrong_role, ui_repo, 'inventory-task039-browser', old_outputs)
                actual_import = copy.deepcopy(observed_groups)
                actual_import['python']['importOrigins']['loaded_output'] = str(ui_repo / 'client/coverage/old.info')
                with self.assertRaises(self.gate.Blocked):
                    self.gate.hd235_ui_current_input_projection(actual_import, ui_repo, 'inventory-task039-browser', old_outputs)
                dist = ui_repo / 'client/dist'
                (dist / 'output.js').unlink()
                dist.rmdir()
                dist.symlink_to(ui_repo / 'client/src', target_is_directory=True)
                try:
                    with self.assertRaises(self.gate.Blocked):
                        self.gate.hd235_ui_current_input_projection(observed_groups, ui_repo, 'inventory-task039-browser', old_outputs)
                finally: dist.unlink()

    def test_GB_U67_all_original_contract_minima_data_cases_and_deadlines_mandatory(self):
        expected = self.hd235_registry()
        self.assertEqual(self.gate.hd235_registry_issues(copy.deepcopy(expected), expected), [])
        sid = next(sid for sid, row in expected.items() if row['min_tests'] > 0)
        for field, value in (('min_tests', 0), ('max_skipped', 1), ('timeout_seconds', 999999),
                             ('required_case_ids', ['invented-replacement']), ('env_keys', ['WRONG_DATA'])):
            registry = copy.deepcopy(expected)
            registry[sid][field] = value
            self.assertTrue(self.gate.hd235_registry_issues(registry, expected), field)
        registry = copy.deepcopy(expected)
        registry.pop(sid)
        self.assertTrue(self.gate.hd235_registry_issues(registry, expected))

    def test_GB_U68_readonly_selection_is_explicit_finite_and_cannot_execute(self):
        registry = self.hd235_registry()
        before = copy.deepcopy(registry)
        self.assertEqual(self.gate.hd235_selection_issues(['lint'], registry), [])
        for requested in ([], ['*'], ['all'], ['lint', 'lint'], ['sales-foreign'],
                          {'suites': ['lint'], 'execute': True}, {'suites': ['lint'], 'write': True}):
            self.assertTrue(self.gate.hd235_selection_issues(requested, registry), repr(requested))
        self.assertEqual(registry, before)

    def test_GB_U69_current_four_shards_bind_source_workflow_and_actual_origin(self):
        record, expected = self.hd235_coverage()
        self.assertEqual(self.gate.hd235_coverage_issues(record, expected), [])
        for mutation in ('workflow', 'source', 'inputs'):
            changed = copy.deepcopy(record)
            if mutation == 'workflow': changed['workflow_sha256'] = 'f' * 64
            elif mutation == 'source': changed['parts'][0]['manifest']['commit'] = 'other-head'
            else: del changed['inputs']['before']['node_modules/synthetic/index.js']
            self.assertTrue(self.gate.hd235_coverage_issues(changed, expected), mutation)
        env = self.hd235_ci_env()
        self.assertTrue(self.hd235_recorder('validateCiContext', [env])['accepted'])
        env['GITHUB_ACTIONS'] = 'false'
        self.assertFalse(self.hd235_recorder('validateCiContext', [env])['accepted'])

        import subprocess
        with tempfile.TemporaryDirectory(prefix='hd235-recorder-source-') as directory:
            root = Path(directory)
            subprocess.run(['git', 'init', '--quiet', directory], check=True, capture_output=True)
            (root / 'server').mkdir()
            (root / 'server/original.js').write_text('// original immutable source\n')
            before = self.hd235_node_probe('console.log(JSON.stringify(await recorder.sourceSnapshot(input)));',
                                            directory, cwd=directory)
            outputs = {'server/capacity.tap': '# pass 2\n', 'server/import-capacity.tap': '# pass 3\n'}
            for name, text in outputs.items(): (root / name).write_text(text)
            after = self.hd235_node_probe('console.log(JSON.stringify(await recorder.sourceSnapshot(input)));',
                                           directory, cwd=directory)
            self.assertEqual(after['source'], before['source'], 'Exact generated capacity outputs are not source drift')
            self.assertEqual(after['records'], before['records'])
            for name, text in outputs.items():
                self.assertEqual(after['outputs'][name]['sha256'], hashlib.sha256(text.encode()).hexdigest())
            (root / 'server/untracked-product.js').write_text('// unapproved product input\n')
            drift = self.hd235_node_probe('console.log(JSON.stringify(await recorder.sourceSnapshot(input)));',
                                           directory, cwd=directory)
            self.assertNotEqual(drift['source'], before['source'], 'Other untracked source stays immutable')

    def test_GB_U70_partial_native_raw_and_conflicting_shards_reject(self):
        record, expected = self.hd235_coverage()
        self.assertEqual(self.gate.hd235_coverage_issues(record, expected), [])
        for mutation in ('unit', 'missing', 'duplicate'):
            changed = copy.deepcopy(record)
            if mutation == 'unit': changed['recipe'] = 'UNIT_ONLY'
            elif mutation == 'missing': changed['parts'].pop()
            else: changed['parts'][3] = copy.deepcopy(changed['parts'][0])
            self.assertTrue(self.gate.hd235_coverage_issues(changed, expected))
        merge = self.hd235_merge()
        self.assertTrue(self.hd235_recorder('buildMergeRecord', [merge])['accepted'])
        merge['parts'].pop()
        self.assertFalse(self.hd235_recorder('buildMergeRecord', [merge])['accepted'])

        with tempfile.TemporaryDirectory(prefix='hd235-recorder-shards-') as directory:
            root = Path(directory)
            identity = self.hd235_shard_files(root)
            probe = """try {
 const value = await recorder.captureMergeParts(input.root, input.identity);
 console.log(JSON.stringify({accepted:true,value}));
} catch (error) { console.log(JSON.stringify({accepted:false,error:String(error.message)})); }
"""
            payload = {'root': directory, 'identity': identity}
            initial = self.hd235_node_probe(probe, payload)
            self.assertTrue(initial['accepted'], initial)
            self.assertEqual(len(initial['value']), 4)
            shard = root / 'server/coverage/shards/server-coverage-1'
            manifest = shard / 'manifest.json'
            manifest_original = manifest.read_text()
            manifest.write_text(manifest_original + ' ')
            self.assertFalse(self.hd235_node_probe(probe, payload)['accepted'], 'Actual manifest bytes must match proof')
            manifest.write_text(manifest_original)
            raw = next((shard / 'raw').iterdir())
            raw_original = raw.read_text()
            raw.write_text(raw_original + ' ')
            self.assertFalse(self.hd235_node_probe(probe, payload)['accepted'], 'Raw changed after before-capture is rejected')
            raw.write_text(raw_original)
            raw.unlink()
            self.assertFalse(self.hd235_node_probe(probe, payload)['accepted'], 'complete.json cannot replace missing native bytes')

    def test_GB_U71_wrong_runtime_command_threshold_or_absent_outcome_rejects(self):
        merge = self.hd235_merge()
        self.assertTrue(self.hd235_recorder('buildMergeRecord', [merge])['accepted'])
        for mutation in ('node', 'npm', 'cwd', 'command', 'thresholds', 'outcome'):
            changed = copy.deepcopy(merge)
            if mutation == 'outcome': changed.pop('outcome')
            elif mutation == 'thresholds':
                changed['before']['thresholds']['lines'] = changed['after']['thresholds']['lines'] = 91
            else: changed['after'][mutation] = 'wrong-runtime-or-command'
            self.assertFalse(self.hd235_recorder('buildMergeRecord', [changed])['accepted'], mutation)

    def test_GB_U72_floor_consumes_same_native_lcov_through_original39_checker(self):
        record, expected = self.hd235_coverage()
        self.assertEqual(self.gate.hd235_coverage_issues(record, expected), [])
        for field, value in (('input_sha256', 'f' * 64), ('files', 38),
                             ('checker_sha256', 'f' * 64), ('command', 'node fake-floor.js')):
            changed = copy.deepcopy(record)
            changed['floor'][field] = value
            self.assertTrue(self.gate.hd235_coverage_issues(changed, expected), field)

        self.hd235_floor_staging_mechanics()

    def hd235_floor_staging_mechanics(self):
        """SYNTHETIC_MECHANICS only; no CI or real 39-floor PASS is claimed."""
        import re
        source = (Path(__file__).resolve().parents[2] / self.gate.HD235_COORDINATOR.replace('implementation/', 'docs/inventory_management/implementation/', 1)).read_text()
        helper = re.search(r'^async function stageFloorLcov\([^\n]*\) \{[\s\S]*?^\}', source, re.MULTILINE)
        self.assertIsNotNone(helper, 'Actual finite floor staging helper required')
        program = """
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const sha256=bytes=>recorderHash(bytes);
import {createHash} from 'node:crypto';
const recorderHash=bytes=>createHash('sha256').update(bytes).digest('hex');
""" + helper.group() + """
const repo=input.repo, bytes=Buffer.from('TN:SYNTHETIC_MECHANICS_ONLY\\nSF:synthetic.js\\nend_of_record\\n');
await fs.mkdir(path.join(repo,'server/coverage'),{recursive:true});
const target=path.join(repo,'server/coverage/lcov.info');
await fs.writeFile(path.join(repo,'server/coverage/unrelated.txt'),'preserve');
if(input.existing) {await fs.writeFile(target,'original LCOV bytes');await fs.chmod(target,0o640);}
const binding={source:'a'.repeat(64),commit:'b'.repeat(40),origin_sha256:'c'.repeat(64),archive_sha256:'d'.repeat(64),lcov_sha256:sha256(bytes),checker_sha256:'e'.repeat(64)};
const proof={retainedLcov:{path:'docs/inventory_management/evidence/synthetic/ci-native-lcov.info',sha256:sha256(bytes)}};
const stage=await stageFloorLcov(repo,bytes,binding,proof);
assert.equal(sha256(await fs.readFile(target)),binding.lcov_sha256);
if(input.change)await fs.writeFile(target,'changed consumed LCOV');
let rejected=false;try{await stage.restore();}catch{rejected=true;}
assert.equal(rejected,!!input.change);
assert.equal(await fs.readFile(path.join(repo,'server/coverage/unrelated.txt'),'utf8'),'preserve');
if(input.existing)assert.equal(await fs.readFile(target,'utf8'),'original LCOV bytes');
else await assert.rejects(fs.stat(target),{code:'ENOENT'});
proof.stdout={path:'evidence/synthetic-run/stdout.log',sha256:sha256(Buffer.from('Per-file coverage floors met for 39 high-risk files.\\n'))};
console.log(JSON.stringify({proof,binding,lcov:bytes.toString(),rejected}));
"""
        for existing, change in ((False, False), (True, False), (True, True)):
            with self.subTest(synthetic_floor_staging=(existing, change)), tempfile.TemporaryDirectory(prefix='hd235-floor-mechanics-') as temporary:
                result = self.hd235_node_probe(program, {'repo': str(Path(temporary).resolve()), 'existing': existing, 'change': change})
                raw = {'suite_id': 'inventory-p3-coverage-floors', 'command': ['node', 'server/scripts/checkCoverageFloors.js'],
                    'cwd': '.', 'result': 'PASS', 'exit_code': 0, 'timed_out': False,
                    'started_at': result['proof']['stagedAt'], 'ended_at': result['proof']['consumedAt'],
                    'artifacts': [result['proof']['stdout']]}
                stdout = 'Per-file coverage floors met for 39 high-risk files.\n'
                expected = {'binding': result['binding'], 'raw': raw,
                    'lcov': {'path': result['proof']['retainedLcov']['path'], 'original_text': result['lcov'],
                             'sha256': hashlib.sha256(result['lcov'].encode()).hexdigest()},
                    'stdout': {'path': result['proof']['stdout']['path'], 'original_text': stdout,
                               'sha256': hashlib.sha256(stdout.encode()).hexdigest()}}
                errors = self.gate.hd235_floor_consumption_issues(result['proof'], expected)
                if change: self.assertTrue(errors)
                else:
                    self.assertEqual(errors, [])
                    for mutation in ('lcov', 'binding', 'restoration', 'stdout'):
                        changed = copy.deepcopy(result['proof'])
                        if mutation == 'lcov': changed['consumedAfterSha256'] = 'f' * 64
                        elif mutation == 'binding': changed['binding']['archive_sha256'] = 'f' * 64
                        elif mutation == 'restoration': changed['restored'] = {'absent': True} if existing else {'absent': False}
                        else: changed['stdout']['sha256'] = 'f' * 64
                        self.assertTrue(self.gate.hd235_floor_consumption_issues(changed, expected), mutation)
        with tempfile.TemporaryDirectory(prefix='hd235-floor-refusal-') as temporary:
            refusal = self.hd235_node_probe("""
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
""" + helper.group() + """
const repo=input, target=path.join(repo,'server/coverage/lcov.info');
await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,'original');
await assert.rejects(stageFloorLcov(repo,Buffer.from('wrong'),{lcov_sha256:'a'.repeat(64)},{}));
assert.equal(await fs.readFile(target,'utf8'),'original');
const bytes=Buffer.from('SYNTHETIC_MECHANICS_ONLY'),proof={};
const staged=await stageFloorLcov(repo,bytes,{lcov_sha256:sha256(bytes)},proof);
await fs.rename(target,target+'.moved-synthetic');await fs.writeFile(target,'foreign replacement');
await assert.rejects(staged.restore());
assert.equal(await fs.readFile(target,'utf8'),'foreign replacement');
assert.equal(await fs.readFile(path.join(proof.backupDirectory,'original-lcov.info'),'utf8'),'original');
assert.equal(proof.backupRemoved,false);
console.log(JSON.stringify({wrongBytesRejected:true,foreignReplacementPreserved:true,originalBackupPreserved:true}));
""", str(Path(temporary).resolve()))
            self.assertTrue(all(refusal.values()))
        for existing, race in ((True, 'before-take'), (False, 'before-take'), (True, 'before-restore')):
            with self.subTest(synthetic_floor_race=(existing, race)), tempfile.TemporaryDirectory(prefix='hd235-floor-race-') as temporary:
                observed = self.hd235_node_probe("""
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
""" + helper.group() + """
const repo=input.repo,target=path.join(repo,'server/coverage/lcov.info');
await fs.mkdir(path.dirname(target),{recursive:true});
if(input.existing)await fs.writeFile(target,'original');
const proof={},bytes=Buffer.from('SYNTHETIC_MECHANICS_ONLY');
const staged=await stageFloorLcov(repo,bytes,{lcov_sha256:sha256(bytes)},proof);
const backup=path.join(proof.backupDirectory,'original-lcov.info');
const original={rename:fs.rename,unlink:fs.unlink,link:fs.link};let injected=false,rejected=false;
const replace=async()=>{if(!injected){injected=true;await original.rename(target,target+'.moved-synthetic');await fs.writeFile(target,'FOREIGN');}};
const recreate=async()=>{if(!injected){injected=true;await fs.writeFile(target,'FOREIGN',{flag:'wx'});}};
try {
  fs.unlink=async filename=>{if(input.race==='before-take'&&filename===target)await replace();return original.unlink(filename);};
  fs.rename=async(from,to)=>{if(input.race==='before-take'&&from===target)await replace();if(input.race==='before-restore'&&from===backup&&to===target)await recreate();return original.rename(from,to);};
  fs.link=async(from,to)=>{if(input.race==='before-restore'&&from===backup&&to===target)await recreate();return original.link(from,to);};
  try{await staged.restore();}catch{rejected=true;}
} finally {Object.assign(fs,original);}
assert.equal(injected,true);assert.equal(rejected,true);
assert.equal(await fs.readFile(target,'utf8'),'FOREIGN');
if(input.existing)assert.equal(await fs.readFile(backup,'utf8'),'original');
assert.equal(proof.backupRemoved,false);
const retained=await fs.readdir(proof.backupDirectory);
await assert.rejects(staged.restore()); // A rejected attempt never reuses its retained slot.
assert.deepEqual(await fs.readdir(proof.backupDirectory),retained);
assert.equal(await fs.readFile(target,'utf8'),'FOREIGN');
console.log(JSON.stringify({raceInjected:injected,rejected,foreignPreserved:true,originalBackupPreserved:input.existing}));
""", {'repo': str(Path(temporary).resolve()), 'existing': existing, 'race': race})
                self.assertTrue(observed['raceInjected'] and observed['rejected'] and observed['foreignPreserved'])
                self.assertEqual(observed['originalBackupPreserved'], existing)
        with mock.patch.object(self.gate, 'collect_hd235_native_coverage', return_value=[issue('MISSING_REAL_CI')]):
            with self.assertRaises(self.gate.Blocked):
                self.gate.hd235_verified_floor_lcov(SimpleNamespace(baselines=lambda: self.gate.HD235_BASELINES), SimpleNamespace(), 'a' * 64)

    def test_GB_U73_guarded_native_skip_cannot_satisfy_zero_skip_group(self):
        attempt = self.gate.hd235_attempt(self.raw, self.suite, self.raw['source_fingerprint'], self.raw['spec_baseline'])
        self.assertIs(self.gate.select_latest([attempt]), attempt)
        self.raw['counts'].update(passed=0, skipped=1)
        self.raw['guarded_skip_reason'] = 'original native guard'
        skipped = self.gate.hd235_attempt(self.raw, self.suite, self.raw['source_fingerprint'], self.raw['spec_baseline'])
        self.assertEqual(skipped['raw']['counts']['skipped'], 1)
        with self.assertRaises(self.gate.Blocked): self.gate.select_latest([skipped])

    def test_GB_U74_self_reported_origin_cannot_replace_independent_artifact_bytes(self):
        record, expected = self.hd235_coverage()
        self.assertEqual(self.gate.hd235_coverage_issues(record, expected), [])
        expected.pop('observations')
        record['self_reported_github_verified'] = True
        self.assertTrue(self.gate.hd235_coverage_issues(record, expected))
        env = self.hd235_ci_env()
        for field in ('GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'):
            changed = dict(env)
            changed.pop(field)
            self.assertFalse(self.hd235_recorder('validateCiContext', [changed])['accepted'], field)

    def test_GB_U75_wrong_attempt_job_publisher_and_artifact_digest_reject(self):
        record, expected = self.hd235_coverage()
        self.assertEqual(self.gate.hd235_coverage_issues(record, expected), [])
        for field, value in (('run_id', 'other-run'), ('attempt', 2), ('job_id', 'borrowed-job'),
                             ('artifact_id', 'missing-artifact'), ('sha256', 'f' * 64),
                             ('expired', True), ('downloaded', False), ('publisher_job_id', 'foreign-job')):
            changed = copy.deepcopy(record)
            changed['parts'][0][field] = value
            self.assertTrue(self.gate.hd235_coverage_issues(changed, expected), field)

        self.hd235_native_artifact_bridge_mechanics()

    def hd235_native_artifact_bridge_mechanics(self):
        """SYNTHETIC_MECHANICS_ONLY: no GitHub/native execution is claimed."""
        import io
        import zipfile
        repo_source = Path(__file__).resolve().parents[2]
        def encode(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
        def digest(value): return hashlib.sha256(value).hexdigest()
        mutations = ('pr-positive', 'pr-parent', 'pr-tree', 'pr-base', 'pr-attempt', 'pr-local-tree', 'pr-base-not-integrated',
                     'positive', 'commit', 'attempt', 'job', 'step', 'artifact', 'expired', 'raw-set', 'raw-bytes',
                     'lcov', 'source', 'immutable-inputs', 'workflow', 'publisher', 'zip-bytes', 'floor', 'origin')
        for mutation in mutations:
            with self.subTest(synthetic_native_artifact_mechanics=mutation), tempfile.TemporaryDirectory(prefix='hd235-offline-mechanics-') as temporary:
                repo = Path(temporary); module = repo / 'docs/inventory_management'
                base = module / self.gate.HD235_COVERAGE_ROOT
                base.mkdir(parents=True)
                file_hashes = {}
                for name in self.gate.HD235_COVERAGE_FILES:
                    filename = repo / name; filename.parent.mkdir(parents=True, exist_ok=True)
                    filename.write_bytes((repo_source / name).read_bytes())
                    file_hashes[name] = digest(filename.read_bytes())
                canonical = ('00_module_manifest.json', '00_project_profile.json', '08_traceability.json')
                for name in canonical:
                    (module / name).write_bytes(b'{}\n')
                records = [[name, False, value] for name, value in sorted(file_hashes.items())]
                source = digest(json.dumps(records, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode())
                commit, run_id, attempt = 'a' * 40, 123, 2
                is_pr = mutation.startswith('pr-')
                tested_commit = 'b' * 40 if is_pr else commit
                base_commit, tree = 'c' * 40, 'd' * 40
                plan = self.gate.HD235_BASELINES['plan']
                api_run = {'id': run_id, 'run_attempt': attempt, 'head_sha': commit, 'path': '.github/workflows/ci.yml',
                    'repository': {'full_name': 'crazysumsum/erp-app'}, 'status': 'completed', 'conclusion': 'success',
                    'event': 'pull_request' if is_pr else 'push',
                    'pull_requests': [{'number': 7, 'head': {'sha': commit, 'repo': {'url': 'https://api.github.com/repos/crazysumsum/erp-app'}},
                        'base': {'sha': base_commit, 'ref': 'main', 'repo': {'url': 'https://api.github.com/repos/crazysumsum/erp-app'}}}] if is_pr else []}
                jobs, api_artifacts, bundles = [], [], []
                start, end = '2020-01-01T00:00:00Z', '2020-01-01T00:01:00Z'
                pins = {}
                def retain(name, data):
                    (base / name).write_bytes(data)
                    pins[self.gate.HD235_COVERAGE_ROOT + name] = digest(data)
                def git_commit_api(value, parents):
                    return {'sha': value, 'url': 'https://api.github.com/repos/crazysumsum/erp-app/git/commits/' + value,
                        'tree': {'sha': tree}, 'parents': [{'sha': parent} for parent in parents]}
                tested_api = git_commit_api(tested_commit, [base_commit, commit] if is_pr else [base_commit])
                candidate_api = git_commit_api(commit, [base_commit])
                if mutation == 'pr-parent': tested_api['parents'][1]['sha'] = 'f' * 40
                if mutation == 'pr-tree': tested_api['tree']['sha'] = 'f' * 40
                if mutation == 'pr-base': api_run['pull_requests'][0]['base']['sha'] = 'f' * 40
                retain('tested-commit.json', encode(tested_api))
                if is_pr: retain('candidate-commit.json', encode(candidate_api))
                def snapshot(kind):
                    files = dict(file_hashes)
                    files.update({'docs/inventory_management/' + name: digest(b'{}\n') for name in canonical})
                    return {'generatedOutputs': {}, 'source': source, 'commit': tested_commit, 'plan': plan,
                        'node': 'v26.6.0', 'npm': '11.0.0', 'cwd': '/home/runner/work/erp-app/erp-app/server',
                        'command': 'npm run test:coverage:' + kind + ' --workspace server',
                        'thresholds': {'lines': 92, 'branches': 83, 'functions': 90},
                        'inputs': {'recipe': 'CI_NODE_NATIVE', 'source': records, 'files': files,
                            'executables': {name: {'path': '/usr/bin/' + name, 'realpath': '/usr/bin/' + name,
                                'sha256': 'c' * 64} for name in ('node', 'npm', 'git', 'docker')},
                            'installed': {'node_modules': {'directory': True}},
                            'npm': {'records': {'': {'directory': True}, 'package.json': {'sha256': 'c' * 64}}},
                            'mysql': {'id': 'd' * 64, 'image': 'sha256:' + 'e' * 64, 'configuredImage': 'mysql:26.7.0'} if kind == 'shard' else None}}
                def add_bundle(name, job_name, native_step, final_step, files, number):
                    job_id, artifact_id = 1000 + number, 2000 + number
                    job = {'id': job_id, 'name': job_name, 'run_id': run_id, 'run_attempt': attempt,
                        'head_sha': commit, 'status': 'completed', 'conclusion': 'success',
                        'steps': [{'name': value, 'status': 'completed', 'conclusion': 'success'} for value in (native_step, final_step)]}
                    item = {'id': artifact_id, 'name': name, 'expired': False,
                        'workflow_run': {'id': run_id, 'head_sha': commit}}
                    jobs.append(job); api_artifacts.append(item); bundles.append((files, job, item))
                parts = []
                for shard in range(1, 5):
                    identity = {'commit': tested_commit, 'runId': str(run_id), 'attempt': attempt, 'job': 'server-tests'}
                    before = snapshot('shard')
                    raw_name = 'raw/coverage-%d-1234567890123-0.json' % shard
                    raw = encode({'result': [{'scriptId': str(shard), 'url': 'file:///synthetic.js', 'functions': []}]})
                    manifest = {'commit': tested_commit, 'node': before['node'], 'cwd': before['cwd'], 'shard': shard, 'total': 4, 'reports': 1}
                    manifest_bytes = encode(manifest)
                    proof = {'kind': 'CI_NATIVE_SHARD', 'identity': identity, 'shard': shard,
                        'before': before, 'after': copy.deepcopy(before), 'originalOutcome': 'success',
                        'startedAt': start, 'endedAt': end, 'terminal': {'connections': 0, 'transactions': 0,
                            'locks': 0, 'containerExitCode': 0, 'observerSocketClosed': True, 'forced': False},
                        'rawFiles': [{'path': raw_name, 'sha256': digest(raw)}], 'manifestSha256': digest(manifest_bytes)}
                    if shard == 1:
                        if mutation == 'source': proof['before']['source'] = proof['after']['source'] = 'f' * 64
                        if mutation == 'immutable-inputs': proof['after']['inputs']['executables']['node']['sha256'] = 'f' * 64
                    capture = {'kind': 'CI_INPUTS_BEFORE', 'identity': identity, 'shard': shard, 'snapshot': before, 'at': start}
                    proof_bytes = encode(proof)
                    files = {'inventory-proof/before.json': encode(capture), 'inventory-proof/complete.json': proof_bytes,
                        'manifest.json': manifest_bytes, raw_name: raw}
                    if shard == 1 and mutation == 'raw-set': files['raw/coverage-9-1234567890123-0.json'] = raw
                    if shard == 1 and mutation == 'raw-bytes': files[raw_name] = raw + b' '
                    add_bundle('server-coverage-%d' % shard, 'Server coverage shard (%d/4)' % shard,
                        'Collect native server coverage for this shard', 'Finalize Inventory native coverage ownership proof', files, shard)
                    parts.append({'shard': shard, 'sha256': digest(proof_bytes), 'run_id': str(run_id), 'attempt': attempt,
                        'commit': tested_commit, 'manifestSha256': digest(manifest_bytes), 'rawFiles': proof['rawFiles']})
                identity = {'commit': tested_commit, 'runId': str(run_id), 'attempt': attempt, 'job': 'regression'}
                before = snapshot('merge')
                lcov = b'TN:SYNTHETIC_MECHANICS_ONLY\nSF:/synthetic.js\nDA:1,1\nend_of_record\n'
                proof = {'kind': 'CI_NATIVE_MERGE', 'identity': identity, 'shard': None, 'before': before,
                    'after': copy.deepcopy(before), 'originalOutcome': 'success', 'startedAt': start, 'endedAt': end,
                    'parts': parts, 'outcome': {'exitCode': 0, 'signal': None}, 'lcovSha256': digest(lcov)}
                proof.update({key: value for key, value in before.items() if key != 'generatedOutputs'})
                capture = {'kind': 'CI_INPUTS_BEFORE', 'identity': identity, 'shard': None, 'snapshot': before, 'parts': parts, 'at': start}
                files = {'inventory-proof/before.json': encode(capture), 'inventory-proof/complete.json': encode(proof), 'lcov.info': lcov}
                if mutation == 'lcov': files['lcov.info'] += b'changed'
                add_bundle('inventory-native-merge-proof', 'Test coverage (server + client, MySQL integration)',
                    'Merge native coverage and enforce unchanged global and per-file floors', 'Finalize Inventory native merge proof', files, 5)
                for files, job, item in bundles:
                    stream = io.BytesIO()
                    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                        for name, data in sorted(files.items()): archive.writestr(name, data)
                    data = stream.getvalue(); item.update(digest='sha256:' + digest(data), size_in_bytes=len(data))
                    retain('artifact-%d.zip' % item['id'], data)
                    log = ('2020-01-01T00:00:59Z Artifact %s has been successfully uploaded! Final size is %d bytes. Artifact ID is %d\n'
                           '2020-01-01T00:00:59Z SHA256 digest of uploaded artifact zip is %s\n') % (item['name'], len(data), item['id'], digest(data))
                    if item['name'] == 'inventory-native-merge-proof' and mutation != 'floor':
                        log += '2020-01-01T00:00:58Z Per-file coverage floors met for 39 high-risk files.\n'
                    if mutation == 'publisher' and item['name'] == 'server-coverage-1': log = log.replace('Artifact ID is 2001', 'Artifact ID is 9999')
                    retain('job-%d.log' % job['id'], log.encode())
                if mutation == 'commit': api_run['head_sha'] = 'b' * 40
                if mutation in ('attempt', 'pr-attempt'): jobs[0]['run_attempt'] = 1
                if mutation == 'job': jobs[0]['id'] = 9999
                if mutation == 'step': jobs[0]['steps'][0]['conclusion'] = 'failure'
                if mutation == 'artifact': api_artifacts[0]['id'] = 9999
                if mutation == 'expired': api_artifacts[0]['expired'] = True
                retain('run.json', encode(api_run)); retain('jobs.json', encode({'total_count': len(jobs), 'jobs': jobs}))
                retain('artifacts.json', encode({'total_count': len(api_artifacts), 'artifacts': api_artifacts}))
                if mutation == 'zip-bytes': (base / 'artifact-2001.zip').write_bytes(b'changed retained ZIP')
                origin = {'kind': 'NATIVE_COVERAGE_ORIGIN', 'commit': commit, 'source': source, 'plan': plan,
                    'run_id': run_id, 'attempt': attempt,
                    'external_source_ref': 'https://github.com/crazysumsum/erp-app/actions/runs/123/attempts/2',
                    'producer_sha256': file_hashes, 'retained_sha256': pins}
                if mutation == 'workflow': origin['producer_sha256'] = dict(file_hashes, **{'.github/workflows/ci.yml': 'f' * 64})
                origin_bytes = encode(origin); (base / 'origin.json').write_bytes(origin_bytes)
                observation = {'kind': 'CI', 'subject': 'INVENTORY_NATIVE_COVERAGE', 'code_commit': commit,
                    'spec_baseline': plan, 'source_fingerprint': source, 'status': 'PASS', 'actor': 'GitHub Actions',
                    'observed_at': '2020-01-01T00:05:00Z',
                    'source_ref': self.gate.HD235_COVERAGE_ROOT + 'origin.json#sha256=' + digest(origin_bytes)}
                ctx = SimpleNamespace(repo=repo, module_dir=module, state={'observations': [] if mutation == 'origin' else [observation]},
                    baselines=lambda: self.gate.HD235_BASELINES)
                def inside(root, name, exists=True):
                    filename = root / name
                    if not filename.resolve(strict=exists).is_relative_to(root.resolve()): raise ValueError('escaped')
                    return filename
                def git(repo, *args):
                    if args == ('rev-parse', 'HEAD^{tree}'):
                        return ('f' * 40 if mutation == 'pr-local-tree' else tree) + '\n'
                    if args == ('merge-base', base_commit, commit):
                        return ('f' * 40 if mutation == 'pr-base-not-integrated' else base_commit) + '\n'
                    raise ValueError('Unexpected synthetic git call: ' + repr(args))
                core = SimpleNamespace(current_commit=lambda repo: commit, inside=inside, git=git, HarnessError=RuntimeError)
                result = self.gate.collect_coverage_provenance(ctx, core, source)
                if mutation in ('positive', 'pr-positive'):
                    self.assertEqual(result, [], result)
                    admitted = self.gate.hd235_verified_floor_lcov(ctx, core, source)
                    self.assertEqual(admitted['bytes'], lcov)
                    self.assertEqual(admitted['binding']['lcov_sha256'], digest(lcov))
                else: self.assertTrue(result, mutation)

    def test_GB_U76_recorder_rejects_unknown_container_sql_socket_or_forced_stop(self):
        inspect = {'Id': '1' * 64, 'Config': {'Image': 'mysql:26.7.0'}, 'Image': 'sha256:' + 'c' * 64,
            'State': {'Running': False, 'ExitCode': 0, 'OOMKilled': False, 'Dead': False}}
        self.assertTrue(self.hd235_recorder('validateContainerIdentity', [inspect, '1' * 64])['accepted'])
        self.assertFalse(self.hd235_recorder('validateContainerIdentity', [inspect, 'borrowed-container'])['accepted'])
        changed = copy.deepcopy(inspect)
        changed['Image'] = ''
        self.assertFalse(self.hd235_recorder('validateContainerIdentity', [changed, '1' * 64])['accepted'])
        terminal = {'connections': 0, 'transactions': 0, 'locks': 0, 'observerSocketClosed': True,
                    'containerExitCode': 0, 'forced': False}
        self.assertTrue(self.hd235_recorder('validateTerminalState', [terminal])['accepted'])
        for field, value in (('connections', 1), ('transactions', None), ('locks', 1),
                             ('observerSocketClosed', False), ('containerExitCode', 137), ('forced', True)):
            changed = dict(terminal, **{field: value})
            self.assertFalse(self.hd235_recorder('validateTerminalState', [changed])['accepted'], field)

        close_result = self.hd235_node_probe("""
import { EventEmitter } from 'node:events';
async function attempt(hangEnd, primary, closeNormally=false) {
 const socket = new EventEmitter();
 let destroyed = false;
 const db = {end: () => {
   if (closeNormally) queueMicrotask(() => socket.emit('close'));
   return hangEnd ? new Promise(() => {}) : Promise.resolve();
  },
  destroy: () => {destroyed=true;socket.emit('close');}};
 const start = performance.now();
 try { await recorder.closeSqlMonitor(db,socket,{timeoutMs:25,primary});
  return {accepted:true,destroyed,elapsed:performance.now()-start};
 } catch(error) {return {accepted:false,destroyed,elapsed:performance.now()-start,
  samePrimary:primary!==undefined && error===primary,message:String(error.message)};}
}
const primary = Error('Original SQL terminal check failed');
console.log(JSON.stringify({normal:await attempt(false,undefined,true),
 hungEnd:await attempt(true),hungClose:await attempt(false),
 primary:await attempt(true,primary)}));
""")
        self.assertTrue(close_result['normal']['accepted'], 'Normal db.end and socket close remain eligible')
        self.assertFalse(close_result['normal']['destroyed'])
        for name in ('hungEnd', 'hungClose', 'primary'):
            self.assertFalse(close_result[name]['accepted'], name)
            self.assertTrue(close_result[name]['destroyed'], name)
            self.assertLess(close_result[name]['elapsed'], 2000, name)
        self.assertTrue(close_result['primary']['samePrimary'], 'Cleanup deadline retains the original SQL error')
        forced_close = self.hd235_node_probe("""
import { EventEmitter } from 'node:events';
async function driverAttempt(closes, primary) {
 const socket = new EventEmitter();
 let driverDestroyRequested=false, socketDestroyRequested=false, closed=false;
 socket.closed=false;
 socket.once('close',()=>{closed=true;socket.closed=true;});
 socket.destroy=()=>{socketDestroyRequested=true;if(closes) socket.emit('close');};
 // mysql2 destroy aliases graceful stream.end; it does not force socket.destroy.
 const db={end:()=>new Promise(()=>{}),destroy:()=>{driverDestroyRequested=true;}};
 const start=performance.now();
 try {
  await recorder.closeSqlMonitor(db,socket,{timeoutMs:25,primary});
  return {accepted:true,driverDestroyRequested,socketDestroyRequested,closed,
   elapsed:performance.now()-start};
 } catch(error) {
  return {accepted:false,driverDestroyRequested,socketDestroyRequested,closed,
   elapsed:performance.now()-start,samePrimary:error===primary,
   cleanup:error.monitorCleanup??null};
 }
}
const primary=Error('Original SQL terminal proof failed');
console.log(JSON.stringify({forced:await driverAttempt(true,primary),
 unknown:await driverAttempt(false,primary)}));
""")
        for name in ('forced', 'unknown'):
            self.assertFalse(forced_close[name]['accepted'], name)
            self.assertTrue(forced_close[name]['driverDestroyRequested'], name)
            self.assertTrue(forced_close[name]['socketDestroyRequested'],
                            'Driver destroy alone does not force the owned monitor socket closed')
            self.assertLess(forced_close[name]['elapsed'], 2000, name)
            self.assertTrue(forced_close[name]['samePrimary'], name)
        self.assertTrue(forced_close['forced']['closed'], 'Own forced socket close was observed')
        self.assertFalse(forced_close['unknown']['closed'], 'No peer close event may be invented')
        self.assertEqual(forced_close['unknown']['cleanup']['status'], 'UNKNOWN')
        self.assertIs(forced_close['unknown']['cleanup']['observerSocketClosed'], False)

    def test_GB_U77_source_dependency_producer_and_executable_drift_are_not_admin(self):
        self.hd235_receipt()
        self.assertEqual(self.hd235_runtime(), [])
        original = copy.deepcopy(self.receipt)
        for name in ('node_modules/synthetic/index.js', 'harness/run_check.py', 'PATH/node', 'node'):
            self.receipt = copy.deepcopy(original)
            self.receipt['recipe']['inputs']['after'][name] = entry('f')
            self.assertTrue(self.hd235_runtime(), name)
        self.receipt = copy.deepcopy(original)
        self.receipt['recipe']['producer']['original_text'] += '// changed\n'
        self.assertTrue(self.hd235_runtime())
        self.receipt = copy.deepcopy(original)
        self.receipt['observation']['hashesAfter']['synthetic.js'] = 'f' * 64
        self.assertTrue(self.hd235_runtime())

        # Execute the exact producer helpers without starting its coordinator.
        import re
        producer = Path(__file__).resolve().parents[2] / 'docs/inventory_management/implementation/task041-hd235-verification-runtime.mjs.txt'
        source = producer.read_text()
        constant = re.search(r'^const HD235_GENERATED_OUTPUTS\s*=\s*[^;]+;', source, re.MULTILINE)
        self.assertIsNotNone(constant, 'Generated output exclusions must be a finite suite registry')
        definitions = []
        for name in ('treeManifest', 'repositoryImportManifest', 'generatedOutputManifest'):
            function = re.search(r'^async function ' + name + r'\([^\n]*\) \{[\s\S]*?^\}', source, re.MULTILINE)
            self.assertIsNotNone(function, name + ' must be the actual producer helper')
            definitions.append(function.group())
        generated_predicate = re.search(r'^function isGeneratedOutput\([^\n]*\) \{(?:[^\n]*\}|[^\n]*\n[\s\S]*?^\})', source, re.MULTILINE)
        self.assertIsNotNone(generated_predicate, 'The exact selected suite controls generated output roles')
        definitions.append(generated_predicate.group())
        for name, indent in (('installedTree', '  '), ('packageTree', '    ')):
            function = re.search('^' + indent + r'async function ' + name + r'\([^\n]*\) \{[\s\S]*?^' + indent + r'\}', source, re.MULTILINE)
            self.assertIsNotNone(function, name + ' must be the original installed-input collector')
            definitions.append(function.group())
        program = """
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const repo=input.repo, suiteId=input.suiteId;
const python=path.join(repo,'python/bin/python'),harness=path.join(repo,'harness/scripts');
const nodeToolchain=path.join(repo,'node');
const sha256=value=>createHash('sha256').update(value).digest('hex');
const installed={};
""" + constant.group() + '\n' + '\n'.join(definitions) + """
await packageTree('client/node_modules');
console.log(JSON.stringify({registry:HD235_GENERATED_OUTPUTS,files:await repositoryImportManifest(),
 installed,generated:await generatedOutputManifest(),roles:Object.fromEntries((input.paths??[]).map(name=>[name,isGeneratedOutput(name)]))}));
"""
        allowed = {'client-build': ['client/dist'],
            'inventory-p3-client-coverage': ['client/coverage', 'client/node_modules/.vite/vitest'],
            'inventory-p3-browser': ['client/node_modules/.vite/deps'],
            'inventory-p3-browser-regression': ['client/node_modules/.vite/deps'],
            'inventory-task039-browser': ['client/node_modules/.vite/deps'],
            'inventory-task040-browser': ['client/node_modules/.vite/deps'],
            'inventory-p3-transfers-client': ['client/node_modules/.vite/vitest'],
            'inventory-p3-movements-client': ['client/node_modules/.vite/vitest'],
            'inventory-p3-adjustments-client': ['client/node_modules/.vite/vitest'],
            'inventory-task039-client': ['client/node_modules/.vite/vitest'],
            'inventory-task040-client': ['client/node_modules/.vite/vitest'],
            'inventory-task040-topbar': ['client/node_modules/.vite/vitest']}
        for sid in ('inventory-p3-browser', 'inventory-task039-browser', 'inventory-task040-browser'):
            allowed[sid].append('server/logs')
        manifest = json.loads((Path(__file__).resolve().parents[2] / 'docs/inventory_management/implementation/task041-hd235-completion-manifest.json').read_text())
        common = ('client/dist', 'client/coverage', 'server/coverage',
                  'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest', 'server/logs')
        for row in manifest['rows']:
            outputs = allowed.setdefault(row['suite_id'], [])
            if 'server/logs' not in outputs:
                outputs.append('server/logs')
            for name in common:
                if name not in outputs:
                    outputs.append(name)
        for sid in ('client-build', 'inventory-p3-client-coverage'):
            output_paths = allowed[sid]
            with self.subTest(generated_output_suite=sid), tempfile.TemporaryDirectory(prefix='hd235-import-output-') as directory:
                repo = Path(directory).resolve()
                (repo / 'client').mkdir()
                (repo / 'client/app.jsx').write_text('// immutable frontend source\n')
                payload = {'repo': str(repo), 'suiteId': sid}
                before = self.hd235_node_probe(program, payload)
                self.assertEqual(before['registry'], allowed)
                generated = repo / output_paths[0]
                generated.mkdir()
                output = generated / 'result.js'
                output.write_text('// generated artifact bytes\n')
                after = self.hd235_node_probe(program, payload)
                self.assertEqual(before['files'], after['files'], 'Declared output creation cannot change Python import inputs')
                parent_record = after['files'][str(generated.parent)]
                self.assertNotIn(generated.name, parent_record['children'])
                self.assertEqual(parent_record['generatedChildren'], sorted(Path(name).name for name in output_paths
                    if (repo / name).parent == generated.parent))
                self.assertFalse(any(name == str(generated) or name.startswith(str(generated) + '/') for name in after['files']))
                (repo / 'client/untracked-product.jsx').write_text('// unreviewed product change\n')
                changed = self.hd235_node_probe(program, payload)
                self.assertNotEqual(changed['files'], before['files'])
                output.write_text('// changed generated output still excluded from input freeze\n')
                changed_output = self.hd235_node_probe(program, payload)
                self.assertEqual(changed_output['files'], changed['files'])
                foreign = self.hd235_node_probe(program, dict(payload, suiteId='unlisted-output-role-suite'))
                self.assertIn(str(output), foreign['files'], 'Other suite IDs cannot borrow generated-output exclusions')
                arbitrary = repo / 'client/arbitrary-output'
                arbitrary.mkdir()
                (arbitrary / 'product.js').write_text('// arbitrary directory is still an input\n')
                after_arbitrary = self.hd235_node_probe(program, payload)
                self.assertNotEqual(after_arbitrary['files'], changed_output['files'])

        with tempfile.TemporaryDirectory(prefix='hd235-generated-vite-role-') as directory:
            repo = Path(directory).resolve()
            package = repo / 'client/node_modules/vite/package.json'
            package.parent.mkdir(parents=True)
            package.write_text('{"name":"vite-original-implementation"}\n')
            (repo / 'client/src').mkdir()
            (repo / 'client/src/app.jsx').write_text('// genuine application input\n')
            genuine = ['client/node_modules/vite/package.json', 'client/node_modules/npm/bin/npm-cli.js',
                'client/node_modules/.vite', 'client/src/app.jsx', 'server/src/InventoryService.js',
                'client/node_modules/.vite/deps-unapproved/product.js',
                'client/node_modules/.vite/vitest-unapproved/product.js']
            all_output_roots = sorted({name for names in allowed.values() for name in names})
            paths = genuine + [name for root in all_output_roots for name in (root, root + '/generated.js')]
            for sid, declared in allowed.items():
                observed = self.hd235_node_probe(program, {'repo': str(repo), 'suiteId': sid, 'paths': paths})
                self.assertEqual(observed['registry'], allowed)
                for relative, role in observed['roles'].items():
                    expected = any(relative == root or relative.startswith(root + '/') for root in declared)
                    self.assertIs(role, expected, sid + ': ' + relative)
            foreign = self.hd235_node_probe(program, {'repo': str(repo), 'suiteId': 'arbitrary-unlisted-suite', 'paths': paths})
            self.assertFalse(any(foreign['roles'].values()), 'An unlisted suite cannot borrow generated roles')
            payload = {'repo': str(repo), 'suiteId': 'inventory-p3-browser-regression', 'paths': paths}
            before = self.hd235_node_probe(program, payload)
            cache = repo / 'client/node_modules/.vite/deps'
            cache.mkdir(parents=True)
            bundle = cache / 'mock-generated-bundle.js'
            bundle.write_text('// first generated Vite optimization output\n')
            after = self.hd235_node_probe(program, payload)
            self.assertEqual(before['files'], after['files'])
            self.assertEqual(before['roles'], after['roles'])
            self.assertNotEqual(before['generated'], after['generated'], 'Generated bytes remain separately observed')
            self.assertEqual(after['generated']['client/node_modules/.vite/deps']['files'][str(bundle)]['sha256'],
                             hashlib.sha256(bundle.read_bytes()).hexdigest())
            bundle.write_text('// changed generated optimization output\n')
            changed = self.hd235_node_probe(program, payload)
            self.assertNotEqual(changed['generated'], after['generated'])
            self.assertFalse(changed['roles']['client/node_modules/vite/package.json'])
            self.assertFalse(changed['roles']['client/src/app.jsx'])

        with tempfile.TemporaryDirectory(prefix='hd235-application-log-role-') as directory:
            repo = Path(directory).resolve()
            (repo / 'server/src').mkdir(parents=True)
            (repo / 'server/src/app.js').write_text('// immutable application source\n')
            payload = {'repo': str(repo), 'suiteId': 'inventory-task039-browser'}
            before = self.hd235_node_probe(program, payload)
            logs = repo / 'server/logs/system'
            logs.mkdir(parents=True)
            (logs / 'system-2026-10-30.log').write_text('Generated application output\n')
            (logs.parent / 'requests-2026-10-30.log').write_text('Generated request output\n')
            after = self.hd235_node_probe(program, payload)
            self.assertEqual(before['files'], after['files'])
            self.assertNotEqual(before['generated'], after['generated'])
            (repo / 'server/src/app.js').write_text('// actual source change must block\n')
            changed = self.hd235_node_probe(program, payload)
            self.assertNotEqual(changed['files'], before['files'])
            foreign = self.hd235_node_probe(program, dict(payload, suiteId='unlisted-log-role-suite'))
            self.assertIn(str(logs / 'system-2026-10-30.log'), foreign['files'])
            for invalid in ('import.py', 'foreign.log'):
                path = logs / invalid
                path.write_text('Must remain an input, never an approved logging output\n')
                with self.assertRaises(self.failureException) as caught:
                    self.hd235_node_probe(program, payload)
                self.assertIn('Generated log output', str(caught.exception))
                path.unlink()
            executable = logs / 'system-2026-10-30.log'
            executable.chmod(0o700)
            with self.assertRaises(self.failureException) as caught:
                self.hd235_node_probe(program, payload)
            self.assertIn('Generated log output', str(caught.exception))
            executable.chmod(0o600)
            linked = logs / 'system-2026-10-30-001.log'
            linked.symlink_to(repo / 'server/src/app.js')
            with self.assertRaises(self.failureException) as caught:
                self.hd235_node_probe(program, payload)
            self.assertIn('Generated log output', str(caught.exception))

        with tempfile.TemporaryDirectory(prefix='hd235-common-output-closure-') as directory:
            repo = Path(directory).resolve()
            for relative in ('server/src', 'client/src', 'client/node_modules/vite', 'client/node_modules/.vite'):
                (repo / relative).mkdir(parents=True, exist_ok=True)
            (repo / 'client/src/app.jsx').write_text('// immutable actual source\n')
            (repo / 'client/node_modules/vite/package.json').write_text('{"name":"vite","version":"original"}\n')
            payload = {'repo': str(repo), 'suiteId': 'inventory-task036-unit'}
            before = self.hd235_node_probe(program, payload)
            for relative in ('client/dist/asset.js', 'client/coverage/lcov.info', 'server/coverage/lcov.info',
                             'client/node_modules/.vite/deps/cache.js', 'client/node_modules/.vite/vitest/results.json'):
                target = repo / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('Produced by a later original build/test, not this command input\n')
            after = self.hd235_node_probe(program, payload)
            self.assertEqual(before['files'], after['files'])
            self.assertEqual(before['installed'], after['installed'])
            self.assertNotEqual(before['generated'], after['generated'])
            (repo / 'client/src/app.jsx').write_text('// actual source modification\n')
            changed = self.hd235_node_probe(program, payload)
            self.assertNotEqual(changed['files'], after['files'])
            (repo / 'client/node_modules/vite/package.json').write_text('{"name":"vite","version":"changed"}\n')
            dependency = self.hd235_node_probe(program, payload)
            self.assertNotEqual(dependency['installed'], changed['installed'])

    def test_GB_U78_coordinator_freeze_is_independent_of_generic_docs_exclusion(self):
        self.hd235_receipt()
        path = 'docs/inventory_management/implementation/task041-hd235-verification-runtime.mjs.txt'
        self.receipt['observation']['hashesBefore'][path] = 'a' * 64
        self.receipt['observation']['hashesAfter'][path] = 'a' * 64
        self.assertEqual(self.hd235_runtime(), [])
        self.receipt['observation']['hashesAfter'][path] = 'f' * 64
        self.receipt['recipe']['generic_docs_excluded'] = True
        self.assertTrue(self.hd235_runtime())

        for scenario in ('wrong-owner', 'owner-0755', 'duplicate-archive', 'mutated-executable',
                         'mutated-archive', 'missing-report', 'duplicate-report'):
            with self.subTest(synthetic_hd236_mechanics=scenario):
                self.hd236_native_mechanics(scenario)

    def test_GB_U79_performance_failure_halts_later_load_without_retry(self):
        self.hd235_receipt()
        self.hd235_policy['load_suites'] = ['inventory-task041-characterization', 'inventory-task041-stocktake-soak']
        self.receipt['recipe']['load_ledger'] = []
        self.assertEqual(self.hd235_runtime(), [])
        failed = {'suite_id': 'inventory-task041-characterization', 'run_id': 'synthetic-char-1',
            'attempt': 1, 'result': 'FAIL', 'started_at': '2020-01-01T00:00:00Z',
            'ended_at': '2020-01-01T00:01:00Z',
            'counts': {'total': 1, 'passed': 0, 'failed': 1, 'skipped': 0, 'not_run': 0}}
        self.receipt['recipe']['load_ledger'] = [copy.deepcopy(failed)]
        self.assertEqual(self.hd235_runtime(), [], 'A halted failure retains its terminal cleanup proof')
        later = dict(copy.deepcopy(failed), suite_id='inventory-task041-stocktake-soak',
            run_id='synthetic-soak-1', started_at='2020-01-01T00:02:00Z', ended_at='2020-01-01T00:03:00Z')
        self.receipt['recipe']['load_ledger'].append(later)
        self.assertTrue(self.hd235_runtime(), 'A later load cannot start after a performance failure')
        passed = dict(copy.deepcopy(failed), result='PASS',
            counts={'total': 1, 'passed': 1, 'failed': 0, 'skipped': 0, 'not_run': 0})
        retry = dict(copy.deepcopy(passed), run_id='synthetic-char-2', attempt=2,
            started_at='2020-01-01T00:02:00Z', ended_at='2020-01-01T00:03:00Z')
        self.receipt['recipe']['load_ledger'] = [passed, retry]
        self.assertTrue(self.hd235_runtime(), 'The single approved attempt cannot silently retry')
        skipped = copy.deepcopy(passed)
        skipped['counts'].update(passed=0, skipped=1)
        self.receipt['recipe']['load_ledger'] = [skipped]
        self.assertTrue(self.hd235_runtime(), 'Skipped capacity is never PASS')

    def test_GB_U80_all_other_merge_numeric_and_operations_blockers_survive73_fixtures(self):
        registry = self.hd235_registry()
        self.assertEqual(len(registry), 73)
        results = {sid: {'status': 'APPLICABLE', 'issues': [], 'resource_proven': True,
                        'raw': dict(self.raw, suite_id=sid)} for sid in registry}
        for code in ('DIRTY_SCOPE', 'TASK_DOD', 'LATEST_MAIN_REQUIRED', 'CI_REQUIRED',
                     'SOURCE_REVIEW_REQUIRED', 'FINAL_SAM_REVIEW_REQUIRED', 'CAPACITY_NUMERIC_GATE',
                     'TARGET_FILESYSTEM_OPERATIONS', 'EMPTY_METADATA_OPERATIONS', 'SHARED_WARNING_DISPOSITION'):
            blocker = issue(code)
            self.assertEqual(self.gate.resolve_core_issues([blocker], results, list(registry)), [blocker])
        missing = issue('REQUIRED_RUN_MISSING', 'gate/DEVELOPER/lint')
        self.assertEqual(self.gate.resolve_core_issues([missing], results, list(registry)), [])

    def attempt(self, status, ended_at, kind='EXACT'):
        raw = copy.deepcopy(self.raw)
        raw.update(result=status, ended_at=ended_at)
        proof = self.exact_proof()
        proof['kind'] = kind
        return {'raw': raw, 'classification': self.gate.classify_attempt(raw, self.suite, proof)}

    def make_files_recovery(self):
        # Synthetic model using the disclosed receipt's exact field names.
        self.raw['runtime_instance_id'] = 'erp-inventory-task041-hd227-files-mysql-2670.xxSf30'
        self.raw['source_fingerprint'] = '956a861141cfef0fd71625157706c56f817036d60eca5466c96332b66b1cc330'
        self.raw['spec_baseline'] = '44f7a236caece4a9813014ae1a4950bd187ac04b7f41aa15f79086165d425dfe'
        self.expected.update(root='/private/tmp/erp-inventory-task041-hd227-files-mysql-2670.xxSf30',
            schema='erp_inventory_hd227_files_4f5df5186756', pid=85769,
            socket='/private/tmp/erp-inventory-task041-hd227-files-mysql-2670.xxSf30/mysql.sock',
            datadir='/private/tmp/erp-inventory-task041-hd227-files-mysql-2670.xxSf30/data/')
        self.receipt = self.normal_receipt()
        observation = self.receipt['observation']
        observation.update(kind='OWNED_RUNTIME_FOR_33_CURRENT_PROFILE_FILE_GATES_NOT_CAPACITY', status='FAIL',
            suiteId='hd227-file-gates', selectedSuite={'id': 'hd227-file-gates',
                'argv': ['python', '/synthetic/file-gates.py'], 'timeout_seconds': 7200,
                'env_keys': [], 'result_path': 'files-gates.json', 'min_tests': 0,
                'scope': 'Runtime orchestration only; actual33original-profile-filecommands executeinsideHarness'},
            cleanup='UNKNOWN_OWN_ROOT_RETAINED', cleanupErrors=['original UNKNOWN retained'])
        observation['terminal'] = {'sqlTerminal': False, 'dropped': False,
            'normalShutdown': False, 'observerSocketClosed': True,
            'observerSocketDestroyed': True}
        self.receipt['resource_proof']['daemon_exit_zero'] = False
        self.receipt['recovery'] = {'kind': 'FILES_COORDINATOR_STATUS_LABEL_EXTERNAL_RECOVERY',
            'status': 'EXACT_EXTERNAL_RECOVERY_COMPLETE_ORIGINAL_COORDINATOR_FAIL_UNCHANGED',
            'root': self.expected['root'], 'schema': self.expected['schema'],
            'pid': self.expected['pid'], 'source': self.raw['source_fingerprint'],
            'originalRun': 'files-gates.json33actualtypedPASS; observation.jsonoriginalUNKNOWNretained',
            'typed_count': 33, 'sqlTerminalBeforeDrop': {'otherConnections': 0, 'transactions': 0, 'locks': 0},
            'ownedSchemaEmpty': {'tableCount': 0}, 'schemaDropped': True,
            'shutdownCommandAcknowledged': True, 'daemonPidAbsent': True,
            'observerSocketClosed': True, 'shutdownCompleteLog': True,
            'noOpenFiles': True, 'rootRemoved': True,
            'claimsExcluded': ['CS01PASS', 'normalafterhookcompletion',
                'HTTPresultsoakminima', 'applicationrollback', 'daemonexitcode0']}
        # This is a synthetic 33-record bundle, not a claim that Inventory ran.
        # Preserve each original serialized record and its separately pinned hash;
        # neither a declared count nor rewritten normalized metadata is sufficient.
        self.receipt['files_batch'] = {
            'kind': 'SERIAL_ACTUAL_PROFILE_FILE_GATES',
            'status': 'PASS_33_CURRENT_FILE_GATES_FLOOR_PENDING', 'count': 33,
            'baseline': [{'plan': self.raw['spec_baseline']},
                         self.raw['source_fingerprint'], 'synthetic-commit'],
            'results': []}
        self.receipt['typed_records'] = {}
        self.suite_map = {}
        self.receipt['original_sha256'] = {}
        for number in range(33):
            original = copy.deepcopy(self.raw)
            if number:
                original.update(run_id='synthetic-files-%02d' % number,
                                suite_id='synthetic-files-suite-%02d' % number)
            self.suite_map[original['suite_id']] = dict(copy.deepcopy(self.suite), id=original['suite_id'])
            original['command_contract_sha256'] = synthetic_contract_hash(self.suite_map[original['suite_id']])
            path = 'evidence/' + original['run_id'] + '/run.json'
            text = json.dumps(original, sort_keys=True, separators=(',', ':')) + '\n'
            digest = hashlib.sha256(text.encode()).hexdigest()
            self.receipt['typed_records'][path] = {
                'raw': original, 'original_text': text, 'sha256': digest}
            self.receipt['original_sha256'][path] = digest
            self.receipt['files_batch']['results'].append({
                'suite': original['suite_id'], 'result': {
                    'status': 'RECORDED', 'run_result': 'PASS',
                    'evidence_file': path, 'issues': []}})
        self.adoption = {'approved': True, 'runtime_instance_id': self.raw['runtime_instance_id'],
            'source': self.raw['source_fingerprint'], 'typed_count': 33,
            'approval_ref': 'synthetic-exact-recovery-adoption',
            'original_sha256': copy.deepcopy(self.receipt['original_sha256'])}


class HarnessResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.records = {}

    def addSuccess(self, test):
        super().addSuccess(test)
        self.records[test.id()] = 'PASS'

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.records[test.id()] = 'FAIL'

    def addError(self, test, err):
        super().addError(test, err)
        self.records[test.id()] = 'FAIL'

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.records[test.id()] = 'SKIPPED'

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            self.records[test.id()] = 'FAIL'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(GateBindingTests)
    names = [test.id() for test in suite]
    result = unittest.TextTestRunner(verbosity=2, resultclass=HarnessResult).run(suite)
    report = {'tests': [{'name': name, 'status': result.records.get(name, 'NOT_RUN')} for name in names]}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    if len(names) != 80 or len(set(names)) != 80:
        return 1
    return 0 if result.wasSuccessful() and all(t['status'] == 'PASS' for t in report['tests']) else 1


if __name__ == '__main__':
    sys.exit(main())
