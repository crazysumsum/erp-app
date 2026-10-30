#!/usr/bin/env python3
"""Read-only Inventory PHASE-005 evidence applicability; never new test execution.

CLI collectors supply verified inputs to the decision helpers. Unit fixtures may
exercise those helpers independently; the CLI never accepts a pre-approved bundle.
"""
from __future__ import annotations

import sys
sys.dont_write_bytecode = True
import argparse
import copy
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

MODULE = 'inventory-management'
LOCAL_PRIVATE_TMP_ROOT = Path('/private/tmp')
BINDINGS = {'EVIDENCE_RUNTIME', 'EVIDENCE_SPEC', 'EVIDENCE_SOURCE'}
TOOLS = {'server/scripts/inventoryPhase005Gate.py',
         'server/scripts/inventoryPhase005Gate.test.py',
         'server/test-support/inventoryPhase005GateNative.mjs.txt'}
NEW_SUITES = {'inventory-task041-gate-binding-unit', 'inventory-task041-gate-binding-native'}
FILE_RUNTIME = 'erp-inventory-task041-hd227-files-mysql-2670.xxSf30'
SEED_SOURCE = '956a861141cfef0fd71625157706c56f817036d60eca5466c96332b66b1cc330'
SEED_PLAN = '44f7a236caece4a9813014ae1a4950bd187ac04b7f41aa15f79086165d425dfe'


class Blocked(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def issue(code, path='', message='Evidence proof is incomplete or inconsistent'):
    return {'code': code, 'path': path, 'message': message}


def resource_snapshot_issues(snapshot, expected):
    """Terminal SQL proof requires actual identity and all six observations."""
    if not isinstance(snapshot, dict) or not isinstance(expected, dict):
        return [issue('RESOURCE_IDENTITY_REQUIRED')]
    mysql = snapshot.get('mysql', {})
    if (any(type(expected.get(k)) is not str or not expected[k] for k in ('schema', 'socket', 'datadir'))
            or snapshot.get('schema') != expected.get('schema') or type(snapshot.get('schema')) is not str
            or not isinstance(mysql, dict) or mysql.get('version') != '26.7.0'
            or type(mysql.get('isolated')) is not int or mysql['isolated'] != 1
            or any(type(mysql.get(k)) is not str or mysql[k] != expected.get(k) for k in ('socket', 'datadir'))):
        return [issue('RESOURCE_IDENTITY')]
    return [issue('RESOURCE_TERMINAL_UNKNOWN', k) for k in
            ('connections', 'transactions', 'locks', 'threads', 'statements', 'waits')
            if snapshot.get(k) != [] or type(snapshot.get(k)) is not list]


def sha(value):
    return hashlib.sha256(value).hexdigest()


def timestamp(value):
    try:
        result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None or result > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5):
            raise ValueError('unbounded timestamp')
        return result
    except (AttributeError, TypeError, ValueError) as error:
        raise Blocked('EVIDENCE_TIMESTAMP') from error


def source_issues(before, current, allowed_tools, ci_expected_hash, excluded_inputs):
    """Compare complete observed maps plus inputs outside the generic fingerprint."""
    errors = []
    if not isinstance(before, dict) or not before or not isinstance(current, dict) or not current:
        return [issue('SOURCE_MAP_REQUIRED')]
    extra = excluded_inputs or {}
    if not all(k in extra for k in ('before', 'after', 'dependency_complete', 'approved', 'original_suite')):
        return [issue('INPUT_CLOSURE_REQUIRED')]
    if extra['dependency_complete'] is not True or extra['approved'] is not True:
        errors.append(issue('INPUT_CLOSURE_UNKNOWN'))
    if not isinstance(extra['before'], dict) or not extra['before'] or extra['before'] != extra['after']:
        errors.append(issue('EXCLUDED_INPUT_CHANGED'))
    for name in set(before) | set(current):
        old, new = before.get(name), current.get(name)
        if old == new:
            continue
        if (extra['original_suite'] is True and name in TOOLS and name in allowed_tools
                and old is None and new == allowed_tools[name]
                and new.get('symlink') is None and new.get('mode') in ('100644', '100755')):
            continue
        if (name == '.github/workflows/ci.yml' and extra['original_suite'] is True
                and old and new and old.get('sha256') == extra.get('ci_before_sha256')
                and new.get('sha256') == ci_expected_hash and ci_expected_hash
                and extra.get('ci_patch_verified') is True
                and old.get('mode') == new.get('mode') and not old.get('symlink') and not new.get('symlink')):
            continue
        errors.append(issue('SOURCE_INPUT_CHANGED', name))
    return errors


def classify_attempt(raw, suite, proof):
    """Classify validated maps/contracts; a caller-supplied kind alone is no proof."""
    unknown = {'kind': 'UNKNOWN', 'verified': False, 'suite_id': suite['id'],
               'source_issues': [issue('EQUIVALENCE_UNKNOWN')], 'spec_issues': [], 'external_issues': []}
    required = ('kind', 'before_suite', 'after_suite', 'before_source_map', 'current_source_map',
                'allowed_tools', 'ci_expected_hash', 'excluded_inputs', 'before_plan', 'after_plan',
                'approved_plan_pair', 'approved_plan_scope', 'approval_ref', 'independent_review_ref',
                'external_inputs', 'original_source', 'current_source')
    if not isinstance(proof, dict) or any(k not in proof for k in required):
        return unknown
    if proof['kind'] not in ('EXACT', 'ADMIN_EQUIVALENT', 'NON_EQUIVALENT'):
        return unknown
    spec = []
    if proof['before_suite'] != suite or proof['after_suite'] != suite:
        spec.append(issue('SUITE_SEMANTICS_CHANGED'))
    if (proof['before_plan'] != raw.get('spec_baseline')
            or proof['approved_plan_pair'] != [proof['before_plan'], proof['after_plan']]
            or proof['approved_plan_scope'] != 'INVENTORY_PHASE005_GATE_ONLY'
            or not proof['approval_ref'] or not proof['independent_review_ref']):
        spec.append(issue('PLAN_EQUIVALENCE_UNKNOWN'))
    before, current = proof['before_source_map'], proof['current_source_map']
    # A reviewed unrelated-document projection is separate from the raw maps.
    unrelated = proof.get('reviewed_unrelated')
    if unrelated:
        names, inputs = unrelated.get('changed_paths', []), unrelated.get('suite_inputs', [])
        if (not names or not inputs or not unrelated.get('independent_review_ref')
                or set(names) & set(inputs)
                or any(not n.startswith('docs/') or n.startswith('docs/inventory_management/') for n in names)):
            return unknown
        if set(n for n in set(before) | set(current) if before.get(n) != current.get(n)) != set(names):
            return unknown
        for name in names:
            if not before.get(name) or not current.get(name) or any(
                    x.get('symlink') or x.get('mode') != '100644' for x in (before[name], current[name])):
                return unknown
        before = {k: v for k, v in before.items() if k not in names}
        current = {k: v for k, v in current.items() if k not in names}
    excluded = dict(proof['excluded_inputs'])
    if suite['id'] in NEW_SUITES:
        excluded['original_suite'] = False
    source = (hd233_source_issues(raw, suite, proof) if 'hd233' in proof else
              source_issues(before, current, proof['allowed_tools'], proof['ci_expected_hash'], excluded))
    if proof['original_source'] != raw.get('source_fingerprint'):
        source.append(issue('ORIGINAL_SOURCE_MISMATCH'))
    kind = 'EXACT' if (proof['original_source'] == proof['current_source']
                       and proof['before_plan'] == proof['after_plan']) else 'ADMIN_EQUIVALENT'
    if suite['id'] in NEW_SUITES and kind != 'EXACT':
        source.append(issue('ADAPTER_SOURCE_MUST_BE_EXACT'))
    external = proof['external_inputs']
    external_errors = []
    if (not isinstance(external, dict) or external.get('immutable') is not True
            or not external.get('before') or external.get('before') != external.get('after')):
        external_errors.append(issue('EXTERNAL_INPUT_UNKNOWN'))
    # Only a complete, positively different source input can exclude an attempt.
    # Missing maps, unknown dependencies and labels never prove non-equivalence.
    if (proof['kind'] == 'NON_EQUIVALENT' and not spec and not external_errors
            and source and all(x['code'] == 'SOURCE_INPUT_CHANGED' for x in source)
            and proof['original_source'] != proof['current_source']
            and all(k in before and k in current for k in (x['path'] for x in source))):
        return {'kind': 'NON_EQUIVALENT', 'verified': True, 'suite_id': suite['id'],
                'source_issues': source, 'spec_issues': [], 'external_issues': []}
    valid = not (source or spec or external_errors)
    return {'kind': kind if valid else 'UNKNOWN', 'verified': valid,
            'suite_id': suite['id'], 'source_issues': source, 'spec_issues': spec,
            'external_issues': external_errors}


def _native_worker_issues(receipt, observation):
    errors = []
    document = receipt.get('native_report')
    if not isinstance(document, dict):
        return [issue('NATIVE_REPORT_REQUIRED')]
    try:
        text, report = document['original_text'], document['raw']
        binding = observation['nativeOwnership']
        if (sha(text.encode()) != document['sha256'] or json.loads(text) != report
                or document['path'] != binding['reportPath'] or document['sha256'] != binding['sha256']):
            return [issue('NATIVE_REPORT_INTEGRITY')]
        stops = binding['ownedStops']
        sql = report['ownedSql']
        if (not stops or report['ownedStops'] != stops or report.get('workerCleanupErrors')
                or report['cleanup'] != 'CHILD_EXIT_AND_SQL_TERMINAL_CONFIRMED'
                or sql['status'] != 'SQL_TERMINAL_CONFIRMED'):
            return [issue('WORKER_TERMINAL_UNKNOWN')]
        workers = sql['workers']
        if (len(stops) != len(workers) or len({s['incarnation'] for s in stops}) != len(stops)
                or {s['incarnation'] for s in stops} != {w['incarnation'] for w in workers}):
            return [issue('WORKER_IDENTITY')]
        for stop in stops:
            exit_ = stop.get('exit')
            if (type(stop.get('incarnation')) is not str or not stop['incarnation'].strip()
                    or stop.get('terminal') is not True or type(stop.get('pid')) is not int
                    or stop['pid'] <= 0 or not isinstance(exit_, dict)
                    or not ((isinstance(exit_.get('code'), int) and exit_.get('signal') is None)
                            or (exit_.get('code') is None and exit_.get('signal') in ('SIGTERM', 'SIGKILL')))):
                errors.append(issue('WORKER_TERMINAL_UNKNOWN'))
                continue
            worker = next(w for w in workers if w['incarnation'] == stop['incarnation'])
            connections, samples = worker['connections'], worker['latest']
            ids = [c['threadId'] for c in connections]
            elapsed = worker['completeMs']
            if (worker['status'] != 'SQL_TERMINAL_CONFIRMED' or not connections
                    or len(set(ids)) != len(ids) or len(set(stop['connections'])) != len(ids)
                    or set(ids) != set(stop['connections']) or len(samples) != len(ids)
                    or not isinstance(elapsed, (int, float)) or isinstance(elapsed, bool)
                    or not math.isfinite(elapsed) or not 0 <= elapsed <= 20000):
                errors.append(issue('WORKER_SQL_UNKNOWN'))
                continue
            keyed = all('threadId' in sample and 'performanceThreadId' in sample for sample in samples)
            positional = all('threadId' not in sample and 'performanceThreadId' not in sample for sample in samples)
            if (not keyed and not positional) or (keyed and {sample['threadId'] for sample in samples} != set(ids)):
                errors.append(issue('WORKER_SQL_UNKNOWN')); continue
            for connection in connections:
                if (type(connection['threadId']) is not int or connection['threadId'] <= 0
                        or type(connection.get('performanceThreadId')) is not int
                        or connection['performanceThreadId'] <= 0
                        or connection.get('incarnation') != stop['incarnation']
                        or connection.get('provenance') != 'SAME_CONNECTION_DRIVER_QUERY'
                        or not connection.get('nonce')):
                    errors.append(issue('WORKER_IDENTITY'))
            for index, sample in enumerate(samples):
                connection = (next(c for c in connections if c['threadId'] == sample['threadId'])
                              if keyed else connections[index])
                histories_match = all(type(sample.get(field)) is list and sample[field] == connection.get(field)
                                      for field in ('observedTransactionIds', 'observedEngineTokens'))
                if (sample.get('terminal') is not True or sample.get('states') != []
                        or sample.get('threads') != [] or sample.get('activeStatement') is not False
                        or (keyed and sample['performanceThreadId'] != connection.get('performanceThreadId'))
                        or not histories_match
                        or any(type(sample.get(k)) is not int or sample[k] != 0
                               for k in ('transactions', 'locks', 'waits', 'retainedTransactions', 'relatedWaits'))):
                    errors.append(issue('WORKER_SQL_UNKNOWN'))
    except (KeyError, TypeError, ValueError, StopIteration):
        errors.append(issue('NATIVE_REPORT_INCOMPLETE'))
    return errors


def _files_recovery_issues(raw, receipt, adoption, suite_map):
    errors = []
    observation, recovery = receipt.get('observation', {}), receipt.get('recovery') or {}
    if (not adoption or adoption.get('approved') is not True or not adoption.get('approval_ref')
            or adoption.get('runtime_instance_id') != FILE_RUNTIME
            or raw.get('runtime_instance_id') != FILE_RUNTIME
            or raw.get('source_fingerprint') != SEED_SOURCE or raw.get('spec_baseline') != SEED_PLAN
            or adoption.get('source') != SEED_SOURCE
            or observation.get('status') != 'FAIL' or observation.get('kind') != 'OWNED_RUNTIME_FOR_33_CURRENT_PROFILE_FILE_GATES_NOT_CAPACITY'
            or observation.get('suiteId') != 'hd227-file-gates'
            or observation.get('selectedSuite', {}).get('id') != 'hd227-file-gates'
            or observation.get('cleanup') != 'UNKNOWN_OWN_ROOT_RETAINED'):
        return [issue('RECOVERY_NOT_AUTHORIZED')]
    expected = receipt['binding']
    if (recovery.get('status') != 'EXACT_EXTERNAL_RECOVERY_COMPLETE_ORIGINAL_COORDINATOR_FAIL_UNCHANGED'
            or recovery.get('kind') != 'FILES_COORDINATOR_STATUS_LABEL_EXTERNAL_RECOVERY'
            or any(recovery.get(k) != expected[k] for k in ('root', 'schema', 'pid'))
            or recovery.get('source') != SEED_SOURCE
            or recovery.get('ownedSchemaEmpty') != {'tableCount': 0}
            or recovery.get('sqlTerminalBeforeDrop') != {'otherConnections': 0, 'transactions': 0, 'locks': 0}
            or not all(recovery.get(k) is True for k in ('schemaDropped', 'daemonPidAbsent',
                       'observerSocketClosed', 'shutdownCompleteLog', 'noOpenFiles', 'rootRemoved'))
            or 'applicationrollback' not in recovery.get('claimsExcluded', [])
            or 'daemonexitcode0' not in recovery.get('claimsExcluded', [])):
        errors.append(issue('RECOVERY_TERMINAL_UNKNOWN'))
    batch = receipt.get('files_batch', {})
    records, expected_hashes = receipt.get('typed_records', {}), adoption.get('original_sha256', {})
    paths, suites = set(), set()
    selected = False
    try:
        rows = batch['results']
        if len(rows) != 33 or batch['status'] != 'PASS_33_CURRENT_FILE_GATES_FLOOR_PENDING':
            raise ValueError('Incomplete batch')
        for row in rows:
            path = row['result']['evidence_file']
            item = records[path]
            record, text = item['raw'], item['original_text']
            contract = suite_map[record['suite_id']]
            if (path in paths or record['suite_id'] in suites or row['suite'] != record['suite_id']
                    or contract['id'] != record['suite_id'] or contract.get('side_effects') != ['FILES']
                    or record.get('command_contract_sha256') != sha(json.dumps(contract, ensure_ascii=False,
                        sort_keys=True, separators=(',', ':'), allow_nan=False).encode())
                    or expected_hashes.get(path) != sha(text.encode()) or item['sha256'] != expected_hashes[path]
                    or json.loads(text) != record or row['result']['run_result'] != 'PASS'
                    or record['result'] != 'PASS' or record['exit_code'] != 0 or record['timed_out']
                    or not record['code_unchanged'] or not record['spec_unchanged']
                    or record['runtime_instance_id'] != FILE_RUNTIME
                    or record['source_fingerprint'] != SEED_SOURCE or record['spec_baseline'] != SEED_PLAN
                    or any(record['counts'][k] != 0 for k in ('failed', 'skipped', 'not_run'))):
                raise ValueError('Inconsistent original record')
            counts = record['counts']
            cases = {case['id']: case['status'] for case in record['cases']}
            if (counts['total'] != counts['passed'] or counts['passed'] < contract['min_tests']
                    or len(cases) != len(record['cases'])
                    or any(cases.get(name) != 'PASS' for name in contract['required_case_ids'])):
                raise ValueError('Original child did not satisfy its full current contract')
            paths.add(path); suites.add(record['suite_id']); selected |= record == raw
        if not selected or set(records) != paths or set(expected_hashes) != paths:
            raise ValueError('Selected original or registry absent')
    except (KeyError, TypeError, ValueError):
        errors.append(issue('RECOVERY_ORIGINAL_RECORDS'))
    return errors


def runtime_proof_issues(raw, receipt, policy):
    if isinstance(receipt, dict) and receipt.get('recipe', {}).get('kind') == 'HD235':
        return hd235_runtime_issues(raw, receipt, policy)
    """Check original observations and independently bound resource facts."""
    if not receipt or receipt.get('approved') is not True or not isinstance(policy, dict):
        return [issue('RUNTIME_PROOF_REQUIRED')]
    if 'recipe' in receipt:
        return hd233_runtime_issues(raw, receipt, policy)
    expected = policy.get('expected')
    binding = receipt.get('binding')
    resource_binding = ({key: value for key, value in expected.items()
                         if key not in ('preview_argv', 'harness_runner_path')} if isinstance(expected, dict) else None)
    if not isinstance(expected, dict) or not expected or binding != resource_binding:
        return [issue('RUNTIME_BINDING_MISMATCH')]
    observation = receipt.get('observation', {})
    errors = []
    if receipt.get('runtime_instance_id') != raw.get('runtime_instance_id'):
        errors.append(issue('RUNTIME_IDENTITY'))
    try:
        if (observation['repo'] != expected['workspace'] or observation['root'] != expected['root']
                or observation['schema'] != expected['schema']
                or observation['mysql']['version'] != '26.7.0'
                or observation['mysql']['socket'] != expected['socket']
                or observation['mysql']['datadir'].rstrip('/') != expected['datadir'].rstrip('/')
                or raw['data_reference'] != expected['data_reference']):
            errors.append(issue('RESOURCE_IDENTITY'))
    except (KeyError, TypeError, AttributeError):
        return errors + [issue('RESOURCE_IDENTITY_REQUIRED')]
    proof = receipt.get('resource_proof', {})
    fields = ('worker_terminal', 'sql_terminal', 'transaction_terminal', 'lock_terminal',
              'socket_terminal', 'schema_dropped', 'root_removed')
    if not all(proof.get(k) is True for k in fields):
        errors.append(issue('RESOURCE_TERMINAL_UNKNOWN'))
    if receipt.get('recovery'):
        return errors + _files_recovery_issues(raw, receipt, policy.get('approved_recovery'), policy.get('suite_map', {}))
    try:
        typed = receipt['typed_record']
        suite = policy['suite_map'][raw['suite_id']]
        path = 'evidence/' + raw['run_id'] + '/run.json'
        digest = sha(typed['original_text'].encode())
        response = observation['runnerResponse']
        runners = [command for command in observation['commands'] if command.get('label') == 'harness-runner']
        if len(runners) != 1: raise ValueError('Actual Harness runner command missing')
        runner = runners[0]
        runner_script = expected.get('harness_runner_path', runner['args'][0])
        if not runner_script.endswith('/run_check.py'): raise ValueError('Unknown Harness runner')
        if runner['args'] != [runner_script, 'docs/inventory_management', '--repo-root', expected['workspace'],
                             '--suite', raw['suite_id'], '--stage', 'DEVELOPER', '--execute', '--json'] or runner['cwd'] != expected['workspace']:
            raise ValueError('Actual Harness invocation differs')
        if (typed['path'] != path or typed['raw'] != raw or json.loads(typed['original_text']) != raw
                or typed['sha256'] != digest
                or observation['typedEvidence'] != {'path': path, 'sha256': digest, 'counts': raw['counts']}
                or observation['suiteId'] != raw['suite_id'] or observation['selectedSuite'] != suite
                or any(response.get(key) != value for key, value in
                       {'status': 'RECORDED', 'run_result': 'PASS', 'evidence_file': path, 'issues': []}.items())
                or observation['runnerExit'] != {'code': 0, 'signal': None}
                or observation['expandedArgv'] != expected.get('preview_argv', raw['command'])
                or observation['hashesBefore']['executedNode'] != expected['node_sha256']
                or observation['hashesBefore']['executedMySQL'] != expected['mysql_sha256']
                or observation['mysqlBinaryHash'] != expected['mysql_sha256']
                or observation['deadlinesMs'] != {'initialize': 30000, 'startup': 10000,
                    'test': suite['timeout_seconds'] * 1000, 'end': 10000, 'term': 5000, 'kill': 5000}):
            errors.append(issue('ACTUAL_RUNTIME_BINDING'))
    except (KeyError, TypeError, ValueError):
        errors.append(issue('ACTUAL_RUNTIME_BINDING_REQUIRED'))
    if (observation.get('cleanup') != 'OWN_SCHEMA_DROPPED_NORMAL_DAEMON_EXIT0_EXACT_ROOT_REMOVED'
            or observation.get('sourceFreeze') != 'MATCHED' or observation.get('cleanupErrors') != []
            or not observation.get('hashesBefore') or observation['hashesBefore'] != observation.get('hashesAfter')
            or observation.get('postTestSql') != {'connections': 0, 'transactions': 0, 'locks': 0}
            or proof.get('daemon_exit_zero') is not True):
        errors.append(issue('NORMAL_RUNTIME_NOT_CONFIRMED'))
    terminal = observation.get('terminal', {})
    if not all(terminal.get(k) is True for k in ('sqlTerminal', 'dropped', 'normalShutdown', 'observerSocketClosed')):
        errors.append(issue('NORMAL_TERMINAL_UNKNOWN'))
    daemons = [p for p in observation.get('processes', []) if p.get('label') == 'daemon']
    if (len(daemons) != 1 or daemons[0].get('pid') != expected['pid']
            or daemons[0].get('settled') is not True or daemons[0].get('groupTerminal') is not True
            or daemons[0].get('result') != {'code': 0, 'signal': None}):
        errors.append(issue('DAEMON_TERMINAL_UNKNOWN'))
    for process in observation.get('processes', []):
        if (process.get('settled') is not True or process.get('groupTerminal') is not True
                or process.get('result') != {'code': 0, 'signal': None}):
            errors.append(issue('PROCESS_TERMINAL_UNKNOWN'))
    errors.extend(_native_worker_issues(receipt, observation))
    return errors


def select_latest(attempts):
    relevant = []
    for attempt in attempts:
        classification = attempt.get('classification')
        kind = (classification.get('kind') if isinstance(classification, dict)
                and classification.get('verified') is True else 'UNKNOWN')
        ended = timestamp(attempt['raw'].get('ended_at'))
        if kind != 'NON_EQUIVALENT':
            relevant.append((ended, attempt, kind))
    if not relevant:
        raise Blocked('REQUIRED_RUN_MISSING')
    latest = max(value[0] for value in relevant)
    tied = [value for value in relevant if value[0] == latest]
    if len(tied) != 1:
        raise Blocked('ATTEMPT_ORDER_AMBIGUOUS')
    _, selected, kind = tied[0]
    if kind not in ('EXACT', 'ADMIN_EQUIVALENT'):
        raise Blocked('LATER_EQUIVALENCE_UNKNOWN')
    if selected['raw'].get('result') != 'PASS':
        raise Blocked('LATEST_ATTEMPT_NOT_PASS')
    return selected


def validate_attempt(ctx, suite, raw, classification, runtime_issues, core):
    # Mandatory direct call: the generic baseline selector may never visit this raw run.
    direct = core.evidence_issues(ctx, raw, suite, 'DEVELOPER')
    errors = list(runtime_issues)
    if getattr(ctx, 'phase', 'PHASE-005') != 'PHASE-005' or getattr(ctx, 'gate', 'MERGE_READY') != 'MERGE_READY':
        errors.append(issue('GATE_SCOPE'))
    valid = (isinstance(classification, dict) and classification.get('verified') is True
             and classification.get('suite_id') == suite['id']
             and classification.get('kind') in ('EXACT', 'ADMIN_EQUIVALENT')
             and all(k in classification and classification[k] == []
                     for k in ('source_issues', 'spec_issues', 'external_issues')))
    if not valid:
        errors.append(issue('APPLICABILITY_UNKNOWN'))
    if (raw.get('result') != 'PASS' or raw.get('exit_code') != 0 or raw.get('timed_out') is not False
            or raw.get('module_id') != ctx.module_id or raw.get('suite_id') != suite['id']
            or raw.get('stage') != 'DEVELOPER' or raw.get('code_unchanged') is not True
            or raw.get('spec_unchanged') is not True):
        errors.append(issue('ORIGINAL_RUN_NOT_PASS'))
    errors.extend(item for item in direct if not (item['code'] in BINDINGS and valid and not runtime_issues))
    return {'suite_id': suite['id'], 'status': 'APPLICABLE' if not errors else 'UNKNOWN',
            'issues': errors, 'raw': raw, 'resource_proven': not runtime_issues}


def resolve_core_issues(core_issues, validated_results, required_ids):
    good = {sid: value for sid, value in validated_results.items()
            if sid in required_ids and value.get('status') == 'APPLICABLE'
            and value.get('issues') == [] and value.get('resource_proven') is True}
    all_proven = bool(required_ids) and set(required_ids) <= set(good)
    paths = {'evidence/' + value['raw']['run_id']: sid for sid, value in good.items()}
    resources = {'state/runtime/resources/' + name for name in ('mysql-schema', 'web-port', 'opening-file-root')}
    remaining = []
    for item in core_issues:
        code, path = item['code'], item.get('path', '')
        resolved = (code in BINDINGS and path in paths)
        resolved |= (code == 'REQUIRED_RUN_MISSING' and path.startswith('gate/DEVELOPER/')
                     and path.removeprefix('gate/DEVELOPER/') in good)
        resolved |= code == 'RUNTIME_RESOURCE' and path in resources and all_proven
        if not resolved:
            remaining.append(item)
    return remaining


def native_preflight(report_dir):
    """Execute the exact source-only native probe; allocation stays caller-owned."""
    repo = Path(__file__).resolve().parents[2]
    directory = report_dir.resolve(strict=True)
    evidence = repo / 'docs/inventory_management/evidence'
    if (not directory.is_relative_to(evidence) or report_dir.is_symlink()
            or os.environ.get('DB_INTEGRATION_TESTS') != '1'
            or os.environ.get('INVENTORY_GATE_BINDING_TESTS') != '1'
            or os.environ.get('DB_USER') != 'root'
            or not re.fullmatch(r'erp_inventory_gate_binding_[a-f0-9]{12}', os.environ.get('DB_NAME', ''))
            or not re.fullmatch(re.escape(str(LOCAL_PRIVATE_TMP_ROOT)) + r'/erp-inventory-task041-gate-binding-mysql-2670\.[A-Za-z0-9]+/mysql\.sock',
                                os.environ.get('DB_SOCKET_PATH', ''))):
        raise Blocked('NATIVE_RESOURCE_SCOPE')
    source = repo / 'server/test-support/inventoryPhase005GateNative.mjs.txt'
    owner = Path(os.environ.get('TMPDIR', ''))
    if (not owner.is_absolute() or owner.is_symlink() or owner.resolve(strict=True) != owner
            or str(owner) + '/mysql.sock' != os.environ['DB_SOCKET_PATH']
            or owner.stat().st_uid != os.geteuid() or owner.stat().st_mode & 0o077):
        raise Blocked('NATIVE_PRIVATE_EXECUTION_OWNER')
    native = owner / 'inventoryPhase005GateNative.mjs'
    archive = directory / 'inventoryPhase005GateNative.mjs.txt'
    original = source.read_bytes(); digest = sha(original)
    for target in (native, archive):
        with target.open('xb') as handle:
            os.fchmod(handle.fileno(), 0o600); handle.write(original); handle.flush(); os.fsync(handle.fileno())
        if sha(target.read_bytes()) != digest: raise Blocked('NATIVE_SOURCE_CHANGED')
    for folder in (owner, directory):
        fd = os.open(folder, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    node = shutil.which('node')
    if not node: raise Blocked('NODE_REQUIRED')
    env = dict(os.environ, HD228_PYTHON_EXECUTABLE=sys.executable, HD228_REPO_ROOT=str(repo))
    command = [node, '--test', '--test-concurrency=1', '--test-reporter=junit',
               '--test-reporter-destination=' + str(directory / 'inventory-task041-gate-binding-native.xml'), str(native)]
    proof = {'kind': 'ACTUAL_NATIVE_PRIVATE_EXECUTABLE', 'repo': str(repo), 'owner_root': str(owner),
        'source_path': source.relative_to(repo).as_posix(), 'source_sha256': digest,
        'archive_path': archive.relative_to(repo).as_posix(), 'archive_sha256': digest,
        'executed_path': str(native), 'executed_before_sha256': digest,
        'node': {'path': node, 'realpath': str(Path(node).resolve()), 'sha256': file_hash(Path(node).resolve())},
        'command': command, 'cwd': str(repo), 'started_at': dt.datetime.now(dt.timezone.utc).isoformat(),
        'exit_code': None, 'status': 'NOT_RUN'}
    original_error = None
    try:
        # The unchanged600s Harness owns this process group and its private copy.
        result = subprocess.run(command, cwd=repo, env=env, check=False)
        proof['exit_code'] = result.returncode
        proof['executed_after_sha256'] = file_hash(native)
        proof['archive_after_sha256'] = file_hash(archive)
        if native.is_symlink() or archive.is_symlink() or proof['executed_after_sha256'] != digest or proof['archive_after_sha256'] != digest:
            raise Blocked('NATIVE_EXECUTABLE_CHANGED')
        report_source = owner / 'inventory-phase005-gate-native.json'
        report_archive = directory / 'inventory-phase005-gate-native.json'
        if report_source.exists():
            if report_source.is_symlink() or not report_source.is_file(): raise Blocked('NATIVE_REPORT_PATH')
            payload = report_source.read_bytes()
            with report_archive.open('xb') as handle:
                os.fchmod(handle.fileno(), 0o600); handle.write(payload); handle.flush(); os.fsync(handle.fileno())
            if file_hash(report_archive) != sha(payload) or file_hash(report_source) != sha(payload):
                raise Blocked('NATIVE_REPORT_CHANGED')
            proof['native_report'] = {'executed_path': str(report_source),
                'archive_path': report_archive.relative_to(repo).as_posix(), 'sha256': sha(payload)}
        else:
            proof['native_report_missing'] = True
            if result.returncode == 0: raise Blocked('NATIVE_REPORT_MISSING')
        proof['status'] = 'EXECUTED_SOURCE_UNCHANGED'
    except (OSError, ValueError, Blocked) as error:
        original_error = error
        proof['status'] = 'UNKNOWN'; proof['error'] = {'name': type(error).__name__, 'message': str(error)}
    finally:
        proof['ended_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
        with (directory / 'inventory-phase005-native-executable.json').open('x', encoding='utf-8') as handle:
            json.dump(proof, handle, ensure_ascii=False, indent=2); handle.write('\n'); handle.flush(); os.fsync(handle.fileno())
        fd = os.open(directory, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    if original_error: raise original_error
    return result.returncode


HARNESS_PIN = '337fa06089a3c516da882e68b2e5be22565581503bd9d2a8fc591fc23ad65113'
PARENT_BASELINES = {'design': '8c91eef5beb5e54ea1dc2f438d56ed4ab3f81b9e999035d8d35d5210fb6dd854',
                    'plan': '84000d1f71f0e6174c35a51073f34932cb538fdec4ad48b5c7f862f22c8672ce'}
LEGACY_APPROVED_BASELINES = {'design': '495aaaba57c5a672a5f1bb4339f25ddda410dcad5e439b42e8648aaa8f60f0df',
                      'plan': 'dcce2cfc7579b74f0e3a1f6363edb61ed191ea4601a52a9096bd66282ef22fde'}
APPROVED_BASELINES = {'design': '036c3d611d2c1afd383d78dc476ed12a6c1d5eb8f1561b4f2803b5096006be97', 'plan': '058dea73ad702e552711348f249ec9911eeb52713fc63f2bfd3f84015055153c'}
HD230_CANONICAL_PINS = {'docs/inventory_management/03_design_spec.md': 'e23000c322362b654d70def3e03aee5d1705ac9ffeb2b9f3da95a16494302fa8', 'docs/inventory_management/00_module_manifest.json': 'fb96a03baf49b1f94005bb1116b94e9b8e53260d231715e4d4c9e2ef10e882dd', 'docs/inventory_management/05_development_tasks.md': 'b0465ee41a20e52ca8d039e6f5464f89818b6cd2a121521bcb29fd68c1476e09'}
SEED_REGISTRY = 'implementation/task041-hd227-local-gate-status.json'
SEED_MAP = 'implementation/task041-hd227-observed-full-source-map.json'
FILES_RECEIPT = 'evidence/task041-hd227-files-runtime-hd227-file-gates-4f5df5186756/observation.json'
CHAR_RECEIPT = 'evidence/task041-hd227-full-native-inventory-task041-characterization-c269aa132128/observation.json'
PINNED_DOCUMENTS = {
    SEED_REGISTRY: 'da7c3b217f1c5c6feaebc1fe7c71083a49f6f4ed2c9ebff08195c7d1fed2cb13',
    SEED_MAP: '6dbf719eb409a39d1ef312d6bda9bb7b82588a434ba40b08c217f30c9a40a765',
    FILES_RECEIPT: '2e9746ecd0eaa945f5a57f3f44422a2989c6c593dc044484824fad5f5ad90226',
    CHAR_RECEIPT: 'd716c68ec2e24785fe3d151b37156529aab9b91632bf8e4d90f2db11373ed1f2',
    'evidence/task041-hd227-files-runtime-hd227-file-gates-4f5df5186756/recovery/recovery.json':
        '05ac1fd14289cf194234758aa29ed469d8e8e49b35107dd89c631e10ff41e805',
    'implementation/task041-hd228-gate-binding-candidate.json':
        '4ac7123836318aee225d4edb6032e12bd52ac763ccfe67c7d6c3b79cb51a0118',
    'implementation/task041-hd228-gate-binding-canonical.patch.txt':
        'da56f0a70c1f932b37906757a5994a97e715bce0c01353511726db171047188b',
    'implementation/task041-hd229-candidate.json':
        '61a3c090a32ef5ce488b349e1a92921301f508fb26f72462890be036c7177419',
    'implementation/task041-hd229-scope-metadata.patch.txt':
        '63177d92f774c332e7e667f51fb17e3630d265fb047ac7ca22dd93816edabf97',
    'implementation/task041-hd229-protocol-fidelity.patch.txt':
        '1973fe4cd3f8a3b25d1548db53a9a6d5a473e6ac3c4eb30bcad40f55a240dbe2',
    'implementation/task041-hd229-native-projection.patch.txt':
        '915f1f3fe31e320afcfadecaa5f1d09650f23a887047d7ecaeb5d8cf2299d869'}
EXCLUDED_FIXTURES = {
    'implementation/hd227-before/characterization.before.txt': '9bfdfcdbdb41ae39d64447ce562e1b6a22850b5c902f58bccce5f5c7318577d2',
    'implementation/hd227-before/performance.before.txt': '7ae75302be15619fe3ffd2a8c2992b77b7b3f39652ad981389c901a4dd2033c6'}


def file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


_UNPINNED_DOCUMENT = object()

def original_document(root, name, expected_hash=_UNPINNED_DOCUMENT):
    if expected_hash is not _UNPINNED_DOCUMENT and (not isinstance(expected_hash, str) or not re.fullmatch(r'[a-f0-9]{64}', expected_hash)):
        raise Blocked('EVIDENCE_PIN_REQUIRED')
    path = root / name
    if not path.resolve(strict=True).is_relative_to(root.resolve()) or path.is_symlink():
        raise Blocked('EVIDENCE_PATH')
    digest = file_hash(path)
    if expected_hash is not _UNPINNED_DOCUMENT and digest != expected_hash:
        raise Blocked('EVIDENCE_TAMPERED')
    text = path.read_text(encoding='utf-8')
    return {'path': name, 'sha256': digest, 'original_text': text,
            'raw': json.loads(text) if path.suffix == '.json' else None}


def load_harness(scripts):
    """Pin the actual installed implementation before importing its checker."""
    trusted = Path('/Users/sam/.agents/skills/software-engineering-harness/scripts')
    if scripts.resolve(strict=True) != trusted.resolve(strict=True):
        raise Blocked('HARNESS_PATH')
    root = scripts.parent
    files = sorted(list(scripts.glob('*.py')) + list((root / 'schemas').glob('*.json')))
    observed = {str(p.relative_to(root)): file_hash(p) for p in files}
    digest = sha(json.dumps(observed, sort_keys=True, separators=(',', ':')).encode())
    if digest != HARNESS_PIN:
        raise Blocked('HARNESS_DRIFT')
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(scripts))
    import harness_core
    import harness_checks
    if Path(harness_checks.__file__).resolve() != (scripts / 'harness_checks.py').resolve():
        raise Blocked('HARNESS_IMPORT')
    return harness_core, harness_checks


def observed_source(core, repo, docs_path):
    records = []
    names = core.git(repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0')
    for name in sorted(set(names) - {''}):
        if name == docs_path or name.startswith(docs_path + '/'):
            continue
        p = core.inside(repo, name)
        if p.is_symlink(): records.append([name, 'symlink', os.readlink(p)])
        elif p.is_file(): records.append([name, bool(p.stat().st_mode & 0o111), file_hash(p)])
        elif not p.exists(): records.append([name, 'deleted'])
        else: raise Blocked('SOURCE_ENTRY_UNKNOWN')
    digest = core.digest(records)
    if digest != core.fingerprint(repo, docs_path):
        raise Blocked('SOURCE_CHANGED_DURING_READ')
    return digest, source_map(records)


def source_map(records):
    result = {}
    for row in records:
        name = row[0]
        if name in result: raise Blocked('SOURCE_MAP_DUPLICATE')
        if len(row) == 2 and row[1] == 'deleted': result[name] = {'deleted': True}
        elif len(row) == 3 and row[1] == 'symlink': result[name] = {'mode': '120000', 'symlink': row[2]}
        elif len(row) == 3 and type(row[1]) is bool:
            result[name] = {'sha256': row[2], 'mode': '100755' if row[1] else '100644', 'symlink': None}
        else: raise Blocked('SOURCE_MAP_FORMAT')
    return result


def historical_excluded_inputs(fixtures, ci):
    # These historical receipts contain no installed-package byte snapshot.
    # Matching tracked lockfiles/binaries cannot establish that missing input.
    return {'before': fixtures, 'after': fixtures, 'dependency_complete': False,
            'approved': True, 'original_suite': True,
            'ci_before_sha256': ci['before_sha256'], 'ci_patch_verified': True}


HD233_SOURCE = 'a1a3109e9c6e53be4ce81ff245f0ce4198d90beda4c1621c4ac01d6657058b8b'
HD233_PARENT_PLAN = '4101de16c8ea1b3a94920b3ab6f3a56734660c502c11e3a2a283edc6dca192dc'
HD233_BASELINES = {'design': '60ba99514dd4c3280208d48cd74830a241bacd6c9295eb25b35abb27cec86910',
                   'plan': 'd34893c1ad544206f95f5e48283cd2df9149c201ccc9a80ccac05705abcd3eef'}
HD233_DIRECT_PAIRS = (('inventory-task041-draft-lock-range-unit', 'inventory-task041-draft-lock-range-database'),
                     ('inventory-task036-unit', 'inventory-task036-database'),
                     ('inventory-task038-unit', 'inventory-task038-database'))
HD233_PREFLIGHT_SUITES = set(sum(HD233_DIRECT_PAIRS, ())) | NEW_SUITES
HD233_CANONICAL = {'docs/inventory_management/' + name for name in
    ('03_design_spec.md', '05_development_tasks.md', '00_module_manifest.json', '00_project_profile.json')}


def input_closure_issues(inputs):
    """CLI constructs this from original manifests; unit envelopes are synthetic."""
    try:
        before, after = inputs['before'], inputs['after']
        required = ({'node', 'npm', 'mysql', 'path', 'tools'}
                    if inputs.get('recipe') == 'CI_NODE_NATIVE' else
                    {'node', 'python', 'mysql', 'harness', 'path', 'tools'})
        if (inputs['complete'] is not True or inputs['resolved'] is not True or not before or before != after
                or not required <= set(before)):
            raise ValueError('Incomplete observed inputs')
        for record in before.values():
            if not re.fullmatch(r'[a-f0-9]{64}', record['sha256']): raise ValueError('Input digest')
            if record.get('symlink') is not None:
                target = record['resolved_target']
                if not re.fullmatch(r'[a-f0-9]{64}', target['sha256']): raise ValueError('Unresolved target')
        return []
    except (KeyError, TypeError, ValueError):
        return [issue('INPUT_CLOSURE_UNKNOWN')]


def hd233_source_issues(raw, suite, proof):
    errors = []
    try:
        policy = proof['hd233']
        if (suite['id'] not in set(sum(HD233_DIRECT_PAIRS, ()))
                or raw['source_fingerprint'] != HD233_SOURCE or policy['baseline_source'] != HD233_SOURCE
                or raw['spec_baseline'] != HD233_PARENT_PLAN or policy['baseline_plan'] != HD233_PARENT_PLAN
                or policy['candidate_plan'] != HD233_BASELINES['plan'] or proof['after_plan'] != policy['candidate_plan']):
            raise ValueError('Not the reviewed six-run mapping')
        errors += input_closure_issues(policy['installed_inputs'])
        before, after = proof['before_source_map'], proof['current_source_map']
        canonical = policy['canonical_expected']
        if set(canonical) != HD233_CANONICAL: raise ValueError('Canonical scope')
        for name, expected in canonical.items():
            if policy['canonical_before'][name] != expected['before'] or policy['canonical_after'][name] != expected['after']:
                raise ValueError('Canonical patch')
        observed = policy['observational_paths']
        if set(observed) != TOOLS | {'docs/inventory_management/00_project_profile.json'}:
            raise ValueError('Observational scope')
        imports, inputs = set(policy['producer_imports']), set(policy['suite_inputs'])
        if not inputs or not imports or (TOOLS & (inputs | imports)): raise ValueError('Executed adapter input')
        for name in set(before) | set(after):
            old, new = before.get(name), after.get(name)
            if old == new: continue
            if name not in TOOLS | HD233_CANONICAL or not old or not new:
                raise ValueError('Undeclared changed source')
            if (old.get('mode') != new.get('mode') or old.get('mode') != '100644'
                    or old.get('symlink') is not None or new.get('symlink') is not None):
                raise ValueError('Mode/symlink change')
            if name in canonical and (old != canonical[name]['before'] or new != canonical[name]['after']):
                raise ValueError('Canonical source mismatch')
            if name in observed:
                role = observed[name]
                if (role['before'] != old or role['after'] != new or role['role'] != 'OBSERVATIONAL_HASH_READ'
                        or not role.get('review_ref') or name in imports | inputs):
                    raise ValueError('Unknown input role')
        return errors
    except (KeyError, TypeError, ValueError):
        return errors + [issue('HD233_SOURCE_SCOPE_UNKNOWN')]


def hd233_runtime_issues(raw, receipt, policy):
    errors = []
    try:
        recipe, expected_recipe = receipt['recipe'], policy['recipe']
        producer = recipe['producer']
        if (recipe['kind'] != expected_recipe['kind'] or recipe['kind'] not in ('HD231_DIRECT', 'GATE_NATIVE_CHILD')
                or sha(producer['original_text'].encode()) != producer['sha256']
                or producer['sha256'] != expected_recipe['producer_sha256'] or receipt.get('recovery')):
            raise ValueError('Unsupported producer or recovery')
        errors += input_closure_issues(recipe['inputs'])
        expected, obs = policy['expected'], receipt['observation']
        binding = {k: v for k, v in expected.items() if k not in ('preview_argv', 'harness_runner_path')}
        if receipt.get('approved') is not True or receipt['binding'] != binding:
            raise ValueError('Resource binding')
        if (obs['repo'] != expected['workspace'] or obs['root'] != expected['root']
                or obs['schema'] != expected['schema'] or obs['mysql']['version'] != '26.7.0'
                or obs['mysql']['socket'] != expected['socket']
                or obs['mysql']['datadir'].rstrip('/') != expected['datadir'].rstrip('/')):
            raise ValueError('Runtime identity')
        fields = ('worker_terminal', 'sql_terminal', 'transaction_terminal', 'lock_terminal',
                  'socket_terminal', 'schema_dropped', 'root_removed', 'daemon_exit_zero')
        if (not all(receipt['resource_proof'].get(k) is True for k in fields)
                or obs['cleanup'] != 'OWN_SCHEMA_DROPPED_NORMAL_DAEMON_EXIT0_EXACT_ROOT_REMOVED'
                or obs['sourceFreeze'] != 'MATCHED' or obs['cleanupErrors'] != []
                or not obs['hashesBefore'] or obs['hashesBefore'] != obs['hashesAfter']
                or obs['postTestSql'] != {'connections': 0, 'transactions': 0, 'locks': 0}
                or not all(obs['terminal'].get(k) is True for k in
                    ('sqlTerminal', 'dropped', 'normalShutdown', 'observerSocketClosed'))):
            raise ValueError('Terminal proof incomplete')
        if not obs['processes'] or any(p.get('settled') is not True or p.get('groupTerminal') is not True
                or p.get('result') != {'code': 0, 'signal': None} for p in obs['processes']):
            raise ValueError('Process terminal')
        pair = expected_recipe['suites']
        if len(pair) != 2 or raw['suite_id'] not in pair: raise ValueError('Suite pair')
        records = receipt['typed_records']
        selected_path = 'evidence/' + raw['run_id'] + '/run.json'
        if records[selected_path]['raw'] != raw or receipt['typed_record'] not in records.values():
            raise ValueError('Selected raw binding')
        if len(records) != 2 or {d['raw']['suite_id'] for d in records.values()} != set(pair):
            raise ValueError('Original pair missing')
        start, end = timestamp(recipe['started_at']), timestamp(recipe['ended_at'])
        for sid, details in ((pair[0], obs['unitEvidence']), (pair[1], obs)):
            document = next(d for d in records.values() if d['raw']['suite_id'] == sid)
            original = document['raw']; digest = sha(document['original_text'].encode())
            path = 'evidence/' + original['run_id'] + '/run.json'
            suite = policy['suite_map'][sid]
            if (json.loads(document['original_text']) != original or document['sha256'] != digest
                    or document['path'] != path or recipe['registered_records'].get(path) != digest
                    or original['runtime_instance_id'] != raw['runtime_instance_id']
                    or not start <= timestamp(original['started_at']) <= timestamp(original['ended_at']) <= end
                    or original['result'] != 'PASS' or original['data_reference'] != expected['data_reference']
                    or details['selectedSuite'] != suite or details['expandedArgv'] != original['command']
                    or details['typedEvidence'] != {'path': path, 'sha256': digest, 'counts': original['counts']}
                    or details['runnerExit'] != {'code': 0, 'signal': None}
                    or any(details['runnerResponse'].get(k) != v for k, v in
                        {'status': 'RECORDED', 'run_result': 'PASS', 'evidence_file': path, 'issues': []}.items())):
                raise ValueError('Original unit/native binding')
            label = 'unit-harness-runner' if sid == pair[0] else 'harness-runner'
            runners = [d for d in obs['commands'] if d.get('label') == label]
            if len(runners) != 1 or runners[0]['cwd'] != expected['workspace']:
                raise ValueError('Harness command missing')
            args = runners[0]['args']
            if (len(args) != 10 or not args[0].endswith('/run_check.py')
                    or args[1:] != ['docs/inventory_management', '--repo-root', expected['workspace'],
                        '--suite', sid, '--stage', 'DEVELOPER', '--execute', '--json']):
                raise ValueError('Harness command differs')
        optional = obs.get('nativeObservation', {})
        if optional.get('missing') and not (expected_recipe.get('optional_missing_report') is True
                and optional.get('error', {}).get('code') == 'ENOENT'
                and 'draft-lock-range-observations.json' in optional['error'].get('message', '')):
            raise ValueError('Required report missing')
        if recipe['kind'] == 'GATE_NATIVE_CHILD':
            errors += _native_worker_issues(receipt, obs)
        return errors
    except (KeyError, TypeError, ValueError, StopIteration, Blocked):
        return errors + [issue('ACTUAL_RECIPE_PROOF_UNKNOWN')]


def coverage_provenance_issues(record, expected):
    """Check a producer chain; CLI never accepts a caller's approved bundle."""
    errors = []
    try:
        if (record['recipe'] != 'CI_FOUR_SHARD' or expected['parts'] != 4
                or any(record[k] != expected[k] for k in ('source', 'commit', 'command', 'thresholds'))
                or record['thresholds'] != {'lines': 92, 'branches': 83, 'functions': 90}
                or record['exit_code'] != 0 or timestamp(record['started_at']) > timestamp(record['ended_at'])):
            raise ValueError('Coverage producer identity')
        producer = record['producer']
        if sha(producer['original_text'].encode()) != producer['sha256'] or producer['sha256'] != expected['producer_sha256']:
            raise ValueError('Producer changed')
        errors += input_closure_issues(record['inputs'])
        errors += coverage_execution_issues(record, expected)
        if record['inputs'] != expected['inputs']: raise ValueError('Producer inputs differ')
        parts = record['parts']
        if len(parts) != 4 or sorted(p['shard'] for p in parts) != [1, 2, 3, 4]:
            raise ValueError('Incomplete shards')
        if len({p['job_id'] for p in parts}) != 4 or len({p['artifact_id'] for p in parts}) != 4:
            raise ValueError('Duplicate origin')
        for part in parts:
            manifest = part['manifest']
            if (part['source'] != expected['source'] or part['commit'] != expected['commit']
                    or part['run_id'] != expected['ci_run_id'] or part['attempt'] != expected['ci_attempt']
                    or part['origin_verified'] is not True or sha(part['raw_text'].encode()) != part['sha256']
                    or manifest['shard'] != part['shard'] or manifest['total'] != 4
                    or manifest['commit'] != expected['commit'] or not manifest['node'] or not manifest['cwd']):
                raise ValueError('Shard provenance')
        hashes = [p['sha256'] for p in parts]
        global_ = record['global_enforcement']; lcov = record['lcov']; floor = record['floor']
        if (record['merge_inputs'] != hashes or global_['input_sha256'] != hashes
                or global_['engine'] != 'NATIVE_V8' or global_['thresholds'] != expected['thresholds']
                or global_['exit_code'] != 0 or not lcov['original_text'].strip()
                or sha(lcov['original_text'].encode()) != lcov['sha256']
                or global_['emitted_lcov_sha256'] != lcov['sha256']
                or floor != {'command': expected['floor_command'], 'input_sha256': lcov['sha256'],
                    'exit_code': 0, 'checker_sha256': expected['checker_sha256'], 'files': 39}):
            raise ValueError('Native global/output/floor chain')
        return errors
    except (KeyError, TypeError, ValueError, Blocked):
        return errors + [issue('NATIVE_COVERAGE_PROVENANCE_NOT_ATTESTED')]


def registered_attempts(ctx, core, selected_suites):
    attempts = {sid: [] for sid in selected_suites}
    if len(set(ctx.state['evidence_files'])) != len(ctx.state['evidence_files']):
        raise Blocked('DUPLICATE_REGISTERED_EVIDENCE')
    for name in ctx.state['evidence_files']:
        raw = core.typed_json(core.inside(ctx.module_dir, name, True), 'evidence')
        if raw['module_id'] == ctx.module_id and raw['stage'] == 'DEVELOPER' and raw['suite_id'] in attempts:
            attempts[raw['suite_id']].append({'path': name, 'raw': raw})
    return attempts


def adoption_proof(ctx, core, current_source, current_map):
    documents = {name: original_document(ctx.module_dir, name, pin) for name, pin in PINNED_DOCUMENTS.items()}
    seed = documents[SEED_MAP]['raw']
    if seed['source_fingerprint'] != SEED_SOURCE or core.digest(seed['records']) != SEED_SOURCE:
        raise Blocked('SEED_SOURCE_MAP')
    candidate = documents['implementation/task041-hd228-gate-binding-candidate.json']['raw']
    adopted = documents['implementation/task041-hd229-candidate.json']['raw']
    if (ctx.baselines() != APPROVED_BASELINES or candidate['candidate'] != PARENT_BASELINES
            or adopted['parent'] != PARENT_BASELINES or adopted['candidate'] != LEGACY_APPROVED_BASELINES):
        raise Blocked('UNAPPROVED_BASELINE')
    for record in candidate['canonical_and_ci_files']:
        p = core.inside(ctx.repo, record['path'], True)
        pin = (adopted['manifest_sha256'] if record['path'] == 'docs/inventory_management/00_module_manifest.json'
               else record['candidate_sha256'])
        pin = HD230_CANONICAL_PINS.get(record['path'], pin)
        if file_hash(p) != pin:
            raise Blocked('CANONICAL_PATCH_CHANGED')
    if not all(core.approval_valid(ctx, 'APR-HD230-ADOPT-' + kind, kind=kind) for kind in ('DESIGN', 'PLAN', 'SCOPE')):
        raise Blocked('ADOPTION_APPROVAL_REQUIRED')
    before = source_map(seed['records'])
    fixtures = {}
    for name, digest in EXCLUDED_FIXTURES.items():
        p = core.inside(ctx.module_dir, name, True)
        if p.is_symlink() or file_hash(p) != digest: raise Blocked('EXCLUDED_FIXTURE_CHANGED')
        fixtures[name] = {'sha256': digest, 'mode': '100644', 'symlink': None}
    ci = next(x for x in candidate['canonical_and_ci_files'] if x['path'] == '.github/workflows/ci.yml')
    excluded = historical_excluded_inputs(fixtures, ci)
    allowed = {name: current_map[name] for name in TOOLS if name in current_map}
    errors = source_issues(before, current_map, allowed, ci['candidate_sha256'], excluded)
    return documents, before, excluded, allowed, ci, errors


def runtime_receipt(ctx, raw, documents, original_hashes, core):
    """Only independently pinned historical recipes are admitted by this version."""
    historical_files = raw['runtime_instance_id'] == FILE_RUNTIME
    if historical_files:
        document = documents[FILES_RECEIPT]
    elif raw['suite_id'] == 'inventory-task041-characterization' and raw['source_fingerprint'] == SEED_SOURCE:
        document = documents[CHAR_RECEIPT]
    else:
        return [issue('RUNTIME_RECEIPT_NOT_ATTESTED')]
    obs = document['raw']
    root = Path(obs['root'])
    if str(root.parent) != '/private/tmp' or root.name != raw['runtime_instance_id']:
        return [issue('RUNTIME_ROOT_IDENTITY')]
    if root.exists(): return [issue('HISTORICAL_ROOT_STILL_PRESENT')]
    node = Path(obs['runtime']['executable'])
    mysql = Path('/usr/local/mysql/bin/mysqld')
    if file_hash(node) != obs['hashesBefore']['executedNode'] or file_hash(mysql) != obs['mysqlBinaryHash']:
        return [issue('EXECUTED_BINARY_CHANGED')]
    daemons = [p for p in obs['processes'] if p['label'] == 'daemon']
    if len(daemons) != 1: return [issue('DAEMON_IDENTITY')]
    expected = {'owner': raw['runtime_instance_id'], 'workspace': str(ctx.repo), 'root': str(root),
        'schema': obs['schema'], 'socket': str(root / 'mysql.sock'), 'datadir': str(root / 'data'),
        'pid': daemons[0]['pid'], 'incarnation': raw['runtime_instance_id'],
        'node_sha256': file_hash(node), 'mysql_sha256': file_hash(mysql),
        'config_sha256': core.digest(obs['selectedSuite']), 'data_reference': ctx.profile['environment']['data_reference']}
    receipt = {'approved': True, 'binding': dict(expected), 'runtime_instance_id': raw['runtime_instance_id'],
        'observation': obs, 'typed_record': original_document(ctx.module_dir, 'evidence/' + raw['run_id'] + '/run.json'),
        'resource_proof': {}}
    if not historical_files:
        expected['harness_runner_path'] = '/Users/sam/.agents/skills/software-engineering-harness/scripts/run_check.py'
        expected['preview_argv'] = [argument.replace('{run_dir}', str(root)) for argument in ctx.suite_map()[raw['suite_id']]['argv']]
    fields = ('worker_terminal', 'sql_terminal', 'transaction_terminal', 'lock_terminal', 'socket_terminal', 'schema_dropped', 'root_removed')
    # Derived flags are necessary but insufficient: helpers also inspect original
    # counters, process/SQL identities, typed bytes, and exact recovery facts.
    if historical_files:
        recovery = documents[FILES_RECEIPT.removesuffix('observation.json') + 'recovery/recovery.json']['raw']
        receipt['recovery'] = recovery
        receipt['resource_proof'] = {key: True for key in fields}
        batch_path = FILES_RECEIPT.removesuffix('observation.json') + 'files-gates.json'
        receipt['files_batch'] = original_document(ctx.module_dir, batch_path,
            '7aacc47b218b9cb8222c6a7104c1b39af4991be87630fa84e0ce9182f9a5a2ae')['raw']
        receipt['typed_records'] = {path: original_document(ctx.module_dir, path, digest) for path, digest in original_hashes.items()}
        approved = {'approved': True, 'approval_ref': 'APR-HD229-ADOPT-SCOPE', 'runtime_instance_id': FILE_RUNTIME,
                    'source': SEED_SOURCE, 'original_sha256': original_hashes}
    else:
        terminal = obs.get('terminal', {})
        sql_terminal = obs.get('postTestSql') == {'connections': 0, 'transactions': 0, 'locks': 0}
        receipt['resource_proof'] = {key: sql_terminal and terminal.get('sqlTerminal') is True for key in fields}
        receipt['resource_proof'].update(socket_terminal=terminal.get('observerSocketClosed') is True,
            schema_dropped=terminal.get('dropped') is True, root_removed=not root.exists(),
            daemon_exit_zero=daemons[0].get('result') == {'code': 0, 'signal': None})
        native = obs['nativeOwnership']
        report_path = core.inside(ctx.repo, native['reportPath'], True).relative_to(ctx.module_dir).as_posix()
        receipt['native_report'] = original_document(ctx.module_dir, report_path, native['sha256'])
        # The original path is repo-relative in the unmodified coordinator.
        receipt['native_report']['path'] = native['reportPath']
        approved = None
    return runtime_proof_issues(raw, receipt, {'expected': expected, 'approved_recovery': approved, 'suite_map': ctx.suite_map()})


def collect_gate(repo, module, scripts):
    core, checks = load_harness(scripts)
    ctx = core.Context(module, repo)
    if ctx.module_id != MODULE or ctx.manifest['docs_path'] != 'docs/inventory_management': raise Blocked('GATE_SCOPE')
    if ctx.baselines() == HD235_BASELINES:
        return collect_hd235_gate(repo, module, scripts)
    if ctx.baselines() == HD233_BASELINES:
        return collect_hd233_gate(repo, module, scripts)
    generic = checks.verify_gate(ctx, 'MERGE_READY', ['PHASE-005'])
    current_source, current_map = observed_source(core, repo, ctx.manifest['docs_path'])
    documents, before_map, excluded, allowed, ci, delta_errors = adoption_proof(ctx, core, current_source, current_map)
    registry = documents[SEED_REGISTRY]['raw']['passed']
    seeds = {row['path']: row for row in registry}
    file_hashes = {row['path']: row['sha256'] for row in registry if row['suite'] != 'inventory-task041-characterization'}
    phases = {p['id']: p for p in ctx.trace['phases']}
    required = set(ctx.manifest['required_suites']['developer']) | set(phases['PHASE-005']['developer_suites'])
    suites = ctx.suite_map()
    attempts = {sid: [] for sid in required}
    invalid = []
    raw_by_path = {}
    for name in ctx.state['evidence_files']:
        try:
            raw = core.typed_json(core.inside(module, name, True), 'evidence')
            if raw['module_id'] != MODULE or raw['stage'] != 'DEVELOPER' or raw['suite_id'] not in required: continue
            raw_by_path[name] = raw
            classification = {'kind': 'UNKNOWN', 'verified': False}
            row = seeds.get(name)
            if row and file_hash(module / name) != row['sha256']: raise Blocked('SEED_RAW_TAMPERED')
            if (row and not delta_errors and raw['source_fingerprint'] == SEED_SOURCE and raw['spec_baseline'] == SEED_PLAN
                    and raw['command_contract_sha256'] == checks.contract_hash(suites[raw['suite_id']])):
                proof = {'kind': 'ADMIN_EQUIVALENT', 'before_suite': suites[raw['suite_id']], 'after_suite': suites[raw['suite_id']],
                    'before_source_map': before_map, 'current_source_map': current_map, 'allowed_tools': allowed,
                    'ci_expected_hash': ci['candidate_sha256'], 'excluded_inputs': excluded,
                    'before_plan': SEED_PLAN, 'after_plan': APPROVED_BASELINES['plan'],
                    'approved_plan_pair': [SEED_PLAN, APPROVED_BASELINES['plan']],
                    'approved_plan_scope': 'INVENTORY_PHASE005_GATE_ONLY', 'approval_ref': 'APR-HD229-ADOPT-SCOPE',
                    'independent_review_ref': 'REV-HD229-SAM-CANDIDATE',
                    'external_inputs': {'immutable': True, 'before': {'data_reference': raw['data_reference']},
                                        'after': {'data_reference': ctx.profile['environment']['data_reference']}},
                    'original_source': SEED_SOURCE, 'current_source': current_source}
                classification = classify_attempt(raw, suites[raw['suite_id']], proof)
                # Lint gained a generated .mjs input and advisory data is mutable.
                if raw['suite_id'] in ('lint', 'inventory-p3-dependency-audit'):
                    classification = {'kind': 'UNKNOWN', 'verified': False}
            elif raw['source_fingerprint'] == current_source and raw['spec_baseline'] == ctx.baselines()['plan']:
                classification = {'kind': 'EXACT', 'verified': True, 'suite_id': raw['suite_id'],
                                  'source_issues': [], 'spec_issues': [], 'external_issues': []}
            attempts[raw['suite_id']].append({'path': name, 'raw': raw, 'classification': classification})
        except (core.HarnessError, Blocked, OSError, ValueError) as error:
            invalid.append(issue('EVIDENCE_READ_BLOCKED', name, str(error)))
    validated, summaries = {}, []
    for sid in sorted(required):
        try:
            selected = select_latest(attempts[sid])
            raw = selected['raw']
            # Direct core validation is always reached for a selected candidate;
            # an unregistered runtime cannot suppress any original core finding.
            resource = runtime_receipt(ctx, raw, documents, file_hashes, core)
            result = validate_attempt(ctx, suites[sid], raw, selected['classification'], resource, checks)
            validated[sid] = result
            summaries.append({'suite_id': sid, 'status': result['status'], 'raw_path': selected['path'],
                'raw_sha256': file_hash(module / selected['path']), 'original_source': raw['source_fingerprint'],
                'original_plan': raw['spec_baseline'], 'original_runtime': raw['runtime_instance_id'],
                'classification': selected['classification']['kind'], 'issues': result['issues']})
        except (Blocked, core.HarnessError, OSError, ValueError, KeyError) as error:
            summaries.append({'suite_id': sid, 'status': 'UNKNOWN', 'issues': [issue(getattr(error, 'code', 'EVIDENCE_PROOF_UNKNOWN'), sid, str(error))]})
    remaining = resolve_core_issues(generic['issues'], validated, required)
    remaining += invalid + delta_errors
    for row in summaries:
        remaining.extend(row['issues'])
    if not any(r['method'] == 'HUMAN' and r['reviewer'] == 'Sam' and r['reviewed_baseline'] == current_source
               and r['status'] == 'APPROVED' and r['open_critical'] == 0 and r['open_high'] == 0 for r in ctx.state['reviews']):
        remaining.append(issue('ADAPTER_SOURCE_REVIEW_REQUIRED'))
    # The original floor command's exit0 alone does not attest its ignored LCOV
    # input. Full-native input provenance must be established before final readiness.
    remaining.append(issue('NATIVE_COVERAGE_PROVENANCE_NOT_ATTESTED'))
    if current_source != core.fingerprint(repo, ctx.manifest['docs_path']): remaining.append(issue('SOURCE_CHANGED_DURING_READ'))
    return {'status': 'BLOCKED' if remaining else 'INVENTORY_PHASE005_MERGE_READY', 'generic_gate': generic,
        'scope': 'Inventory PHASE-005 developer evidence applicability only; not new executions or release authorization.',
        'current_source': current_source, 'current_baselines': ctx.baselines(), 'required_groups': len(required),
        'applicable_groups': sum(row['status'] == 'APPLICABLE' for row in summaries),
        'applicability': summaries, 'issues': remaining}


HD233_CANDIDATE = 'implementation/task041-hd233-gate-completion-candidate.json'
HD233_CANDIDATE_SHA = '01038036dfdb937e8f215f295fa0ee5807adcc5185ef38eb2f7e5039e23925f2'
HD233_COORDINATOR = 'implementation/task041-hd233-small-runtime.mjs.txt'


HD233_COORDINATOR_SHA = 'd9c90fc2a57661a0b21a3ab2289705dcfe2c67d27dac77e8f59ec297015a24df'


def reviewed_producer(module_dir, historical=None):
    if historical:
        return original_document(module_dir, historical['producer_archive'], historical['producer_sha256'])
    return original_document(module_dir, HD233_COORDINATOR, HD233_COORDINATOR_SHA)


def mysql_daemon_issues(record, expected_path=Path('/usr/local/mysql/bin/mysqld')):
    try:
        if (record['path'] != str(expected_path) or record['realpath'] != str(expected_path.resolve(strict=True))
                or record['executable'] is not True or not expected_path.stat().st_mode & 0o111
                or file_hash(expected_path) != record['sha256']):
            raise ValueError('Daemon identity changed')
        return []
    except (KeyError, OSError, TypeError, ValueError):
        return [issue('CURRENT_MYSQL_DAEMON_UNKNOWN')]


def receipt_references(module_dir, raw, candidate):
    path = 'evidence/' + raw['run_id'] + '/run.json'
    references = [(row['observation'], row, row['observation_sha256']) for row in candidate['source_recipes']
                  if path in {record['path'] for record in row['typed_records']}]
    if raw['suite_id'] in NEW_SUITES:
        directory = 'evidence/' + raw['run_id'] + '/'
        for basename in ('runtime-complete-ref.json', 'runtime-live-ref.json'):
            index = module_dir / (directory + basename)
            if index.exists():
                reference = original_document(module_dir, directory + basename)['raw']
                if not isinstance(reference, dict) or not isinstance(reference.get('sha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', reference['sha256']):
                    raise Blocked('RECEIPT_REFERENCE_INTEGRITY')
                if not isinstance(reference.get('path'), str) or not reference['path'].startswith('evidence/task041-hd233-small-'):
                    raise Blocked('RECEIPT_REFERENCE_SCOPE')
                references.append((reference['path'], None, reference['sha256']))
                break
    return references


def coverage_object(value, code):
    if not isinstance(value, dict): raise Blocked(code)
    return value


def coverage_origin(ctx, core, source):
    """Identity comes from a separately observed pinned CI origin, not envelope."""
    observations = [x for x in ctx.state['observations']
                    if x['kind'] == 'CI' and x.get('subject') == 'INVENTORY_NATIVE_COVERAGE'
                    and x['code_commit'] == core.current_commit(ctx.repo)]
    if not observations: raise Blocked('COVERAGE_CI_ORIGIN_REQUIRED')
    observations.sort(key=lambda row: timestamp(row['observed_at']))
    current = observations[-1]
    if len(observations) > 1 and observations[-2]['observed_at'] == current['observed_at']:
        raise Blocked('COVERAGE_CI_ORIGIN_AMBIGUOUS')
    if (current['status'] != 'PASS' or current['actor'] != 'GitHub Actions'
            or current['spec_baseline'] != ctx.baselines()['plan'] or current['source_fingerprint'] != source):
        raise Blocked('COVERAGE_CI_ORIGIN_REQUIRED')
    match = re.fullmatch(r'(evidence/[^#]+\.json)#sha256=([a-f0-9]{64})', current['source_ref'])
    if not match: raise Blocked('COVERAGE_CI_ORIGIN_REQUIRED')
    if ctx.baselines() == HD235_BASELINES and match[1] != HD235_COVERAGE_ROOT + 'origin.json':
        raise Blocked('COVERAGE_CI_ORIGIN_REQUIRED')
    document = original_document(ctx.module_dir, match[1], match[2]); origin = document['raw']
    if (origin['source'] != source or origin['commit'] != current['code_commit']
            or origin['plan'] != ctx.baselines()['plan'] or origin['kind'] != 'NATIVE_COVERAGE_ORIGIN'
            or origin['external_source_ref'] != 'https://github.com/crazysumsum/erp-app/actions/runs/'
                + str(origin['run_id']) + '/attempts/' + str(origin['attempt'])):
        raise Blocked('COVERAGE_CI_ORIGIN_REQUIRED')
    return origin


def coverage_execution_issues(record, expected):
    try:
        documents = expected['observations']; originals = {}
        for key in ('download', 'merge', 'floor', 'inputs'):
            document = documents[key]; text = document['original_text']
            if (sha(text.encode()) != document['sha256'] or json.loads(text) != document['raw']
                    or record['execution_refs'].get(key) != document['sha256']):
                raise ValueError('Original coverage observations missing/changed')
            originals[key] = document['raw']
        download, merge, floor = (originals[key] for key in ('download', 'merge', 'floor'))
        if originals['inputs'] != {'kind': 'EXECUTION_INPUTS', 'source': expected['source'], 'commit': expected['commit'],
                                  'producer_sha256': expected['producer_sha256'], 'inputs': expected['inputs']}:
            raise ValueError('Execution input closure not independently bound')
        for original in originals.values():
            if original['source'] != expected['source'] or original['commit'] != expected['commit']:
                raise ValueError('Original producer source differs')
        fields = ('shard', 'job_id', 'artifact_id', 'sha256')
        if expected.get('artifact_metadata_required'):
            fields += ('expired', 'downloaded', 'publisher_job_id')
        artifacts = [{key: part[key] for key in fields} for part in record['parts']]
        if download != {'kind': 'CI_ARTIFACT_DOWNLOAD', 'source': expected['source'], 'commit': expected['commit'],
                        'run_id': expected['ci_run_id'], 'attempt': expected['ci_attempt'], 'artifacts': artifacts}:
            raise ValueError('Unverified CI/artifact substitution')
        if (merge['kind'] != 'NATIVE_EXECUTION' or merge['command'] != expected['command']
                or merge['thresholds'] != expected['thresholds'] or type(merge['exit_code']) is not int or merge['exit_code'] != 0
                or merge['input_sha256'] != record['merge_inputs']
                or merge['output_lcov_sha256'] != record['lcov']['sha256']
                or not merge['node'].startswith('v26.') or not merge['cwd']):
            raise ValueError('Native global execution missing')
        if any(part['manifest']['node'] != merge['node'] or part['manifest']['cwd'] != merge['cwd'] for part in record['parts']):
            raise ValueError('Conflicting shard runtime identity')
        if floor != {'kind': 'FLOOR_EXECUTION', 'source': expected['source'], 'commit': expected['commit'],
                      'command': expected['floor_command'], 'input_lcov_sha256': record['lcov']['sha256'],
                      'checker_sha256': expected['checker_sha256'], 'files': 39, 'exit_code': 0}:
            raise ValueError('Original floor execution missing')
        return []
    except (KeyError, TypeError, ValueError):
        return [issue('COVERAGE_ORIGINAL_EXECUTION_REQUIRED')]

def hd233_adoption(ctx, core):
    candidate = original_document(ctx.module_dir, HD233_CANDIDATE, HD233_CANDIDATE_SHA)['raw']
    if ctx.baselines() != HD233_BASELINES or candidate['candidate'] != HD233_BASELINES:
        raise Blocked('UNAPPROVED_BASELINE')
    if ctx.module_id != MODULE or ctx.manifest['docs_path'] != 'docs/inventory_management':
        raise Blocked('GATE_SCOPE')
    for row in candidate['canonical_files']:
        if file_hash(core.inside(ctx.repo, row['path'], True)) != row['candidate_sha256']:
            raise Blocked('CANONICAL_PATCH_CHANGED')
    if not all(core.approval_valid(ctx, 'APR-HD233-ADOPT-' + k, kind=k) for k in ('DESIGN', 'PLAN', 'SCOPE')):
        raise Blocked('ADOPTION_APPROVAL_REQUIRED')
    return candidate


def captured_inputs(observation, core):
    """Derive closure from exact producer-observed manifests, never its labels."""
    result = {'before': {}, 'after': {}, 'complete': False, 'resolved': False}
    for side, name in (('before', 'hashesBefore'), ('after', 'hashesAfter')):
        snapshot = observation.get(name, {})
        groups = snapshot.get('hd233Inputs', {}) if isinstance(snapshot, dict) else {}
        if not isinstance(groups, dict): continue
        for key, manifest in groups.items():
            if key not in ('node', 'python', 'mysql', 'harness', 'path', 'tools') or not manifest:
                continue
            result[side][key] = {'sha256': core.digest(manifest), 'mode': '100644', 'symlink': None}
    keys = {'node', 'python', 'mysql', 'harness', 'path', 'tools'}
    result['complete'] = keys == set(result['before']) == set(result['after'])
    result['resolved'] = result['complete']
    # Exact known producer code enumerates full trees and executable resolution.
    # The CLI additionally checks its manifests' mandatory content, not a flag.
    for name in ('hashesBefore', 'hashesAfter'):
        snapshot = observation.get(name, {})
        groups = snapshot.get('hd233Inputs', {}) if isinstance(snapshot, dict) else {}
        if not result['complete'] or not isinstance(groups, dict): break
        try:
            if (not groups['node']['installedInputs'] or not groups['python']['files']
                    or not groups['harness']['files'] or not groups['tools']['sourceMap']
                    or not all(groups['path'][key].get('realpath') and groups['path'][key].get('sha256')
                               for key in ('node', 'mysql', 'git', 'python'))):
                result['resolved'] = False
        except (KeyError, TypeError):
            result['resolved'] = False
    return result


def current_manifest_issues(groups, ctx, generated_outputs=()):
    """Re-read only known runtime roots; no receipt-provided arbitrary file read."""
    try:
        python_root = Path(sys.prefix).resolve()
        harness_root = Path('/Users/sam/.agents/skills/software-engineering-harness').resolve()
        def regular(name, record, root):
            path = Path(name)
            if not path.is_absolute() or not path.resolve(strict=True).is_relative_to(root):
                raise ValueError('Input outside known root')
            if record.get('symlink') is not None:
                if not path.is_symlink() or os.readlink(path) != record['symlink'] or str(path.resolve()) != record['realpath']:
                    raise ValueError('Input link changed')
                if 'sha256' in record and file_hash(path.resolve()) != record['sha256']:
                    raise ValueError('Input target changed')
            elif record.get('directory') is True:
                if not path.is_dir() or path.is_symlink(): raise ValueError('Input directory changed')
            elif not path.is_file() or file_hash(path) != record['sha256'] or bool(path.stat().st_mode & 0o111) != record['executable']:
                raise ValueError('Input bytes/mode changed')
        for group, field, root in (('python', 'files', python_root), ('python', 'importFiles', ctx.repo), ('harness', 'files', harness_root)):
            files = groups[group][field]
            if not files: raise ValueError('Input manifest empty')
            for name, record in files.items(): regular(name, record, root)
            # Every enumerated real directory must retain its complete membership.
            for name, record in files.items():
                if record.get('directory') is True and record.get('symlink') is None:
                    generated = sorted(Path(item).name for item in generated_outputs if (ctx.repo / item).parent == Path(name))
                    if record.get('generatedChildren', []) != generated: raise ValueError('Unapproved generated output role')
                    expected = set(record['children'])
                    if set(os.listdir(name)) - set(generated) != expected: raise ValueError('Input directory membership changed')
        python = groups['python']
        known_roots = (python_root, harness_root, ctx.repo)
        if not python['importRoots'] or not python['importOrigins']: raise ValueError('Python import closure missing')
        for entry in python['importRoots']:
            path = Path(entry['path'])
            if not path.is_absolute() or not any(path.resolve(strict=False).is_relative_to(root) for root in known_roots):
                raise ValueError('Unsupported Python lookup root')
            if entry.get('absent'):
                if path.exists() or path.is_symlink(): raise ValueError('Python lookup appeared')
            elif str(path.resolve(strict=True)) != entry['realpath']:
                raise ValueError('Python lookup resolution changed')
        for origin in python['importOrigins'].values():
            if not any(Path(origin).resolve(strict=False).is_relative_to(root) for root in known_roots):
                raise ValueError('Unsupported actual Python import')
        for key in ('node', 'mysql', 'git', 'python'):
            observed = groups['path'][key]
            actual = sys.executable if key == 'python' else shutil.which(key)
            if not actual or Path(actual).resolve() != Path(observed['realpath']).resolve():
                raise ValueError('Executable PATH changed')
            if file_hash(Path(actual).resolve()) != observed['sha256']: raise ValueError('Executable bytes changed')
        if mysql_daemon_issues(groups['mysql']['daemon']): raise ValueError('MySQL daemon changed')
        installed = groups['node']['installedInputs']
        if not installed: raise ValueError('Node installed manifest missing')
        for name, record in installed.items():
            path = ctx.repo / name
            if not path.resolve(strict=False).is_relative_to(ctx.repo): raise ValueError('Node input escaped')
            if record.get('absent'):
                if path.exists() or path.is_symlink(): raise ValueError('Node input appeared')
            elif 'symlink' in record:
                if not path.is_symlink() or os.readlink(path) != record['symlink']: raise ValueError('Node link changed')
                if 'realpath' in record and str(path.resolve()) != record['realpath']: raise ValueError('Node target changed')
            elif record.get('directory'):
                if not path.is_dir(): raise ValueError('Node directory changed')
            elif not path.is_file() or file_hash(path) != record['sha256'] or bool(path.stat().st_mode & 0o111) != record['executable']:
                raise ValueError('Node input changed')
        for base in ('node_modules', 'server/node_modules', 'client/node_modules'):
            for directory, directories, files in os.walk(ctx.repo / base, followlinks=False):
                relative_directory = Path(directory).relative_to(ctx.repo).as_posix()
                if any(relative_directory == output or relative_directory.startswith(output + '/') for output in generated_outputs):
                    directories[:] = []
                    continue
                links = [name for name in directories if (Path(directory) / name).is_symlink()]
                for name in files + links:
                    relative = (Path(directory) / name).relative_to(ctx.repo).as_posix()
                    if relative not in installed: raise ValueError('Unobserved installed Node input')
        return []
    except (OSError, TypeError, KeyError, ValueError) as error:
        return [issue('CURRENT_INPUT_CLOSURE_UNKNOWN', message=str(error))]

def hd233_receipt(ctx, core, raw, candidate, verified=None):
    """Read only explicitly known producer recipes; unsupported ones block."""
    recipes = receipt_references(ctx.module_dir, raw, candidate)
    selected = []
    for name, historical, digest in recipes:
        original = original_document(ctx.module_dir, name, digest)
        obs = original['raw']
        if not isinstance(obs, dict): raise Blocked('RUNTIME_OBSERVATION_SHAPE')
        bindings = (obs.get('typedEvidence', {}), obs.get('unitEvidence', {}).get('typedEvidence', {}))
        path = 'evidence/' + raw['run_id'] + '/run.json'
        if any(value.get('path') == path for value in bindings): selected.append((original, historical))
    if len(selected) != 1: raise Blocked('RUNTIME_RECEIPT_NOT_ATTESTED')
    document, historical = selected[0]; obs = document['raw']
    root = Path(obs['root'])
    pair = historical['suites'] if historical else ['inventory-task041-gate-binding-unit', 'inventory-task041-gate-binding-native']
    source = historical['producer_archive'] if historical else HD233_COORDINATOR
    producer_path = core.inside(ctx.module_dir, source, True)
    producer = reviewed_producer(ctx.module_dir, historical)
    if producer['sha256'] != obs['coordinatorHash'] or producer['sha256'] != obs['hashesBefore']['executedCoordinator']:
        raise Blocked('PRODUCER_IDENTITY')
    if (root.parent != Path('/private/tmp') or root.name != raw['runtime_instance_id']
            or (not historical and (not re.fullmatch(r'erp-inventory-task041-gate-binding-mysql-2670\.[A-Za-z0-9]+', root.name)
                or not re.fullmatch(r'erp_inventory_gate_binding_[a-f0-9]{12}', obs['schema'])))):
        raise Blocked('RUNTIME_ROOT_IDENTITY')
    records = {}
    for value in (obs['unitEvidence']['typedEvidence'], obs['typedEvidence']):
        item = original_document(ctx.module_dir, value['path'], value['sha256'])
        item['raw'] = core.typed_json(core.inside(ctx.module_dir, value['path'], True), 'evidence')
        records[value['path']] = item
    chosen = records[path]
    daemons = [p for p in obs['processes'] if p['label'] == 'daemon']
    if len(daemons) != 1: raise Blocked('DAEMON_IDENTITY')
    expected = {'owner': raw['runtime_instance_id'], 'workspace': str(ctx.repo), 'root': str(root),
        'schema': obs['schema'], 'socket': str(root / 'mysql.sock'), 'datadir': str(root / 'data'),
        'pid': daemons[0]['pid'], 'incarnation': raw['runtime_instance_id'],
        'node_sha256': obs['hashesBefore']['executedNode'], 'mysql_sha256': obs['mysqlBinaryHash'],
        'config_sha256': core.digest(obs['selectedSuite']), 'data_reference': ctx.profile['environment']['data_reference']}
    terminal = obs.get('terminal', {})
    sql = obs.get('postTestSql') == {'connections': 0, 'transactions': 0, 'locks': 0} and terminal.get('sqlTerminal') is True
    resources = {key: sql for key in ('worker_terminal', 'sql_terminal', 'transaction_terminal', 'lock_terminal')}
    resources.update(socket_terminal=terminal.get('observerSocketClosed') is True,
        schema_dropped=terminal.get('dropped') is True, root_removed=not root.exists(),
        daemon_exit_zero=daemons[0].get('result') == {'code': 0, 'signal': None})
    registered = {name: item['sha256'] for name, item in records.items() if name in ctx.state['evidence_files']}
    recipe_kind = 'HD231_DIRECT' if historical else 'GATE_NATIVE_CHILD'
    closure = captured_inputs(obs, core)
    current_issues = []
    if not historical and not input_closure_issues(closure):
        groups = obs['hashesAfter']['hd233Inputs']
        source_observation = groups['tools']['sourceMap']
        if groups['mysql']['daemon']['sha256'] != obs['hashesBefore']['executedMySQL'] or groups['mysql']['daemon']['sha256'] != obs['mysqlBinaryHash']:
            raise Blocked('MYSQL_DAEMON_BINDING')
        if (source_observation['source_fingerprint'] != raw['source_fingerprint']
                or core.digest(source_observation['records']) != raw['source_fingerprint']
                or groups['tools']['producer']['sha256'] != producer['sha256']):
            raise Blocked('INPUT_SOURCE_IDENTITY')
        key = document['sha256']
        if verified is None or key not in verified:
            current_issues = current_manifest_issues(groups, ctx)
            if verified is not None and not current_issues: verified.add(key)
        if current_issues: closure['resolved'] = False
    receipt = {'approved': True, 'binding': expected, 'runtime_instance_id': raw['runtime_instance_id'],
        'observation': obs, 'typed_record': chosen, 'typed_records': records, 'resource_proof': resources,
        'recipe': {'kind': recipe_kind, 'producer': producer, 'inputs': closure,
            'registered_records': registered, 'started_at': obs['startedAt'], 'ended_at': obs['finishedAt']}}
    policy = {'expected': expected, 'suite_map': ctx.suite_map(), 'recipe': {'kind': recipe_kind,
        'producer_sha256': producer['sha256'], 'suites': pair,
        'optional_missing_report': bool(historical and historical['original_optional_draft_report_absent'])}}
    if not historical:
        binding = obs['nativeOwnership']
        report_path = core.inside(ctx.repo, binding['reportPath'], True).relative_to(ctx.module_dir).as_posix()
        receipt['native_report'] = original_document(ctx.module_dir, report_path, binding['sha256'])
        receipt['native_report']['path'] = binding['reportPath']
    return receipt, policy


def hd233_attempt_classification(ctx, core, raw, suite, source, current_map, candidate):
    unknown = {'kind': 'UNKNOWN', 'verified': False, 'suite_id': suite['id'],
               'source_issues': [issue('EQUIVALENCE_UNKNOWN')], 'spec_issues': [], 'external_issues': []}
    if raw['source_fingerprint'] == source and raw['spec_baseline'] == ctx.baselines()['plan']:
        return dict(unknown, kind='EXACT', verified=True, source_issues=[])
    if (raw['source_fingerprint'] != HD233_SOURCE or raw['spec_baseline'] != HD233_PARENT_PLAN
            or suite['id'] not in set(sum(HD233_DIRECT_PAIRS, ()))):
        return unknown
    if suite['id'].startswith('inventory-task041-draft-lock-range-'):
        fixture = core.inside(ctx.module_dir, 'implementation/hd231-before/InventoryStocktakeService.js.txt', True)
        if file_hash(fixture) != 'ec949b058b79babc023d9baf6581b861c9867985ede00020ba66a9447a676725':
            raise Blocked('D01_SOURCE_FIXTURE_CHANGED')
    receipt, _ = hd233_receipt(ctx, core, raw, candidate)
    before_doc = original_document(ctx.module_dir, 'implementation/task041-hd231-final-observed-source-map.json')['raw']
    if core.digest(before_doc['records']) != HD233_SOURCE: raise Blocked('HD231_SOURCE_MAP_CHANGED')
    before = source_map(before_doc['records']); after = dict(current_map)
    canonical_before, canonical_after, expected = {}, {}, {}
    for row in candidate['canonical_files']:
        name = row['path']; old = {'sha256': row['before_sha256'], 'mode': '100644', 'symlink': None}
        new = {'sha256': row['candidate_sha256'], 'mode': '100644', 'symlink': None}
        canonical_before[name] = old; canonical_after[name] = new; expected[name] = {'before': old, 'after': new}
        before[name] = old; after[name] = new
    roles = {name: {'before': before[name], 'after': after[name], 'role': 'OBSERVATIONAL_HASH_READ',
        'review_ref': 'REV-HD233-SAM-CANDIDATE; exact known Node-suite producer'}
        for name in TOOLS | {'docs/inventory_management/00_project_profile.json'}}
    old_profile = json.loads((ctx.module_dir / 'implementation/hd233-inputs/00_project_profile.json.before.txt').read_text())
    old_suite = next(x for x in old_profile['suites'] if x['id'] == suite['id'])
    if old_suite != suite: return unknown
    closure = receipt['recipe']['inputs']
    proof = {'kind': 'ADMIN_EQUIVALENT', 'before_suite': old_suite, 'after_suite': suite,
        'before_source_map': before, 'current_source_map': after, 'allowed_tools': {}, 'ci_expected_hash': None,
        'excluded_inputs': {'before': closure['before'], 'after': closure['after'], 'dependency_complete': False,
                            'approved': False, 'original_suite': True},
        'before_plan': HD233_PARENT_PLAN, 'after_plan': ctx.baselines()['plan'],
        'approved_plan_pair': [HD233_PARENT_PLAN, ctx.baselines()['plan']],
        'approved_plan_scope': 'INVENTORY_PHASE005_GATE_ONLY', 'approval_ref': 'APR-HD233-ADOPT-SCOPE',
        'independent_review_ref': 'REV-HD233-SAM-CANDIDATE', 'original_source': HD233_SOURCE, 'current_source': source,
        'external_inputs': {'immutable': not input_closure_issues(closure), 'before': closure['before'], 'after': closure['after']},
        'hd233': {'baseline_source': HD233_SOURCE, 'baseline_plan': HD233_PARENT_PLAN,
            'candidate_plan': ctx.baselines()['plan'], 'canonical_before': canonical_before,
            'canonical_after': canonical_after, 'canonical_expected': expected, 'observational_paths': roles,
            'suite_inputs': sorted(set(before) - TOOLS - HD233_CANONICAL),
            'producer_imports': ['node:assert/strict', 'node:fs/promises', 'mysql2/promise'], 'installed_inputs': closure}}
    return classify_attempt(raw, suite, proof)


HD235_COVERAGE_ROOT = 'evidence/native-coverage-provenance/'
HD235_COVERAGE_FILES = ('.github/workflows/ci.yml', 'server/package.json',
    '.github/scripts/merge-server-coverage.test.mjs', 'server/scripts/checkCoverageFloors.js',
    'server/scripts/inventoryPhase005CoverageEvidence.mjs')


def collect_hd235_native_coverage(ctx, core, source):
    """Offline verifier of independently observed GitHub originals, not CI claims.

    The existing CI observation pins origin.json. Its retained_sha256 map pins
    run.json, jobs.json, artifacts.json, job-<numeric id>.log and artifact-<id>.zip
    in HD235_COVERAGE_ROOT. Root must independently inspect/download those GitHub
    originals before registering that observation. No network or extraction runs
    here; missing authority or a different API/log shape stays UNKNOWN.
    """
    import io
    import zipfile
    try:
        origin = coverage_origin(ctx, core, source)
        def require(condition, message):
            if not condition: raise ValueError(message)
        require(origin['kind'] == 'NATIVE_COVERAGE_ORIGIN', 'Origin kind')
        pins = origin['retained_sha256']
        require(isinstance(pins, dict), 'Retained original pins missing')
        used = set()

        def retained(name):
            require('/' not in name and name not in ('', '.', '..'), 'Fixed original name')
            relative = HD235_COVERAGE_ROOT + name
            require(re.fullmatch(r'[a-f0-9]{64}', pins[relative]) is not None, 'Original pin')
            filename = core.inside(ctx.module_dir, relative, True)
            require(not filename.is_symlink() and filename.is_file(), 'Original regular bytes')
            data = filename.read_bytes()
            require(sha(data) == pins[relative], 'Retained original bytes changed')
            used.add(relative)
            return data

        run = json.loads(retained('run.json'))
        commit = core.current_commit(ctx.repo)
        run_id, attempt = run['id'], run['run_attempt']
        positive = lambda value: type(value) is int and value > 0
        require(positive(run_id) and positive(attempt), 'Numeric run identity')
        require(positive(origin['attempt']) and str(run_id) == str(origin['run_id'])
                and attempt == origin['attempt'], 'Observed run/attempt')
        require(run['repository']['full_name'] == 'crazysumsum/erp-app'
                and run['head_sha'] == commit and run['path'] == '.github/workflows/ci.yml'
                and run['status'] == 'completed' and run['conclusion'] == 'success', 'Current successful workflow')
        tested = json.loads(retained('tested-commit.json'))
        tested_commit = tested['sha']
        local_tree = core.git(ctx.repo, 'rev-parse', 'HEAD^{tree}').strip()
        require(re.fullmatch(r'[a-f0-9]{40}', tested_commit)
                and re.fullmatch(r'[a-f0-9]{40}', local_tree)
                and tested['url'] == 'https://api.github.com/repos/crazysumsum/erp-app/git/commits/' + tested_commit
                and tested['tree']['sha'] == local_tree, 'Actual tested commit and current candidate tree')
        if tested_commit != commit:
            # pull_request checks out refs/pull/N/merge; API head_sha is the
            # branch candidate. Preserve both identities, accepting only the
            # identical tree after the reported base is already integrated.
            require(run['event'] == 'pull_request' and len(run['pull_requests']) == 1, 'Actual PR merge run')
            pr = run['pull_requests'][0]; base = pr['base']['sha']
            require(positive(pr['number']) and pr['head']['sha'] == commit
                    and pr['base']['ref'] == 'main' and re.fullmatch(r'[a-f0-9]{40}', base)
                    and pr['base']['repo']['url'] == 'https://api.github.com/repos/crazysumsum/erp-app'
                    and pr['head']['repo']['url'] == 'https://api.github.com/repos/crazysumsum/erp-app'
                    and [parent['sha'] for parent in tested['parents']] == [base, commit], 'Exact PR base/candidate parents')
            candidate = json.loads(retained('candidate-commit.json'))
            require(candidate['sha'] == commit and candidate['tree']['sha'] == local_tree
                    and candidate['url'] == 'https://api.github.com/repos/crazysumsum/erp-app/git/commits/' + commit
                    and core.git(ctx.repo, 'merge-base', base, commit).strip() == base, 'Current candidate API tree and integrated base')
        jobs_doc, artifacts_doc = json.loads(retained('jobs.json')), json.loads(retained('artifacts.json'))
        require(jobs_doc['total_count'] == len(jobs_doc['jobs'])
                and artifacts_doc['total_count'] == len(artifacts_doc['artifacts']), 'Complete API pages required')
        jobs = jobs_doc['jobs']; artifacts = artifacts_doc['artifacts']
        require(len({job['id'] for job in jobs}) == len(jobs)
                and len({item['id'] for item in artifacts}) == len(artifacts), 'Duplicate API identities')
        current_files = {name: file_hash(core.inside(ctx.repo, name, True)) for name in HD235_COVERAGE_FILES}
        require(origin['producer_sha256'] == current_files, 'Observed producer bytes')
        package = json.loads((ctx.repo / 'server/package.json').read_text())
        merge_command = package['scripts']['test:coverage:merge']
        flags = re.findall(r'--test-coverage-(lines|branches|functions)=(\d+)', merge_command)
        require(merge_command.endswith(' && node scripts/checkCoverageFloors.js') and len(flags) == 3
                and {key: int(value) for key, value in flags}
                    == {'lines': 92, 'branches': 83, 'functions': 90}
                and '../.github/scripts/merge-server-coverage.test.mjs' in merge_command, 'Original native merge/floor command')
        checker = (ctx.repo / 'server/scripts/checkCoverageFloors.js').read_text()
        require(len(re.findall(r'^  "[^"]+": \{', checker, re.MULTILINE)) == 39, 'Original 39 floors')
        threshold = {'lines': 92, 'branches': 83, 'functions': 90}
        runtime = None

        def snapshot(proof, kind):
            nonlocal runtime
            before, after = proof['before'], proof['after']
            immutable = lambda value: {key: item for key, item in value.items() if key != 'generatedOutputs'}
            require(immutable(before) == immutable(after) and before['generatedOutputs'] == {}, 'Immutable CI inputs')
            require(before['source'] == source and before['commit'] == tested_commit
                    and before['plan'] == ctx.baselines()['plan'] and before['thresholds'] == threshold,
                    'Current source/PLAN/thresholds')
            inputs = before['inputs']
            require(inputs['recipe'] == 'CI_NODE_NATIVE'
                    and sha(json.dumps(inputs['source'], sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()) == source,
                    'Actual source records')
            require(all(inputs['files'][name] == digest for name, digest in current_files.items()), 'Pinned execution files')
            for name in ('docs/inventory_management/00_module_manifest.json',
                         'docs/inventory_management/00_project_profile.json', 'docs/inventory_management/08_traceability.json'):
                require(inputs['files'][name] == file_hash(core.inside(ctx.repo, name, True)), 'Current canonical input')
            require(inputs['installed']['node_modules']['directory'] is True
                    and inputs['npm']['records']['']['directory'] is True
                    and len(inputs['npm']['records']) > 1, 'Original installed/npm closure')
            for name in ('node', 'npm', 'git') + (('docker',) if kind == 'shard' else ()):
                executable = inputs['executables'][name]
                require(Path(executable['path']).is_absolute() and Path(executable['realpath']).is_absolute()
                        and re.fullmatch(r'[a-f0-9]{64}', executable['sha256']), 'Observed executable input')
            require(re.fullmatch(r'v26\..+', before['node']) and re.match(r'\d+\.\d+\.\d+', before['npm'])
                    and Path(before['cwd']).is_absolute(), 'Native runtime')
            observed = (before['node'], before['npm'], before['cwd'])
            if runtime is None: runtime = observed
            require(observed == runtime and before['command'] == 'npm run test:coverage:' + kind + ' --workspace server', 'Consistent command/runtime')
            require(proof['originalOutcome'] == 'success'
                    and timestamp(proof['startedAt']) <= timestamp(proof['endedAt']), 'Original successful native execution')
            return before

        def artifact(name, job_name, native_step, final_step):
            matching = [job for job in jobs if job['name'] == job_name]
            require(len(matching) == 1, 'Unique actual publisher job')
            job = matching[0]
            require(positive(job['id']) and job['run_id'] == run_id and job['run_attempt'] == attempt
                    and job['head_sha'] == commit and job['status'] == 'completed'
                    and job['conclusion'] == 'success', 'Publisher current successful attempt')
            for step_name in (native_step, final_step):
                steps = [step for step in job['steps'] if step['name'] == step_name]
                require(len(steps) == 1 and steps[0]['status'] == 'completed'
                        and steps[0]['conclusion'] == 'success', 'Original successful job step')
            matching = [item for item in artifacts if item['name'] == name]
            require(len(matching) == 1, 'Unique artifact')
            item = matching[0]
            require(positive(item['id']) and item['expired'] is False
                    and item['workflow_run']['id'] == run_id
                    and item['workflow_run']['head_sha'] == commit, 'Current available artifact')
            data = retained('artifact-%d.zip' % item['id']); digest = sha(data)
            require(item['digest'] == 'sha256:' + digest and item['size_in_bytes'] == len(data), 'Downloaded original ZIP bytes')
            log = retained('job-%d.log' % job['id']).decode('utf-8')
            require(re.search(r'Artifact ' + re.escape(name) + r' has been successfully uploaded! Final size is \d+ bytes\. Artifact ID is ' + str(item['id']) + r'\b', log)
                    and 'SHA256 digest of uploaded artifact zip is ' + digest in log, 'Original publisher artifact ID/digest linkage')
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                members = [entry for entry in archive.infolist() if not entry.is_dir()]
                require(len({entry.filename for entry in members}) == len(members), 'Duplicate archive member')
                require(all(not Path(entry.filename).is_absolute() and '..' not in Path(entry.filename).parts
                            and (entry.external_attr >> 16) & 0o170000 != 0o120000 for entry in members), 'Unsafe archive member')
                content = {entry.filename: archive.read(entry) for entry in members}
            return content, log

        parts = []
        for shard in range(1, 5):
            files, _log = artifact('server-coverage-%d' % shard, 'Server coverage shard (%d/4)' % shard,
                'Collect native server coverage for this shard', 'Finalize Inventory native coverage ownership proof')
            proof = json.loads(files['inventory-proof/complete.json'])
            identity = {'commit': tested_commit, 'runId': str(run_id), 'attempt': attempt, 'job': 'server-tests'}
            require(proof['kind'] == 'CI_NATIVE_SHARD' and type(proof['shard']) is int and proof['shard'] == shard
                    and type(proof['identity']['attempt']) is int and proof['identity'] == identity, 'Native shard identity')
            before = snapshot(proof, 'shard')
            capture = json.loads(files['inventory-proof/before.json'])
            require(capture['kind'] == 'CI_INPUTS_BEFORE' and capture['identity'] == identity
                    and capture['shard'] == shard and capture['snapshot'] == before
                    and capture['at'] == proof['startedAt'], 'Original before capture')
            terminal = proof['terminal']
            require(all(type(terminal[key]) is int and terminal[key] == 0 for key in ('connections', 'transactions', 'locks', 'containerExitCode'))
                    and terminal['observerSocketClosed'] is True and terminal['forced'] is False, 'Terminal shard ownership')
            mysql = before['inputs']['mysql']
            require(re.fullmatch(r'[a-f0-9]{64}', mysql['id']) and re.fullmatch(r'sha256:[a-f0-9]{64}', mysql['image'])
                    and mysql['configuredImage'] == 'mysql:26.7.0', 'Original MySQL container')
            manifest = json.loads(files['manifest.json'])
            raw_files = proof['rawFiles']
            require(raw_files and len({row['path'] for row in raw_files}) == len(raw_files), 'Distinct raw reports')
            require(set(files) == {'inventory-proof/complete.json', 'inventory-proof/before.json', 'manifest.json'}
                    | {row['path'] for row in raw_files}, 'Exact native shard archive set')
            require(manifest == {'commit': tested_commit, 'node': before['node'], 'cwd': before['cwd'],
                    'shard': shard, 'total': 4, 'reports': len(raw_files)}
                    and sha(files['manifest.json']) == proof['manifestSha256'], 'Original manifest bytes')
            for row in raw_files:
                require(re.fullmatch(r'raw/coverage-\d+-\d{13}-\d+\.json', row['path'])
                        and sha(files[row['path']]) == row['sha256'], 'Raw native bytes')
                raw = json.loads(files[row['path']])
                require(isinstance(raw['result'], list) and raw['result'], 'Actual native V8 reports')
            parts.append({'shard': shard, 'sha256': sha(files['inventory-proof/complete.json']),
                'run_id': str(run_id), 'attempt': attempt, 'commit': tested_commit,
                'manifestSha256': proof['manifestSha256'], 'rawFiles': raw_files})
        files, log = artifact('inventory-native-merge-proof', 'Test coverage (server + client, MySQL integration)',
            'Merge native coverage and enforce unchanged global and per-file floors', 'Finalize Inventory native merge proof')
        require(set(files) == {'inventory-proof/before.json', 'inventory-proof/complete.json', 'lcov.info'}, 'Exact merge archive set')
        proof = json.loads(files['inventory-proof/complete.json'])
        identity = {'commit': tested_commit, 'runId': str(run_id), 'attempt': attempt, 'job': 'regression'}
        require(proof['kind'] == 'CI_NATIVE_MERGE' and type(proof['identity']['attempt']) is int
                and proof['identity'] == identity and proof['shard'] is None,
                'Original native merge identity')
        before = snapshot(proof, 'merge')
        capture = json.loads(files['inventory-proof/before.json'])
        require(capture == {'kind': 'CI_INPUTS_BEFORE', 'identity': identity, 'shard': None,
                'snapshot': before, 'parts': parts, 'at': proof['startedAt']}, 'Original consumed merge inputs')
        require(proof['parts'] == parts and type(proof['outcome']['exitCode']) is int
                and proof['outcome'] == {'exitCode': 0, 'signal': None}
                and proof['lcovSha256'] == sha(files['lcov.info'])
                and re.search(rb'^SF:.+', files['lcov.info'], re.MULTILINE)
                and b'end_of_record' in files['lcov.info']
                and 'Per-file coverage floors met for 39 high-risk files.' in log, 'Native LCOV/global/39-floor chain')
        require(all(proof[key] == value for key, value in before.items() if key != 'generatedOutputs'), 'Flattened merge record differs')
        require(set(pins) == used, 'Unexpected or unused retained originals')
        return []
    except (Blocked, core.HarnessError, OSError, KeyError, TypeError, ValueError, AttributeError,
            zipfile.BadZipFile, UnicodeError) as error:
        return [issue('HD235_NATIVE_COVERAGE_UNKNOWN', message=str(error))]


def hd235_verified_floor_lcov(ctx, core, source):
    """Return actual retained CI bytes only after the complete native gate passes."""
    import io
    import zipfile
    if ctx.baselines() != HD235_BASELINES:
        raise Blocked('HD235_FLOOR_CI_REQUIRED')
    problems = collect_hd235_native_coverage(ctx, core, source)
    if problems:
        raise Blocked(problems[0]['code'])
    origin = coverage_origin(ctx, core, source)
    pins = origin['retained_sha256']
    artifacts = original_document(ctx.module_dir, HD235_COVERAGE_ROOT + 'artifacts.json',
        pins[HD235_COVERAGE_ROOT + 'artifacts.json'])['raw']['artifacts']
    matches = [item for item in artifacts if item['name'] == 'inventory-native-merge-proof']
    if len(matches) != 1: raise Blocked('HD235_FLOOR_CI_REQUIRED')
    name = HD235_COVERAGE_ROOT + 'artifact-%d.zip' % matches[0]['id']
    filename = core.inside(ctx.module_dir, name, True)
    if filename.is_symlink() or not filename.is_file(): raise Blocked('HD235_FLOOR_CI_REQUIRED')
    archive = filename.read_bytes()
    if sha(archive) != pins[name] or matches[0]['digest'] != 'sha256:' + sha(archive):
        raise Blocked('HD235_FLOOR_CI_REQUIRED')
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            lcov = zipped.read('lcov.info')
            merge = json.loads(zipped.read('inventory-proof/complete.json'))
    except (zipfile.BadZipFile, KeyError, ValueError) as error:
        raise Blocked('HD235_FLOOR_CI_REQUIRED') from error
    if sha(lcov) != merge['lcovSha256']: raise Blocked('HD235_FLOOR_CI_REQUIRED')
    return {'bytes': lcov, 'binding': {'source': source, 'commit': core.current_commit(ctx.repo),
        'origin_sha256': file_hash(ctx.module_dir / (HD235_COVERAGE_ROOT + 'origin.json')),
        'archive_sha256': sha(archive), 'lcov_sha256': sha(lcov),
        'checker_sha256': file_hash(ctx.repo / 'server/scripts/checkCoverageFloors.js')}}


def hd235_floor_consumption_issues(proof, expected):
    """The separate original floor suite must consume and restore the CI LCOV."""
    try:
        raw, binding = expected['raw'], expected['binding']
        lcov, stdout = expected['lcov'], expected['stdout']
        digest = binding['lcov_sha256']
        if (proof['kind'] != 'HD235_ORIGINAL_FLOOR_CONSUMPTION' or proof['binding'] != binding
                or proof['target'] != 'server/coverage/lcov.info'
                or proof['consumedBeforeSha256'] != digest or proof['consumedAfterSha256'] != digest
                or proof['staged']['sha256'] != digest or proof['staged']['mode'] != 0o600
                or proof['staged']['uid'] != os.geteuid()
                or any(type(proof['staged'][key]) is not int or proof['staged'][key] <= 0 for key in ('dev', 'ino'))
                or proof['backupRemoved'] is not True or proof['restored'] != proof['before']):
            raise ValueError('Original consumed/restored LCOV proof')
        if proof['before'] != {'absent': True}:
            before = proof['before']
            if (set(before) != {'dev', 'ino', 'uid', 'mode', 'sha256'} or before['uid'] != os.geteuid()
                    or any(type(before[key]) is not int or before[key] <= 0 for key in ('dev', 'ino'))
                    or type(before['mode']) is not int or not 0 <= before['mode'] <= 0o7777
                    or not re.fullmatch('[a-f0-9]{64}', before['sha256'])):
                raise ValueError('Original prior file identity')
        if (raw['suite_id'] != 'inventory-p3-coverage-floors'
                or raw['command'] != ['node', 'server/scripts/checkCoverageFloors.js'] or raw['cwd'] != '.'
                or raw['result'] != 'PASS' or type(raw['exit_code']) is not int or raw['exit_code'] != 0
                or raw['timed_out'] is not False
                or not timestamp(proof['stagedAt']) <= timestamp(raw['started_at'])
                    <= timestamp(raw['ended_at']) <= timestamp(proof['consumedAt']) <= timestamp(proof['restoredAt'])
                or proof['retainedLcov'] != {'path': lcov['path'], 'sha256': digest}
                or lcov['sha256'] != digest or sha(lcov['original_text'].encode()) != digest
                or proof['stdout'] != {'path': stdout['path'], 'sha256': stdout['sha256']}
                or not any(row['path'] == stdout['path'] and row['sha256'] == stdout['sha256'] for row in raw['artifacts'])
                or sha(stdout['original_text'].encode()) != stdout['sha256']
                or stdout['original_text'].strip() != 'Per-file coverage floors met for 39 high-risk files.'):
            raise ValueError('Original floor command/output/LCOV chain')
        return []
    except (Blocked, KeyError, TypeError, ValueError, AttributeError) as error:
        return [issue('HD235_FLOOR_CONSUMPTION_UNKNOWN', message=str(error))]


def collect_coverage_provenance(ctx, core, source):
    """Only archived actual producer observations, never CLI supplied JSON."""
    if getattr(ctx, 'baselines', lambda: None)() == HD235_BASELINES:
        return collect_hd235_native_coverage(ctx, core, source)
    path = ctx.module_dir / 'evidence/native-coverage-provenance/observation.json'
    if not path.exists(): return [issue('NATIVE_COVERAGE_PROVENANCE_NOT_ATTESTED')]
    try:
        origin = coverage_origin(ctx, core, source)
        envelope = original_document(ctx.module_dir, path.relative_to(ctx.module_dir).as_posix())['raw']
        record = coverage_object(envelope['record'], 'COVERAGE_RECORD_SHAPE')
        if record.get('label') == 'SYNTHETIC_VERIFIER_ONLY': raise Blocked('SYNTHETIC_COVERAGE_NOT_EXECUTION')
        # Retained originals must be inside evidence, with exact stored bytes.
        parts, native_hashes = [], []
        for part in record['parts']:
            if not part['raw_path'].startswith('evidence/'): raise Blocked('COVERAGE_PATH')
            original = original_document(ctx.module_dir, part['raw_path'], part['sha256'])
            manifest = original_document(ctx.module_dir, part['manifest_path'], part['manifest_sha256'])['raw']
            files = original['raw']['raw_files']
            if (part['manifest'] != manifest or type(manifest['reports']) is not int
                    or not files or len(files) != manifest['reports']
                    or len({row['path'] for row in files}) != len(files)):
                raise Blocked('COVERAGE_SHARD_INPUTS_INCOMPLETE')
            for row in files:
                if not row['path'].startswith('evidence/') or not re.fullmatch(r'coverage-\d+-\d{13}-\d+\.json', Path(row['path']).name):
                    raise Blocked('COVERAGE_PATH')
                native = original_document(ctx.module_dir, row['path'], row['sha256'])
                if not isinstance(coverage_object(native['raw'], 'NATIVE_V8_INPUT_SHAPE').get('result'), list) or not native['raw']['result']:
                    raise Blocked('NATIVE_V8_INPUT_MISSING')
                native_hashes.append(native['sha256'])
            if part.get('raw_text', original['original_text']) != original['original_text']:
                raise Blocked('COVERAGE_SHARD_METADATA_MISMATCH')
            parts.append(dict(part, raw_text=original['original_text']))
        if record['global_enforcement'].get('native_input_sha256') != native_hashes:
            raise Blocked('NATIVE_GLOBAL_INPUT_CHAIN_MISMATCH')
        lcov = original_document(ctx.module_dir, record['lcov']['path'], record['lcov']['sha256'])
        if not record['lcov']['path'].startswith('evidence/'): raise Blocked('COVERAGE_PATH')
        if not re.search(r'^SF:.+', lcov['original_text'], re.MULTILINE) or 'end_of_record' not in lcov['original_text']:
            raise Blocked('LCOV_NATIVE_OUTPUT_MISSING')
        workflow = core.inside(ctx.repo, '.github/workflows/ci.yml', True)
        producer = {'path': '.github/workflows/ci.yml', 'sha256': file_hash(workflow), 'original_text': workflow.read_text()}
        original_inputs = origin['producer_observation']
        if not original_inputs['path'].startswith('evidence/'): raise Blocked('COVERAGE_PATH')
        bound = original_document(ctx.module_dir, original_inputs['path'], original_inputs['sha256'])
        producer_observation = coverage_object(bound['raw'], 'COVERAGE_PRODUCER_SHAPE')
        if envelope.get('producer_observation', producer_observation) != producer_observation:
            raise Blocked('COVERAGE_INPUT_OBSERVATION_CHANGED')
        inputs = captured_inputs(producer_observation, core)
        observations = {key: original_document(ctx.module_dir, row['path'], row['sha256'])
                        for key, row in origin['observations'].items()}
        expected = {'source': source, 'commit': core.current_commit(ctx.repo), 'producer_sha256': producer['sha256'],
            'inputs': inputs, 'command': 'npm run test:coverage:merge --workspace server',
            'thresholds': {'lines': 92, 'branches': 83, 'functions': 90},
            'floor_command': 'node scripts/checkCoverageFloors.js',
            'checker_sha256': file_hash(ctx.repo / 'server/scripts/checkCoverageFloors.js'),
            'ci_run_id': origin['run_id'], 'ci_attempt': origin['attempt'], 'parts': 4, 'observations': observations}
        if record['producer'] != producer or record['inputs'] != inputs:
            raise Blocked('COVERAGE_PRODUCER_INPUT_MISMATCH')
        if record['lcov'].get('original_text', lcov['original_text']) != lcov['original_text']:
            raise Blocked('COVERAGE_LCOV_METADATA_MISMATCH')
        actual = dict(record, parts=parts, lcov={'original_text': lcov['original_text'], 'sha256': lcov['sha256']})
        return coverage_provenance_issues(actual, expected)
    except (Blocked, core.HarnessError, OSError, TypeError, KeyError, ValueError, AttributeError) as error:
        return [issue(getattr(error, 'code', 'NATIVE_COVERAGE_PROVENANCE_NOT_ATTESTED'), message=str(error))]

def hd235_registry_issues(registry, expected_suites):
    if (not isinstance(registry, dict) or not isinstance(expected_suites, dict)
            or len(expected_suites) != 73 or registry != expected_suites
            or any(sid != suite.get('id') for sid, suite in registry.items())):
        return [issue('HD235_REGISTRY_CONTRACT')]
    return []


def hd235_selection_issues(requested, registry):
    if (not isinstance(requested, list) or not requested or len(requested) > 73
            or any(not isinstance(sid, str) for sid in requested)
            or len(set(requested)) != len(requested) or not set(requested) <= set(registry)):
        return [issue('HD235_PREFLIGHT_SCOPE')]
    return []


def hd235_attempt(raw, suite, source, plan):
    if not isinstance(raw, dict):
        raise Blocked('REQUIRED_RUN_MISSING')
    exact = (raw.get('source_fingerprint') == source and raw.get('spec_baseline') == plan
             and raw.get('suite_id') == suite['id'])
    contract = sha(json.dumps(suite, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':'), allow_nan=False).encode())
    exact = exact and raw.get('command_contract_sha256') == contract
    counts = raw.get('counts', {})
    if raw.get('result') == 'PASS':
        exact = exact and (counts.get('skipped', 1) <= suite['max_skipped']
                           and counts.get('failed') == 0 and counts.get('not_run') == 0
                           and counts.get('total', -1) >= suite['min_tests'])
    return {'raw': raw, 'classification': {'kind': 'EXACT' if exact else 'UNKNOWN',
        'verified': bool(exact), 'suite_id': suite['id'], 'source_issues': [],
        'spec_issues': [], 'external_issues': []}}


def hd235_fixture_terminal_issues(suite_id, text, expected):
    """Read original fixture diagnostics, without inventing gate-worker acknowledgements."""
    def positive(value):
        return type(value) is int and value > 0

    def ids(values):
        return isinstance(values, list) and all(positive(value) for value in values) and len(set(values)) == len(values)

    def exit_known(value):
        return value in ({'code': 0, 'signal': None}, {'code': None, 'signal': 'SIGKILL'})

    def terminal(samples):
        return (isinstance(samples, list) and bool(samples) and
                samples[-1]['state']['processIds'] == [] and samples[-1]['state']['transactions'] == [])

    def published_terminals(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ('terminalSql', 'terminalSqlObservations') and not terminal(child):
                    raise ValueError('Published SQL terminal is incomplete')
                published_terminals(child)
        elif isinstance(value, list):
            for child in value:
                published_terminals(child)

    try:
        if suite_id == 'inventory-task041-safety':
            rows = json.loads(text)
            runtimes = [row for row in rows if row.get('kind') == 'realRuntime']
            if len(runtimes) != 1:
                raise ValueError('Runtime identity missing or duplicated')
            runtime = runtimes[0]
            if (runtime['mysql'] != '26.7.0' or runtime['schema'] != expected['schema']
                    or runtime['synthetic'] is not True or not positive(runtime['parentPid'])):
                raise ValueError('Foreign runtime')
            stops = [row for row in rows if row.get('kind') == 'ownedChildTerminated']
            if not stops:
                raise ValueError('No owned termination evidence')
            for stop in stops:
                connections, transactions = stop['connectionIds'], stop['transactionIds']
                # These transactionIds are the fixture's observed SQL thread IDs, not InnoDB transaction IDs.
                if (not positive(stop['pid']) or stop['pid'] == runtime['parentPid']
                        or not ids(connections) or not ids(transactions) or not set(transactions).issubset(connections)
                        or not exit_known(stop['exit'])):
                    raise ValueError('Invalid owned process evidence')
                if connections:
                    if stop['databaseConnectionsGone'] is not True:
                        raise ValueError('SQL connections not terminal')
                elif (stop.get('noWorkSentBeforeReady') is not True or transactions):
                    raise ValueError('Empty SQL identity without explicit no-work evidence')
        elif suite_id == 'inventory-task041-export-recovery-process':
            import xml.etree.ElementTree as ET
            root = ET.fromstring(text, parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))
            cases, diagnostics, current = {}, {}, None
            for child in root:
                if child.tag == 'testcase':
                    match = re.match(r'ST041-(ED\d{2}) ', child.get('name', ''))
                    if not match or match[1] in cases or any(node.tag in ('skipped', 'failure', 'error') for node in child):
                        raise ValueError('Missing, repeated or unsuccessful case')
                    current = match[1]
                    cases[current] = child
                elif child.tag is ET.Comment and (child.text or '').strip().startswith(('{', '[')):
                    if current is None:
                        raise ValueError('Unassociated diagnostic')
                    value = json.loads(child.text)
                    published_terminals(value)
                    diagnostics.setdefault(current, []).append(value)
            if set(cases) != {f'ED{number:02}' for number in range(1, 19)}:
                raise ValueError('Original eighteen cases required')
            eight = next(value for value in diagnostics.get('ED08', []) if 'generatedSize' in value)
            eleven = next(value for value in diagnostics.get('ED11', []) if 'recordedIds' in value)
            seventeen = next(value for value in diagnostics.get('ED17', []) if 'rounds' in value)
            if (eight['positiveExit'] != {'code': None, 'signal': 'SIGKILL'}
                    or not eight['generatedSize'] > eight['clientBodyBytes'] > 0
                    or eight['nativeReadsStarted'] != 1 or eight['barrierReleased'] is not False
                    or eight['endObserved'] is not False or eight['prematureClose'] is not True):
                raise ValueError('Interrupted delivery not proven')
            if (eleven['positiveExit'] != {'code': None, 'signal': 'SIGKILL'}
                    or not ids(eleven['recordedIds']) or not eleven['recordedIds']
                    or eleven['observedWait']['threadId'] not in eleven['recordedIds']
                    or eleven['exitBeforeBlockerRelease'] is not True
                    or not terminal(eleven['terminalSqlObservations'])):
                raise ValueError('Interrupted SQL not terminal')
            if len(seventeen['rounds']) != 10:
                raise ValueError('Missing lifecycle rounds')
            for row in seventeen['rounds']:
                wanted_exit = {'code': None, 'signal': 'SIGKILL'} if row['kind'] == 'crash' else {'code': 0, 'signal': None}
                if row['positiveExit'] != wanted_exit or not terminal(row['terminalSql']):
                    raise ValueError('Lifecycle round incomplete')
        else:
            raise ValueError('Unsupported original fixture')
    except (AttributeError, KeyError, IndexError, TypeError, ValueError, SyntaxError, StopIteration) as error:
        return [issue('FIXTURE_TERMINAL_UNKNOWN', suite_id, str(error))]
    return []


def hd235_cli_terminal_issues(record, workspace, uid, prefix):
    """Validate source-bound observed CLI ownership; never infer child exit codes."""
    def positive(value):
        return type(value) is int and value > 0

    def digest(value):
        return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value)

    try:
        key = hashlib.sha1(workspace.encode()).hexdigest()[:16]
        cache = Path.home() / 'Library/Caches/ms-playwright/daemon' / key
        if (prefix not in ('st039-', 'st040-') or record['workspace'] != workspace
                or record['workspaceCreatedPrivate'] is not True or record['cacheRoot'] != str(cache)
                or len(record['sessions']) != 1):
            raise ValueError('CLI private workspace or expected session missing')
        entry = record['sessions'][0]; name = entry['name']
        if (not re.fullmatch(re.escape(prefix) + '[a-f0-9]{8}', name) or entry['channel'] != 'chrome'
                or entry['attached'] is not False or entry['persistent'] is not False):
            raise ValueError('CLI browser is not the original own ephemeral session')
        daemon, browser, close = entry['daemon'], entry['browser'], entry['close']
        for process in (daemon, browser):
            if (not positive(process['pid']) or process['pgid'] != process['pid']
                    or process['groupTerminal'] is not True or not digest(process['commandSha256'])):
                raise ValueError('CLI owned process group terminal unknown')
        if (browser['pid'] == daemon['pid'] or browser['ppid'] != daemon['pid']
                or not positive(close['pid']) or close['pid'] in (daemon['pid'], browser['pid'])):
            raise ValueError('CLI process identity mismatch')
        socket, session_file, profile = entry['socket'], entry['sessionFile'], entry['profile']
        if (not re.fullmatch(r'/tmp/pw-[a-f0-9]{8}/cli/' + key + '-' + re.escape(name) + r'\.sock', socket['path'])
                or session_file['path'] != str(cache / (name + '.session')) or not digest(session_file['sha256'])
                or not re.fullmatch(r'/tmp/playwright_chromiumdev_profile-[A-Za-z0-9]+', profile['path'])):
            raise ValueError('CLI owned file identities differ')
        for file in (socket, profile):
            if (type(file['uid']) is not int or file['uid'] != uid
                    or not positive(file['dev']) or not positive(file['ino'])):
                raise ValueError('CLI file ownership missing')
        if any(file['terminal'] is not True for file in (socket, session_file, profile)):
            raise ValueError('CLI socket, session or profile still present')
        start, end = timestamp(close['startedAtLowerBound']), timestamp(close['observedGoneAt'])
        expected_groups = [{key: process[key] for key in ('pid', 'pgid', 'startedAt', 'commandSha256')} for process in (daemon, browser)]
        if close['groupsAtStart'] != expected_groups or not start <= timestamp(close['observedLiveAt']) <= end:
            raise ValueError('Original daemon/browser were not observed live after close invocation')
        elapsed = (end - start).total_seconds() * 1000
        if (close['observed'] is not True or type(close['elapsedUpperBoundMs']) not in (int, float)
                or not math.isfinite(close['elapsedUpperBoundMs']) or not 0 < elapsed < 30000
                or not 0 < close['elapsedUpperBoundMs'] < 30000
                or not math.isclose(elapsed, close['elapsedUpperBoundMs'], abs_tol=0.001)
                or not timestamp(daemon['startedAt']) <= timestamp(browser['startedAt']) <= start):
            raise ValueError('CLI graceful completion cannot exclude the original 30s fallback')
    except (AttributeError, KeyError, TypeError, ValueError, IndexError) as error:
        return [issue('CLI_TERMINAL_UNKNOWN', message=str(error))]
    return []


def hd235_runtime_issues(raw, receipt, policy):
    errors = []
    try:
        recipe, wanted = receipt['recipe'], policy['recipe']
        transport = recipe['transport']
        if (recipe['kind'] != 'HD235' or wanted['kind'] != 'HD235'
                or transport != wanted['transport'] or transport not in
                ('FILES_DIRECT', 'MYSQL_DIRECT', 'MYSQL_HTTP', 'MYSQL_IPC_PROCESS',
                 'BROWSER_REAL_APP', 'BROWSER_DECLARED_MOCK',
                 'STOCKTAKE_CHARACTERIZATION', 'STOCKTAKE_SOAK')
                or receipt.get('recovery') or recipe.get('claims')):
            raise ValueError('Recipe or unsupported claim')
        producer = recipe['producer']
        if (sha(producer['original_text'].encode()) != producer['sha256']
                or producer['sha256'] != wanted['producer_sha256']):
            raise ValueError('Producer changed')
        if recipe['inputs'].get('recipe') == 'CI_NODE_NATIVE':
            raise ValueError('Local Harness inputs cannot borrow CI roles')
        errors += input_closure_issues(recipe['inputs'])
        expected, obs = policy['expected'], receipt['observation']
        if raw['suite_id'] == 'inventory-p3-coverage-floors':
            errors += hd235_floor_consumption_issues(obs.get('floorConsumption'), policy.get('floor'))
        if (receipt['binding'] != expected or obs['repo'] != expected['workspace']
                or obs['root'] != expected['root'] or obs['sourceFreeze'] != 'MATCHED'
                or not obs['hashesBefore'] or obs['hashesBefore'] != obs['hashesAfter']
                or obs['cleanupErrors'] != [] or receipt['runtime_instance_id'] != raw['runtime_instance_id']):
            raise ValueError('Source or ownership differs')
        lifecycle = recipe['lifecycle']
        start, end = timestamp(recipe['started_at']), timestamp(recipe['ended_at'])
        finalized = timestamp(lifecycle['finalized_at'])
        if (lifecycle['state'] != 'COMPLETE' or lifecycle['registered_before_validation'] is not True
                or not start <= timestamp(raw['started_at']) <= timestamp(raw['ended_at']) <= end <= finalized
                or finalized > dt.datetime.now(dt.timezone.utc)):
            raise ValueError('Live, future or incomplete outer runtime')
        doc = receipt['typed_record']; name = 'evidence/' + raw['run_id'] + '/run.json'
        digest = sha(doc['original_text'].encode())
        if (json.loads(doc['original_text']) != raw or doc['raw'] != raw or doc['path'] != name
                or doc['sha256'] != digest or recipe['registered_records'].get(name) != digest
                or obs['typedEvidence'] != {'path': name, 'sha256': digest, 'counts': raw['counts']}
                or obs['selectedSuite'] != policy['suite_map'][raw['suite_id']]
                or obs['expandedArgv'] != raw['command']):
            raise ValueError('Original run binding')
        runners = [cmd for cmd in obs['commands'] if cmd.get('label') == 'harness-runner']
        if (len(runners) != 1 or runners[0]['cwd'] != expected['workspace']
                or not runners[0]['args'][0].endswith('/run_check.py')
                or runners[0]['args'][1:] != ['docs/inventory_management', '--repo-root', expected['workspace'],
                    '--suite', raw['suite_id'], '--stage', 'DEVELOPER', '--execute', '--json']):
            raise ValueError('Actual original Harness command')
        live_processes = [p for p in obs['processes'] if p.get('label') == 'live-preflight']
        if live_processes:
            live_commands = [cmd for cmd in obs['commands'] if cmd.get('label') == 'live-preflight']
            args = [expected['workspace'] + '/server/scripts/inventoryPhase005Gate.py',
                '--receipt-preflight', '--suite', raw['suite_id'], '--phase', 'PHASE-005',
                '--module', 'docs/inventory_management', '--repo-root', expected['workspace'],
                '--harness-scripts', '/Users/sam/.agents/skills/software-engineering-harness/scripts', '--json']
            if (len(live_processes) != 1 or len(live_commands) != 1 or live_commands[0]['args'] != args
                    or live_commands[0]['cwd'] != expected['workspace']): raise ValueError('Unexpected live preflight')
        if not obs['processes'] or any(p.get('settled') is not True or p.get('groupTerminal') is not True
                or p.get('result', {}).get('signal') is not None
                or p.get('result', {}).get('code') not in ((0, 1) if p.get('label') in ('harness-runner', 'live-preflight') else (0,))
                for p in obs['processes']):
            raise ValueError('Process completion unknown')
        if transport == 'BROWSER_DECLARED_MOCK' and ('mysql' in obs or obs.get('schema') is not None):
            raise ValueError('Mock browser cannot borrow a real DB recipe')
        if 'mysql' in obs:
            mysql = obs['mysql']
            if (mysql['version'] != '26.7.0' or mysql['socket'] != expected['socket']
                    or mysql['datadir'].rstrip('/') != expected['datadir'].rstrip('/')
                    or mysql.get('account') != expected['account'] or obs['schema'] != expected['schema']
                    or not obs['schema'].startswith(expected['schema_prefix'])
                    or obs['postTestSql'] != {'connections': 0, 'transactions': 0, 'locks': 0}
                    or obs['cleanup'] != 'OWN_SCHEMA_DROPPED_NORMAL_DAEMON_EXIT0_EXACT_ROOT_REMOVED'
                    or not all(receipt['resource_proof'].get(k) is True for k in
                        ('worker_terminal', 'sql_terminal', 'transaction_terminal', 'lock_terminal',
                         'socket_terminal', 'schema_dropped', 'daemon_exit_zero', 'root_removed'))
                    or not all(obs['terminal'].get(k) is True for k in
                        ('sqlTerminal', 'dropped', 'normalShutdown', 'observerSocketClosed'))):
                raise ValueError('Database identity or terminal incomplete')
            if int(mysql.get('isolated', 1)) == 0:
                tcp = obs['tcpIdentity']
                if (tcp.get('socketClosed') is not True or tcp.get('host') != '127.0.0.1'
                        or type(tcp.get('port')) is not int or not 0 < tcp['port'] < 65536
                        or any(tcp.get(key) != mysql.get(key) for key in ('version', 'socket', 'datadir', 'account'))):
                    raise ValueError('Loopback endpoint not bound to owned socket instance')
        elif (transport not in ('FILES_DIRECT', 'BROWSER_DECLARED_MOCK')
                or obs['cleanup'] != 'OWN_FILES_ROOT_REMOVED'
                or not all(receipt['resource_proof'].get(k) is True for k in ('worker_terminal', 'root_removed'))):
            raise ValueError('Missing required resource proof')
        if transport == 'MYSQL_IPC_PROCESS' and raw['suite_id'] in ('inventory-task041-safety', 'inventory-task041-export-recovery-process'):
            native = receipt['native_report']
            if sha(native['original_text'].encode()) != native['sha256']:
                raise ValueError('Fixture diagnostic bytes changed')
            errors += hd235_fixture_terminal_issues(raw['suite_id'], native['original_text'], expected)
        elif transport == 'MYSQL_IPC_PROCESS':
            errors += _native_worker_issues(receipt, obs)
            native = receipt['native_report']['raw']
            for stop in obs['nativeOwnership']['ownedStops']:
                if (stop.get('forced') not in (None, False) or stop.get('exit') != {'code': 0, 'signal': None}):
                    raise ValueError('Forced shutdown is not normal completion')
                acknowledgements = native.get('hd235ShutdownAcknowledgements', [])
                matching = [ack for ack in acknowledgements if ack.get('pid') == stop['pid']
                    and ack.get('incarnation') == stop['incarnation'] and ack.get('ownConnections') == 0
                    and re.fullmatch('[a-f0-9-]{36}', ack.get('requestId', '')) and ack.get('nonce') == stop.get('nonce')]
                if stop.get('gracefulReply') != {'exitCode': 0} and len(matching) != 1:
                    raise ValueError('Shutdown acknowledgement unknown')
        elif transport in ('STOCKTAKE_CHARACTERIZATION', 'STOCKTAKE_SOAK'):
            raise ValueError('Performance-specific terminal collector is not implemented yet')
        if transport in ('MYSQL_HTTP', 'BROWSER_REAL_APP'):
            http = receipt['http']; native = http['native_report']
            if (http.get('format', 'JSON') not in ('JSON', 'ORIGINAL_JUNIT')
                    or http['transport'] != 'REAL_HTTP' or http['suite_id'] != raw['suite_id']
                    or sha(native['original_text'].encode()) != native['sha256']
                    or native['sha256'] != policy['http']['required_native_report_hash']):
                raise ValueError('Real native HTTP evidence missing or changed')
            if http.get('format', 'JSON') == 'ORIGINAL_JUNIT':
                import xml.etree.ElementTree as ET
                tree = ET.fromstring(native['original_text'])
                cases = list(tree.iter('testcase'))
                if (len(cases) < policy['suite_map'][raw['suite_id']]['min_tests']
                        or any(node.tag in ('failure', 'error', 'skipped') for node in tree.iter())):
                    raise ValueError('Original HTTP cases incomplete')
            elif json.loads(native['original_text']) != native['raw']:
                raise ValueError('Native HTTP JSON changed')
        if transport in ('BROWSER_REAL_APP', 'BROWSER_DECLARED_MOCK'):
            browser = obs['browser']; argv = obs['selectedSuite']['argv']
            roles = {'client', 'api'} if transport == 'BROWSER_REAL_APP' else {'client'}
            if (browser['mode'] != ('REAL_APP' if transport == 'BROWSER_REAL_APP' else 'EXPLICIT_EXISTING_MOCK')
                    or browser['config'] != argv[argv.index('--config') + 1]
                    or browser['originalPlaywrightPassed'] is not True or browser['binariesCaptured'] is not True
                    or len(browser['origins']) != len(roles)
                    or {row['role'] for row in browser['origins']} != roles
                    or len({row['url'] for row in browser['origins']}) != len(roles)
                    or any(row['terminal'] is not True or not re.fullmatch(r'http://127\.0\.0\.1:[1-9][0-9]{0,4}', row['url'])
                        or not 0 < int(row['url'].rsplit(':', 1)[1]) < 65536 for row in browser['origins'])):
                raise ValueError('Browser mode, original config or owned endpoint completion unproven')
        seen, failed_at = set(), None
        for attempt in sorted(recipe.get('load_ledger', []), key=lambda row: timestamp(row['started_at'])):
            sid = attempt['suite_id']; began = timestamp(attempt['started_at']); counts = attempt['counts']
            if (sid not in policy['load_suites'] or sid in seen or attempt['attempt'] != 1
                    or failed_at is not None and began > failed_at
                    or counts['skipped'] != 0 or counts['not_run'] != 0
                    or counts['total'] != counts['passed'] + counts['failed']
                    or attempt['result'] == 'PASS' and (counts['failed'] or counts['passed'] == 0)):
                raise ValueError('Unapproved retry or load after performance failure')
            seen.add(sid)
            if attempt['result'] != 'PASS':
                failed_at = timestamp(attempt['ended_at'])
        return errors
    except (KeyError, TypeError, ValueError, SyntaxError, Blocked, IndexError):
        return errors + [issue('HD235_RUNTIME_PROOF_UNKNOWN')]


def hd235_coverage_issues(record, expected):
    try:
        if (not re.fullmatch('[a-f0-9]{64}', record['workflow_sha256'])
                or record['workflow_sha256'] != expected['workflow_sha256']):
            raise ValueError('Workflow differs')
        for part in record['parts']:
            if (part['expired'] is not False or part['downloaded'] is not True
                    or part['publisher_job_id'] != part['job_id']):
                raise ValueError('Artifact publisher/download unknown')
        return coverage_provenance_issues(record, dict(expected, artifact_metadata_required=True))
    except (KeyError, TypeError, ValueError):
        return [issue('HD235_COVERAGE_PROVENANCE_UNKNOWN')]


HD235_GENERATED_OUTPUTS = {'client-build': ['client/dist', 'server/logs', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p3-client-coverage': ['client/coverage', 'client/node_modules/.vite/vitest', 'server/logs', 'client/dist', 'server/coverage', 'client/node_modules/.vite/deps'], 'inventory-p3-browser': ['client/node_modules/.vite/deps', 'server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/vitest'], 'inventory-p3-browser-regression': ['client/node_modules/.vite/deps', 'server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/vitest'], 'inventory-task039-browser': ['client/node_modules/.vite/deps', 'server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/vitest'], 'inventory-task040-browser': ['client/node_modules/.vite/deps', 'server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/vitest'], 'inventory-p3-transfers-client': ['client/node_modules/.vite/vitest', 'server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps'], 'inventory-p3-movements-client': ['client/node_modules/.vite/vitest', 'server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps'], 'inventory-p3-adjustments-client': ['client/node_modules/.vite/vitest', 'server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps'], 'inventory-task039-client': ['client/node_modules/.vite/vitest', 'server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps'], 'inventory-task040-client': ['client/node_modules/.vite/vitest', 'server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps'], 'inventory-task040-topbar': ['client/node_modules/.vite/vitest', 'server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps'], 'lint': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-developer': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p2-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p2-api': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task026-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task026-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p3-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p3-transfer-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p3-movement-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p3-api': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p3-server-coverage': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p3-coverage-floors': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p3-dependency-audit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task027-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task028-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p3-sales-compatibility': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p3-customer-capacity': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-p3-core-capacity': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task035-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task035-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task036-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task036-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task037-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task037-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task038-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task038-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task039-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task039-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task039-api': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task040-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task040-api': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-safety': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-export-recovery-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-export-recovery-process': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-characterization': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-resource-soak': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-control-lock-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-post-lookup-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-post-batch-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-post-batch-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-profile-batch-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-profile-batch-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-purchase-receipt-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-purchase-receipt-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-purchase-receipt-auth': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-purchase-contract': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-purchase-reversal-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-purchase-reversal-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-purchase-reversal-auth': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-purchase-existing-receipt': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-purchase-existing-reservation': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-purchase-existing-lock': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-main-compatibility-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-provider-joint-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-export-failure-audit-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-export-failure-audit-api': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-fail-fast-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-gate-binding-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-gate-binding-native': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-draft-lock-range-unit': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest'], 'inventory-task041-draft-lock-range-database': ['server/logs', 'client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/deps', 'client/node_modules/.vite/vitest']}
HD235_BASELINES = {'design': '0d0460c4f0b8d64ddc5029caf761bd98d024d998c449f173ede6fe5638f62ff0',
                   'plan': '940f0d7d2c849fe7cc3e069e7bd93186ceeb94c56cfe53aa58247051b1a0b744'}
HD235_COORDINATOR = 'implementation/task041-hd235-verification-runtime.mjs.txt'
HD235_COORDINATOR_SHA = 'f20dc352e145d51d15f2095cf95cb62ce51d173965e171005e6a6abf0b515719'
HD235_MANIFEST = 'implementation/task041-hd235-completion-manifest.json'
HD235_MANIFEST_SHA = '3d109418d583092d7f41e9aea0f404666995abbc8e54731d57abcd1e930ce8db'
HD235_CANDIDATE_SHA = '661a57ddc342cbeab888ba5290171810734a9cb49827103a9442c34fd39fc9a5'
HD235_REGISTRY_BASELINES = {'design': '82b1d9c902f417402035290cad1c7aca932d4af3189a0cb0d3657a3667b4f02a', 'plan': '28d48f4adeaeeef5680bc59d600b8a27e6aa30e3bec1eef57f5fab1f93f772b7'}


def hd235_adoption(ctx, core):
    candidate = original_document(ctx.module_dir, 'implementation/task041-hd239-main-integration-candidate.json', HD235_CANDIDATE_SHA)['raw']
    manifest = original_document(ctx.module_dir, HD235_MANIFEST, HD235_MANIFEST_SHA)['raw']
    if ctx.baselines() != HD235_BASELINES or candidate['candidate'] != HD235_BASELINES or manifest['candidate'] != HD235_REGISTRY_BASELINES or candidate['registry_baseline'] != HD235_REGISTRY_BASELINES:
        raise Blocked('UNAPPROVED_BASELINE')
    if ctx.module_id != MODULE or ctx.manifest['docs_path'] != 'docs/inventory_management': raise Blocked('GATE_SCOPE')
    for row in candidate['files']:
        if file_hash(core.inside(ctx.repo, row['path'], True)) != row['candidate_sha256']: raise Blocked('CANONICAL_PATCH_CHANGED')
    if not all(core.approval_valid(ctx, 'APR-HD239-ADOPT-' + k, kind=k) for k in ('DESIGN', 'PLAN', 'SCOPE')):
        raise Blocked('ADOPTION_APPROVAL_REQUIRED')
    required = set(ctx.manifest['required_suites']['developer']) | set(next(p['developer_suites'] for p in ctx.trace['phases'] if p['id'] == 'PHASE-005'))
    rows = manifest['rows']; registry = {r['suite_id']: r['candidate_suite'] for r in rows}
    expected = {sid: ctx.suite_map()[sid] for sid in required}
    if len(rows) != 73 or len(registry) != 73 or hd235_registry_issues(registry, expected): raise Blocked('HD235_REGISTRY_CONTRACT')
    return {r['suite_id']: r for r in rows}


def hd235_node_toolchain_issues(groups):
    """Check the actual local npm implementation and shared Node runtime inputs."""
    try:
        lookups = groups['path']
        node = Path(lookups['node']['realpath'])
        if not node.is_absolute() or not node.is_file(): raise ValueError('Node resolution missing')
        prefix = node.parent.parent
        npm_root = prefix / 'lib/node_modules/npm'; library_root = prefix / 'lib'
        npm = groups['node']['globalNpm']; libraries = groups['node']['nativeLibraries']
        if npm['root'] != str(npm_root) or libraries['root'] != str(library_root): raise ValueError('Unreviewed toolchain root')
        for key in ('node', 'npm', 'npx'):
            row = lookups[key]; filename = Path(row['realpath'])
            current = shutil.which(key)
            if (not current or row['path'] != current or Path(current).resolve(strict=True) != filename
                    or not os.access(current, os.X_OK) or row.get('executable') is not True
                    or row.get('symlink') != (os.readlink(current) if Path(current).is_symlink() else None)):
                raise ValueError('Current npm/node PATH or link identity changed')
            if not filename.is_absolute() or file_hash(filename) != row['sha256']: raise ValueError('Tool lookup changed')
            if key != 'node' and not filename.resolve(strict=True).is_relative_to(npm_root.resolve(strict=True)):
                raise ValueError('npm lookup outside implementation')
        def files(records, root, complete):
            if not records or not isinstance(records, dict): raise ValueError('Missing toolchain input files')
            for name, row in records.items():
                filename = Path(name)
                if not filename.is_absolute() or not filename.resolve(strict=True).is_relative_to(root.resolve(strict=True)):
                    raise ValueError('Toolchain input escaped known root')
                if row.get('symlink') is not None:
                    if (not filename.is_symlink() or os.readlink(filename) != row['symlink']
                            or str(filename.resolve()) != row['realpath']): raise ValueError('Toolchain symlink changed')
                    if 'sha256' in row and file_hash(filename.resolve()) != row['sha256']: raise ValueError('Link bytes changed')
                elif row.get('directory') is True:
                    if (not filename.is_dir() or filename.is_symlink() or not isinstance(row['children'], list)
                            or sorted(os.listdir(filename)) != sorted(row['children'])): raise ValueError('Toolchain membership changed')
                    if complete and any(str(filename / child) not in records for child in row['children']):
                        raise ValueError('Omitted toolchain dependency')
                elif (not filename.is_file() or filename.is_symlink() or file_hash(filename) != row['sha256']
                        or type(row.get('executable')) is not bool
                        or bool(filename.stat().st_mode & 0o111) != row['executable']): raise ValueError('Toolchain bytes/mode changed')
        if 'browserInputs' in groups['node']:
            browser_inputs = groups['node']['browserInputs']
            expected_names = {'chromium', 'chromium-headless-shell', 'available-playwright-cli-package'}
            if 'cliGlobalConfig' in groups['node']:
                expected_names.add('installed-cli-chrome')
                config = groups['node']['cliGlobalConfig']
                if config != {'path': str(Path.home() / '.playwright/cli.config.json'), 'absent': True} or Path(config['path']).exists() or Path(config['path']).is_symlink():
                    raise ValueError('CLI global config differs')
            if {row['name'] for row in browser_inputs} != expected_names:
                raise ValueError('Browser input payload missing')
            for row in browser_inputs:
                root = Path(row['root'])
                if row['name'] == 'available-playwright-cli-package':
                    if root != prefix / 'lib/node_modules/@playwright/cli': raise ValueError('CLI package escaped toolchain')
                    cli = lookups['playwrightCli']; current = shutil.which('playwright-cli')
                    if not current or cli['path'] != current or Path(current).resolve() != Path(cli['realpath']) or file_hash(Path(cli['realpath'])) != cli['sha256']:
                        raise ValueError('Actual Playwright CLI lookup changed')
                elif row['name'] == 'installed-cli-chrome':
                    if root != Path('/Applications/Google Chrome.app') or row['executable'] != str(root / 'Contents/MacOS/Google Chrome'):
                        raise ValueError('CLI browser payload escaped original Chrome channel')
                elif root.parent != Path.home() / 'Library/Caches/ms-playwright':
                    raise ValueError('Unreviewed browser payload root')
                if row['executable'] not in row['files'] or row['files'][row['executable']].get('executable') is not True:
                    raise ValueError('Browser executable missing')
                files(row['files'], root, True)
        files(npm['files'], npm_root, True)
        if str(npm_root) not in npm['files']: raise ValueError('npm root membership absent')
        for key in ('npm', 'npx'):
            if lookups[key]['realpath'] not in npm['files']: raise ValueError('Executed CLI not captured')
        names = sorted(name for name in os.listdir(library_root) if name.endswith('.dylib'))
        if (not names or libraries['names'] != names
                or any(str(library_root / name) not in libraries['files'] for name in names)):
            raise ValueError('Native library membership changed')
        files(libraries['files'], library_root, False)
        return []
    except (OSError, TypeError, KeyError, ValueError) as error:
        return [issue('HD235_NODE_TOOLCHAIN_UNKNOWN', message=str(error))]


# Reviewed execution recipes for these five business commands only. Tool suites
# and source-discovery checks cannot borrow their observational input roles.
HD235_OBSERVATIONAL_SUITES = frozenset({
    'inventory-task036-unit', 'inventory-task041-export-failure-audit-api',
    'inventory-task039-browser', 'inventory-task040-browser', 'inventory-p3-browser'})
HD235_OBSERVATIONAL_PATHS = frozenset({
    'server/scripts/inventoryPhase005Gate.py', 'server/scripts/inventoryPhase005Gate.test.py',
    'server/scripts/inventoryPhase005CoverageEvidence.mjs', '.github/workflows/ci.yml'})
HD235_REVIEWED_COORDINATORS = frozenset({
    '27f5c7b01c8cd0a9837b108ff7f266c240fcf7cd11dbcb18064f7fbfb51182aa',
    '866139fa5ef822aefa18fd017d5ec79d1090ec03d90b7c6269e32054cd77210f',
    '957b35368ee1deb313524912f56e949fb1227983b9bb36fa0b961c9ec38195fd', HD235_COORDINATOR_SHA})


def hd235_output_roles(producer_sha, suite_id):
    if producer_sha not in HD235_REVIEWED_COORDINATORS:
        raise Blocked('PRODUCER_IDENTITY')
    if producer_sha == HD235_COORDINATOR_SHA:
        return list(HD235_GENERATED_OUTPUTS.get(suite_id, ()))
    if suite_id not in HD235_OBSERVATIONAL_SUITES:
        raise Blocked('PRODUCER_IDENTITY')
    outputs = (['client/node_modules/.vite/deps'] if suite_id in
               {'inventory-p3-browser', 'inventory-task039-browser', 'inventory-task040-browser'} else [])
    if outputs and producer_sha in ('866139fa5ef822aefa18fd017d5ec79d1090ec03d90b7c6269e32054cd77210f',
                                    '957b35368ee1deb313524912f56e949fb1227983b9bb36fa0b961c9ec38195fd'):
        outputs.append('server/logs')
    return outputs


def hd235_supplier_doc_delta(raw, core, repo, changed_documents):
    """Anchor Supplier source differences to Git blobs; the caller checks full scope."""
    old, head = raw.get('code_commit'), core.current_commit(repo)
    if old == head:
        return {}
    if not isinstance(old, str) or not re.fullmatch('[a-f0-9]{40}', old):
        raise Blocked('HD235_MAIN_DOC_DELTA_UNKNOWN')
    names = set(core.git(repo, 'diff', '--name-only', '-z', old, head).split('\0')) - {''}
    if (not changed_documents or not changed_documents <= names
            or any(not name.startswith('docs/supplier_management/') for name in changed_documents)):
        raise Blocked('HD235_MAIN_DOC_DELTA_UNKNOWN')
    def blob(revision, name):
        rows = core.git(repo, 'ls-tree', '-z', revision, '--', name).split('\0')
        rows = [row for row in rows if row]
        if not rows:
            return None
        if len(rows) != 1:
            raise Blocked('HD235_MAIN_DOC_DELTA_UNKNOWN')
        metadata, filename = rows[0].split('\t', 1)
        mode, kind, oid = metadata.split()
        if filename != name or mode != '100644' or kind != 'blob':
            raise Blocked('HD235_MAIN_DOC_DELTA_UNKNOWN')
        data = subprocess.run(['git', '-C', str(repo), 'cat-file', 'blob', oid],
                              check=True, capture_output=True, timeout=30).stdout
        return {'sha256': sha(data), 'mode': mode, 'symlink': None}
    result = {name: (blob(old, name), blob(head, name)) for name in changed_documents}
    if any(pair[1] is None for pair in result.values()):
        raise Blocked('HD235_MAIN_DOC_DELTA_UNKNOWN')
    return result


def hd235_observational_applicability(raw, suite, source, current_map, plan, obs, core, repo):
    """Project reviewed hash reads only; preserve the original captured manifests."""
    baseline = hd235_attempt(raw, suite, raw['source_fingerprint'], plan)['classification']
    if (not baseline['verified'] or obs['selectedSuite'] != suite
            or obs['sourceFreeze'] != 'MATCHED' or not obs['hashesBefore']
            or obs['hashesBefore'] != obs['hashesAfter']
            or input_closure_issues(captured_inputs(obs, core))):
        raise Blocked('HD235_APPLICABILITY_UNKNOWN')
    groups = obs['hashesAfter']['hd233Inputs']
    source_capture = groups['tools']['sourceMap']
    if (source_capture['source_fingerprint'] != raw['source_fingerprint']
            or core.digest(source_capture['records']) != raw['source_fingerprint']):
        raise Blocked('INPUT_SOURCE_IDENTITY')
    before = source_map(source_capture['records'])
    changed = {name for name in set(before) | set(current_map) if before.get(name) != current_map.get(name)}
    projected = dict(groups)
    projected['python'] = dict(groups['python'])
    projected['python']['importFiles'] = copy.deepcopy(groups['python']['importFiles'])
    changed_documents = {name for name in changed if name.startswith('docs/supplier_management/')}
    documents = hd235_supplier_doc_delta(raw, core, repo, changed_documents) if changed_documents else {}
    if any(before.get(name) != pair[0] or current_map.get(name) != pair[1]
           for name, pair in documents.items()):
        raise Blocked('HD235_MAIN_DOC_DELTA_UNKNOWN')
    if changed:
        if (raw['suite_id'] not in HD235_OBSERVATIONAL_SUITES
                or not changed <= HD235_OBSERVATIONAL_PATHS | set(documents)):
            raise Blocked('HD235_SOURCE_SCOPE_UNKNOWN')
        imports = groups['python']['importFiles']
        for name in changed:
            old, new = before.get(name, {}), current_map.get(name, {})
            filename = str(repo / name)
            record = imports.get(filename, {})
            if name in documents and (not old or not new):
                parent = projected['python']['importFiles'].get(str((repo / name).parent), {})
                if parent.get('directory') is not True or parent.get('symlink') is not None:
                    raise Blocked('HD235_OBSERVATIONAL_INPUT_UNKNOWN')
                children = set(parent['children'])
                child = Path(name).name
                if not old and new and not record and child not in children:
                    children.add(child)
                    projected['python']['importFiles'][filename] = {'sha256': new['sha256'], 'executable': False}
                else:
                    raise Blocked('HD235_OBSERVATIONAL_INPUT_UNKNOWN')
                parent['children'] = sorted(children)
                continue
            if (old.get('mode') != '100644' or new.get('mode') != '100644'
                    or old.get('symlink') is not None or new.get('symlink') is not None
                    or set(record) != {'sha256', 'executable'} or record['executable'] is not False
                    or record['sha256'] != old.get('sha256') or not new.get('sha256')):
                raise Blocked('HD235_OBSERVATIONAL_INPUT_UNKNOWN')
            projected['python']['importFiles'][filename] = {'sha256': new['sha256'], 'executable': False}
    elif raw['source_fingerprint'] != source:
        raise Blocked('INPUT_SOURCE_IDENTITY')
    baseline['kind'] = 'EXACT' if raw['source_fingerprint'] == source else 'ADMIN_EQUIVALENT'
    return baseline, projected


def hd235_ui_current_input_projection(groups, repo, suite_id, executed_outputs):
    """Ignore only known unused outputs during current checks, not run capture."""
    if suite_id not in {'inventory-p3-browser', 'inventory-task039-browser', 'inventory-task040-browser'}:
        return groups, executed_outputs
    inactive = ('client/dist', 'client/coverage', 'server/coverage', 'client/node_modules/.vite/vitest')
    roots = tuple(repo / name for name in inactive)
    def unused(path):
        return any(path == root or path.is_relative_to(root) for root in roots)
    original_files = groups['python']['importFiles']
    installed = groups['node']['installedInputs']
    for name, root in zip(inactive, roots):
        if root.is_symlink() or root.exists() and not root.is_dir():
            raise Blocked('HD235_INACTIVE_OUTPUT_ROLE_UNKNOWN')
        for record in (original_files.get(str(root)), installed.get(name)):
            if record is not None and (record.get('directory') is not True or record.get('symlink') is not None):
                raise Blocked('HD235_INACTIVE_OUTPUT_ROLE_UNKNOWN')
    if (any(unused(Path(origin)) for origin in groups['python']['importOrigins'].values())
            or any(unused(Path(row['path'])) for row in groups['python']['importRoots'])):
        raise Blocked('HD235_INACTIVE_OUTPUT_ROLE_UNKNOWN')
    check_outputs = sorted(set(executed_outputs) | set(inactive))
    projected = dict(groups)
    projected['python'] = dict(groups['python'])
    files = {name: dict(record) for name, record in original_files.items() if not unused(Path(name))}
    for name, record in files.items():
        if record.get('directory') is not True or record.get('symlink') is not None:
            continue
        old_children = sorted(Path(output).name for output in executed_outputs if (repo / output).parent == Path(name))
        if record.get('generatedChildren', []) != old_children:
            raise Blocked('HD235_INACTIVE_OUTPUT_ROLE_UNKNOWN')
        generated = sorted(Path(output).name for output in check_outputs if (repo / output).parent == Path(name))
        if generated:
            record['children'] = [child for child in record['children'] if child not in generated]
            record['generatedChildren'] = generated
    projected['python']['importFiles'] = files
    projected['node'] = dict(groups['node'])
    projected['node']['installedInputs'] = {name: record for name, record in installed.items() if not unused(repo / name)}
    return projected, check_outputs


def read_hd235_receipt(repo, module, scripts, raw, verified=None, source_observation=None):
    core, _checks = load_harness(scripts); ctx = core.Context(module, repo)
    registry = hd235_adoption(ctx, core); descriptor = registry[raw['suite_id']]
    relative = 'evidence/' + raw['run_id'] + '/run.json'
    if relative not in ctx.state['evidence_files']: raise Blocked('ORIGINAL_RUN_NOT_REGISTERED')
    reference = core.inside(module, 'evidence/' + raw['run_id'] + '/runtime-complete-ref.json', True)
    pointer = json.loads(reference.read_text())
    if not re.fullmatch(r'evidence/task041-hd235-' + re.escape(raw['suite_id']) + r'-[a-f0-9]{12}/observation.json', pointer['path']):
        raise Blocked('HD235_RECEIPT_REFERENCE')
    document = original_document(module, pointer['path'], pointer['sha256']); obs = document['raw']
    original_document(module, HD235_COORDINATOR, HD235_COORDINATOR_SHA)
    executed_sha = obs['coordinatorHash']
    if (executed_sha not in HD235_REVIEWED_COORDINATORS
            or executed_sha != HD235_COORDINATOR_SHA and raw['suite_id'] not in HD235_OBSERVATIONAL_SUITES):
        raise Blocked('PRODUCER_IDENTITY')
    if (obs['kind'] != 'FROZEN_HD235_INVENTORY_RUNTIME' or obs['suiteId'] != raw['suite_id']
            or obs['hashesBefore']['executedCoordinator'] != executed_sha):
        raise Blocked('PRODUCER_IDENTITY')
    archive = obs['coordinatorArchive']
    if Path(archive['path']).parent != Path(ctx.manifest['docs_path']) / Path(pointer['path']).parent:
        raise Blocked('COORDINATOR_ARCHIVE_OWNER')
    archived = original_document(module, core.inside(repo, archive['path'], True).relative_to(module).as_posix(), archive['sha256'])
    if archived['sha256'] != executed_sha:
        raise Blocked('COORDINATOR_EXECUTED_SOURCE_CHANGED')
    producer = archived
    outputs = hd235_output_roles(executed_sha, raw['suite_id'])
    root = Path(obs['root']); transport = descriptor['proposed_recipe']; ns = descriptor['namespace_plan']
    prefix = ns.get('private_root_prefix', '/private/tmp/erp-inventory-hd235-files.')
    schema_prefix = ns.get('database_prefix', '')
    if (root.parent != Path('/private/tmp') or root.name != raw['runtime_instance_id']
            or not str(root).startswith(prefix) or not re.fullmatch('[A-Za-z0-9]+', str(root)[len(prefix):])):
        raise Blocked('RUNTIME_ROOT_IDENTITY')
    original = original_document(module, relative, obs['typedEvidence']['sha256'])
    original['raw'] = core.typed_json(core.inside(module, relative, True), 'evidence')
    if original['raw'] != raw: raise Blocked('ORIGINAL_TYPED_RECORD_CHANGED')
    closure = captured_inputs(obs, core)
    groups = obs['hashesAfter']['hd233Inputs']
    if (groups['tools']['sourceMap']['source_fingerprint'] != raw['source_fingerprint']
            or core.digest(groups['tools']['sourceMap']['records']) != raw['source_fingerprint']
            or groups['tools']['producer']['sha256'] != producer['sha256']): raise Blocked('INPUT_SOURCE_IDENTITY')
    source, current_map = source_observation or observed_source(core, repo, ctx.manifest['docs_path'])
    classification, projected = hd235_observational_applicability(
        raw, ctx.suite_map()[raw['suite_id']], source, current_map, ctx.baselines()['plan'], obs, core, repo)
    cache_key = (document['sha256'], source)
    if verified is None or cache_key not in verified:
        current_inputs, check_outputs = hd235_ui_current_input_projection(projected, repo, raw['suite_id'], outputs)
        problems = current_manifest_issues(current_inputs, ctx, check_outputs) + hd235_node_toolchain_issues(groups)
        if problems: raise Blocked(problems[0]['code'])
        if verified is not None: verified.add(cache_key)
    if transport in ('BROWSER_REAL_APP', 'BROWSER_DECLARED_MOCK') and len(groups['node'].get('browserInputs', [])) != (4 if raw['suite_id'] in ('inventory-task039-browser', 'inventory-task040-browser') else 3):
        raise Blocked('BROWSER_EXECUTABLE_INPUTS_REQUIRED')
    expected = {'owner': root.name, 'workspace': str(repo), 'root': str(root),
        'schema': obs.get('schema'), 'schema_prefix': schema_prefix, 'socket': str(root / 'mysql.sock'),
        'datadir': str(root / 'data'), 'account': 'root@localhost'}
    terminal = obs.get('terminal', {}); daemons = [p for p in obs['processes'] if p['label'] == 'daemon']
    sql = obs.get('postTestSql') == {'connections': 0, 'transactions': 0, 'locks': 0} and terminal.get('sqlTerminal') is True
    resources = {key: sql for key in ('sql_terminal', 'transaction_terminal', 'lock_terminal')}
    resources.update(worker_terminal=all(p.get('settled') is True and p.get('groupTerminal') is True for p in obs['processes']),
        socket_terminal=terminal.get('observerSocketClosed') is True, schema_dropped=terminal.get('dropped') is True,
        root_removed=not root.exists(), daemon_exit_zero=len(daemons) == 1 and daemons[0].get('result') == {'code': 0, 'signal': None})
    if transport in ('FILES_DIRECT', 'BROWSER_DECLARED_MOCK'):
        if daemons or 'mysql' in obs or obs.get('schema') is not None: raise Blocked('INVENTED_FILES_DATABASE')
    elif len(daemons) != 1 or not schema_prefix or not re.fullmatch(re.escape(schema_prefix) + '[a-f0-9]{12}', obs['schema']):
        raise Blocked('DATABASE_OWNER_UNKNOWN')
    registered = {relative: original['sha256']}
    output_names = set(outputs)
    output_snapshots = obs['generatedOutputSnapshots']
    if (len(output_snapshots) != 2 or any(set(row['outputs']) != output_names for row in output_snapshots)
            or not timestamp(obs['startedAt']) <= timestamp(output_snapshots[0]['observedAt'])
                <= timestamp(output_snapshots[1]['observedAt']) <= timestamp(obs['finishedAt'])):
        raise Blocked('GENERATED_OUTPUT_OBSERVATION_REQUIRED')
    recipe = {'kind': 'HD235', 'transport': transport, 'producer': producer, 'inputs': closure,
        'registered_records': registered, 'started_at': obs['startedAt'], 'ended_at': obs['finishedAt'],
        'lifecycle': {'state': 'COMPLETE', 'finalized_at': obs['finishedAt'], 'registered_before_validation': True}}
    receipt = {'binding': expected, 'runtime_instance_id': raw['runtime_instance_id'], 'observation': obs,
        'typed_record': original, 'typed_records': {relative: original}, 'resource_proof': resources, 'recipe': recipe}
    policy = {'expected': expected, 'suite_map': ctx.suite_map(), 'recipe': {'kind': 'HD235', 'transport': transport,
        'producer_sha256': producer['sha256']}, 'load_suites': ['inventory-task041-characterization', 'inventory-task041-resource-soak']}
    if raw['suite_id'] == 'inventory-p3-coverage-floors':
        admitted = hd235_verified_floor_lcov(ctx, core, source)
        proof = obs['floorConsumption']
        lcov_name = str(Path(pointer['path']).parent / 'ci-native-lcov.info')
        lcov = original_document(module, lcov_name, admitted['binding']['lcov_sha256'])
        lcov['path'] = str(Path(ctx.manifest['docs_path']) / lcov_name)
        stdout_name = str(Path(relative).parent / 'stdout.log')
        stdout_ref = next((row for row in raw['artifacts'] if row['path'] == stdout_name), None)
        if stdout_ref is None: raise Blocked('HD235_FLOOR_STDOUT_REQUIRED')
        stdout = original_document(module, stdout_name, stdout_ref['sha256'])
        backup = Path(proof['backupDirectory'])
        if (backup.parent != repo / 'server/coverage'
                or not re.fullmatch(r'\.hd235-floor-[A-Za-z0-9]{6}', backup.name) or backup.exists() or backup.is_symlink()):
            raise Blocked('HD235_FLOOR_RESTORATION_UNKNOWN')
        policy['floor'] = {'binding': admitted['binding'], 'raw': raw, 'lcov': lcov, 'stdout': stdout}
    live = obs['livePreflight']
    live_doc = original_document(module, live['path'], live['sha256'])
    if (Path(live['path']).parent != Path(pointer['path']).parent or live_doc['raw']['status'] != 'BLOCKED'
            or not live_doc['raw']['issues'] or not any(row['suite_id'] == raw['suite_id'] and row['status'] != 'APPLICABLE'
                for row in live_doc['raw'].get('applicability', []))): raise Blocked('LIVE_PREFLIGHT_PROOF_REQUIRED')
    if transport in ('MYSQL_HTTP', 'BROWSER_REAL_APP'):
        artifact = obs['httpNative']; artifact_path = core.inside(repo, artifact['path'], True).relative_to(module).as_posix()
        native = original_document(module, artifact_path, artifact['sha256'])
        if artifact.get('format', 'JSON') == 'JSON' and (not isinstance(native['raw'], list) or not native['raw']):
            raise Blocked('HTTP_RECIPE_NOT_IMPLEMENTED')
        receipt['http'] = {'transport': 'REAL_HTTP', 'suite_id': raw['suite_id'], 'native_report': native, 'format': artifact.get('format', 'JSON')}
        policy['http'] = {'required_native_report_hash': native['sha256']}
    if transport == 'MYSQL_IPC_PROCESS' and raw['suite_id'] != 'inventory-task041-gate-binding-native':
        artifact = obs['nativeOwnership']
        name = core.inside(repo, artifact['reportPath'], True).relative_to(module).as_posix()
        receipt['native_report'] = original_document(module, name, artifact['sha256'])
    if transport == 'MYSQL_IPC_PROCESS' and raw['suite_id'] == 'inventory-task041-gate-binding-native':
        artifact = obs['nativeOwnership']; artifact_path = core.inside(repo, artifact['reportPath'], True).relative_to(module).as_posix()
        receipt['native_report'] = original_document(module, artifact_path, artifact['sha256'])
        receipt['native_report']['path'] = artifact['reportPath']
        execution_path = str(Path(relative).parent / 'inventory-phase005-native-executable.json')
        proof = artifact['executionProof']
        if proof['path'] != str(Path(ctx.manifest['docs_path']) / execution_path):
            raise Blocked('NATIVE_EXECUTABLE_PROOF_PATH')
        execution = original_document(module, execution_path, proof['sha256'])['raw']
        published = repo / 'server/test-support/inventoryPhase005GateNative.mjs.txt'
        digest = file_hash(published)
        archive_path = Path(relative).parent / 'inventoryPhase005GateNative.mjs.txt'
        if (execution['kind'] != 'ACTUAL_NATIVE_PRIVATE_EXECUTABLE' or execution['repo'] != str(repo)
                or execution['owner_root'] != str(root) or execution['executed_path'] != str(root / 'inventoryPhase005GateNative.mjs')
                or execution['source_path'] != published.relative_to(repo).as_posix()
                or execution['archive_path'] != str(Path(ctx.manifest['docs_path']) / archive_path)
                or any(execution[key] != digest for key in ('source_sha256', 'archive_sha256',
                    'executed_before_sha256', 'executed_after_sha256', 'archive_after_sha256'))
                or file_hash(core.inside(module, archive_path.as_posix(), True)) != digest
                or execution['native_report'] != {'executed_path': str(root / 'inventory-phase005-gate-native.json'),
                    'archive_path': artifact['reportPath'], 'sha256': artifact['sha256']}
                or execution['status'] != 'EXECUTED_SOURCE_UNCHANGED' or execution['exit_code'] != 0
                or execution['node'] != {key: groups['path']['node'][key] for key in ('path', 'realpath', 'sha256')}
                or execution['cwd'] != str(repo)
                or execution['command'] != [execution['node']['path'], '--test', '--test-concurrency=1',
                    '--test-reporter=junit', '--test-reporter-destination=' + str(module / Path(relative).parent / 'inventory-task041-gate-binding-native.xml'),
                    str(root / 'inventoryPhase005GateNative.mjs')]
                or not timestamp(raw['started_at']) <= timestamp(execution['started_at'])
                    <= timestamp(execution['ended_at']) <= timestamp(raw['ended_at'])):
            raise Blocked('NATIVE_EXECUTABLE_BINDING_REQUIRED')
    if raw['suite_id'] in ('inventory-task039-browser', 'inventory-task040-browser'):
        browser_cli = obs['browser']['cli']
        workspace = str(module / Path(relative).parent)
        problems = hd235_cli_terminal_issues(browser_cli, workspace, os.geteuid(),
            'st039-' if raw['suite_id'] == 'inventory-task039-browser' else 'st040-')
        if problems or browser_cli.get('cacheRemoved') is not True or browser_cli.get('verified') is not True:
            raise Blocked('CLI_ACTUAL_TERMINAL_REQUIRED')
        entry = browser_cli['sessions'][0]
        if (timestamp(entry['close']['startedAtLowerBound']) < timestamp(raw['started_at']) - dt.timedelta(seconds=1)
                or timestamp(entry['close']['observedGoneAt']) > timestamp(obs['finishedAt'])):
            raise Blocked('CLI_OBSERVATION_OUTSIDE_ACTUAL_RUNTIME')
        archive = entry['sessionFile']['archivePath']
        if (Path(obs['output']) != module / Path(pointer['path']).parent
                or Path(archive).parent != Path(obs['output']).relative_to(repo)): raise Blocked('CLI_SESSION_ARCHIVE_OWNER')
        config = original_document(module, core.inside(repo, archive, True).relative_to(module).as_posix(), entry['sessionFile']['sha256'])['raw']
        if (config['name'] != entry['name'] or config['workspaceDir'] != workspace or config.get('attached', False)
                or config['cli'].get('persistent', False) or config['browser']['launchOptions']['channel'] != 'chrome'
                or config['socketPath'] != entry['socket']['path']): raise Blocked('CLI_ACTUAL_SESSION_CHANGED')
        for process in (entry['daemon'], entry['browser'], entry['close']):
            if sha(process['commandOriginal'].encode()) != process['commandSha256']: raise Blocked('CLI_PROCESS_COMMAND_CHANGED')
        if ('/entry/cliDaemon.js ' + entry['name'] not in entry['daemon']['commandOriginal']
                or not entry['browser']['commandOriginal'].startswith('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome ')
                or '--user-data-dir=' + entry['profile']['path'] not in entry['browser']['commandOriginal']
                or ' -s=' + entry['name'] + ' close' not in entry['close']['commandOriginal']): raise Blocked('CLI_ACTUAL_PROCESS_OWNER')

    receipt['classification'] = classification
    return receipt, policy


def collect_hd235_receipts(repo, module, scripts, selected, ctx, core, checks):
    registry = hd235_adoption(ctx, core)
    if hd235_selection_issues(list(selected), registry): raise Blocked('PREFLIGHT_SCOPE')
    source, current_map = observed_source(core, repo, ctx.manifest['docs_path'])
    attempts = registered_attempts(ctx, core, selected); summaries, issues, validated = [], [], {}
    verified = set()
    for sid in selected:
        try:
            for row in attempts[sid]:
                row['classification'] = hd235_attempt(row['raw'], ctx.suite_map()[sid], source, ctx.baselines()['plan'])['classification']
                if not row['classification']['verified'] and sid in HD235_OBSERVATIONAL_SUITES:
                    try:
                        observed, _policy = read_hd235_receipt(
                            repo, module, scripts, row['raw'], verified, (source, current_map))
                        row['classification'] = observed['classification']
                    except (Blocked, core.HarnessError, OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError):
                        pass  # Keep this attempt UNKNOWN; later uncertainty still blocks selection.
            latest = select_latest(attempts[sid]); raw = latest['raw']
            receipt, policy = read_hd235_receipt(repo, module, scripts, raw, verified, (source, current_map))
            result = validate_attempt(ctx, ctx.suite_map()[sid], raw, latest['classification'], hd235_runtime_issues(raw, receipt, policy), checks)
            validated[sid] = result
            summaries.append({'suite_id': sid, 'status': result['status'], 'raw_path': latest['path'],
                'raw_sha256': file_hash(module / latest['path']), 'issues': result['issues']})
            issues.extend(result['issues'])
        except (Blocked, core.HarnessError, OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError) as error:
            problems = [issue(getattr(error, 'code', 'RECEIPT_PROOF_UNKNOWN'), sid, str(error))]
            summaries.append({'suite_id': sid, 'status': 'UNKNOWN', 'issues': problems}); issues.extend(problems)
    if source != core.fingerprint(repo, ctx.manifest['docs_path']): issues.append(issue('SOURCE_CHANGED_DURING_READ'))
    return {'status': 'BLOCKED' if issues else 'RECEIPT_PREFLIGHT_PASS', 'issues': issues, 'applicability': summaries,
        'current_source': source, 'current_baselines': ctx.baselines(), 'validated': validated}


def collect_hd235_gate(repo, module, scripts):
    core, checks = load_harness(scripts); ctx = core.Context(module, repo); registry = hd235_adoption(ctx, core)
    generic = checks.verify_gate(ctx, 'MERGE_READY', ['PHASE-005'])
    result = collect_hd235_receipts(repo, module, scripts, sorted(registry), ctx, core, checks)
    result['issues'] = resolve_core_issues(generic['issues'], result.pop('validated'), set(registry)) + result['issues']
    result['issues'].extend(collect_coverage_provenance(ctx, core, result['current_source']))
    if not any(r['method'] == 'HUMAN' and r['reviewer'] == 'Sam' and r['reviewed_baseline'] == result['current_source']
            and r['status'] == 'APPROVED' and r['open_critical'] == 0 and r['open_high'] == 0 for r in ctx.state['reviews']):
        result['issues'].append(issue('ADAPTER_SOURCE_REVIEW_REQUIRED'))
    result.update(status='BLOCKED' if result['issues'] else 'INVENTORY_PHASE005_MERGE_READY', generic_gate=generic,
        required_groups=73, scope='Actual73-group developer applicability; no historical or aggregate control waived.')
    return result


def collect_receipt_preflight(repo, module, scripts, selected_suites):
    core, checks = load_harness(scripts)
    ctx = core.Context(module, repo)
    if ctx.baselines() == HD235_BASELINES:
        result = collect_hd235_receipts(repo, module, scripts, list(selected_suites), ctx, core, checks)
        result.pop('validated')
        result['scope'] = 'Selected receipt collector only; not aggregate GateReady, CI, P4 or release approval.'
        return result
    selected = list(selected_suites)
    if (not selected or len(selected) != len(set(selected)) or not set(selected) <= HD233_PREFLIGHT_SUITES
            or module != repo / 'docs/inventory_management'):
        raise Blocked('PREFLIGHT_SCOPE')
    core, checks = load_harness(scripts)
    ctx = core.Context(module, repo)
    candidate = hd233_adoption(ctx, core)
    current_source, current_map = observed_source(core, repo, ctx.manifest['docs_path'])
    attempts = registered_attempts(ctx, core, selected)
    summaries, issues = [], []
    verified = set()
    for sid in selected:
        try:
            for attempt in attempts[sid]:
                raw = attempt['raw']
                # No missing historical closure is promoted by a matching label.
                attempt['classification'] = hd233_attempt_classification(
                    ctx, core, raw, ctx.suite_map()[sid], current_source, current_map, candidate)
            latest = select_latest(attempts[sid]); raw = latest['raw']
            receipt, policy = hd233_receipt(ctx, core, raw, candidate, verified)
            resource_issues = runtime_proof_issues(raw, receipt, policy)
            result = validate_attempt(ctx, ctx.suite_map()[sid], raw, latest['classification'], resource_issues, checks)
            summaries.append({'suite_id': sid, 'status': result['status'], 'raw_path': latest['path'],
                'raw_sha256': file_hash(ctx.module_dir / latest['path']), 'issues': result['issues']})
            issues.extend(result['issues'])
        except (Blocked, core.HarnessError, OSError, ValueError, TypeError, KeyError, AttributeError) as error:
            problems = [issue(getattr(error, 'code', 'RECEIPT_PROOF_UNKNOWN'), sid, str(error))]
            summaries.append({'suite_id': sid, 'status': 'UNKNOWN', 'issues': problems}); issues.extend(problems)
    if current_source != core.fingerprint(repo, ctx.manifest['docs_path']):
        issues.append(issue('SOURCE_CHANGED_DURING_READ'))
    return {'status': 'BLOCKED' if issues else 'RECEIPT_PREFLIGHT_PASS', 'issues': issues,
        'applicability': summaries, 'current_source': current_source, 'current_baselines': ctx.baselines(),
        'scope': 'Selected receipt collector only; not aggregate GateReady, CI, P4 or release approval.'}


def collect_hd233_gate(repo, module, scripts):
    core, checks = load_harness(scripts); ctx = core.Context(module, repo)
    candidate = hd233_adoption(ctx, core)
    generic = checks.verify_gate(ctx, 'MERGE_READY', ['PHASE-005'])
    source, current_map = observed_source(core, repo, ctx.manifest['docs_path'])
    required = set(next(p['developer_suites'] for p in ctx.trace['phases'] if p['id'] == 'PHASE-005'))
    required.update(ctx.manifest['required_suites']['developer'])
    attempts = registered_attempts(ctx, core, required)
    validated, summaries, issues = {}, [], []
    for sid in sorted(required):
        try:
            for attempt in attempts[sid]:
                attempt['classification'] = hd233_attempt_classification(
                    ctx, core, attempt['raw'], ctx.suite_map()[sid], source, current_map, candidate)
            selected = select_latest(attempts[sid]); raw = selected['raw']
            receipt, policy = hd233_receipt(ctx, core, raw, candidate)
            result = validate_attempt(ctx, ctx.suite_map()[sid], raw, selected['classification'],
                                      runtime_proof_issues(raw, receipt, policy), checks)
            validated[sid] = result
            summaries.append({'suite_id': sid, 'status': result['status'], 'raw_path': selected['path'],
                'classification': selected['classification']['kind'], 'issues': result['issues']})
            issues.extend(result['issues'])
        except (Blocked, core.HarnessError, OSError, ValueError, TypeError, KeyError, AttributeError) as error:
            problems = [issue(getattr(error, 'code', 'RECEIPT_PROOF_UNKNOWN'), sid, str(error))]
            summaries.append({'suite_id': sid, 'status': 'UNKNOWN', 'issues': problems}); issues.extend(problems)
    remaining = resolve_core_issues(generic['issues'], validated, required) + issues
    remaining.extend(collect_coverage_provenance(ctx, core, source))
    if not any(r['method'] == 'HUMAN' and r['reviewer'] == 'Sam' and r['reviewed_baseline'] == source
               and r['status'] == 'APPROVED' and r['open_critical'] == 0 and r['open_high'] == 0 for r in ctx.state['reviews']):
        remaining.append(issue('ADAPTER_SOURCE_REVIEW_REQUIRED'))
    if source != core.fingerprint(repo, ctx.manifest['docs_path']): remaining.append(issue('SOURCE_CHANGED_DURING_READ'))
    return {'status': 'BLOCKED' if remaining else 'INVENTORY_PHASE005_MERGE_READY', 'generic_gate': generic,
        'issues': remaining, 'required_groups': len(required), 'applicability': summaries,
        'scope': 'Actual developer applicability only; no historical gap, missing recipe or aggregate control waived.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native-preflight', action='store_true')
    parser.add_argument('--receipt-preflight', action='store_true')
    parser.add_argument('--suite', action='append', default=[])
    parser.add_argument('--report-dir', type=Path)
    parser.add_argument('--repo-root', type=Path, default=Path.cwd())
    parser.add_argument('--module', type=Path, default=Path('docs/inventory_management'))
    parser.add_argument('--harness-scripts', type=Path, default=Path('/Users/sam/.agents/skills/software-engineering-harness/scripts'))
    parser.add_argument('--gate', choices=['MERGE_READY'], default='MERGE_READY')
    parser.add_argument('--phase', choices=['PHASE-005'], default='PHASE-005')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    try:
        if args.receipt_preflight and (args.native_preflight or args.report_dir): raise Blocked('PREFLIGHT_SCOPE')
        if args.native_preflight and args.report_dir:
            return native_preflight(args.report_dir)
        if args.native_preflight or args.report_dir: raise Blocked('NATIVE_ARGUMENTS_REQUIRED')
        repo = args.repo_root.resolve(strict=True)
        module = (repo / args.module).resolve(strict=True)
        if module != repo / 'docs/inventory_management': raise Blocked('GATE_SCOPE')
        if args.receipt_preflight:
            if not args.suite or len(args.suite) != len(set(args.suite)):
                raise Blocked('PREFLIGHT_SCOPE')
            if not set(args.suite) <= HD233_PREFLIGHT_SUITES:
                core, _checks = load_harness(args.harness_scripts)
                try: hd235_adoption(core.Context(module, repo), core)
                except core.HarnessError as error: raise Blocked('PREFLIGHT_SCOPE') from error
            result = collect_receipt_preflight(repo, module, args.harness_scripts, args.suite)
        elif args.suite: raise Blocked('PREFLIGHT_SCOPE')
        else: result = collect_gate(repo, module, args.harness_scripts)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result['status'] in ('INVENTORY_PHASE005_MERGE_READY', 'RECEIPT_PREFLIGHT_PASS') else 1
    except (Blocked, OSError, ValueError, TypeError, KeyError, AttributeError, RuntimeError) as error:
        print(json.dumps({'status': 'BLOCKED', 'issues': [issue(getattr(error, 'code', 'INPUT_ERROR'), message=str(error))]}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
