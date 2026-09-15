# Test Environment and Baseline Verification

## Implementation Baseline

- Commit/Tag/Build/Version: metadata-only candidate `49d487e876932e6684cbdbec46043312b3f730bd`; unchanged product source originates at `996072b24acb7daff4453f91da46d93c4613e4c6`
- Branch/PR (if relevant): local branch `codex/item-management-task-038`; no new PR/CI observation is claimed for this verification run.
- Deployment identifier: local runtime `ITEM-TASK044-LOCAL-20260914`; no immutable deployed build exists.

## Specification Baselines

- Requirement: SHA-256 `8181e39034218c09408772105dfec25a6bd71fbd67effc4e07ac59252914ba13`
- Design: Harness hash `cdca7fa0e1861eda5f4e19d67701bcc58743ea4b022863f93c53e0df8d46ce4a`
- Plan: Harness hash `85253762f1aad08a605b0dc91f90dc0a8e524cd70b1ae1d2cbe567738e0fc3f3`
- Technical Test Specification: SHA-256 `2732e782eef298939d5a63e86723fda0e4bdeeaf36ad0112de36044c1bb4bd00`
- UAT Test Specification: SHA-256 `11744bf7aba2ee5d1fed9f1eecb8f0cbff8c81681553723c2076b654401fb8d7`

## Environment

- Environment name: `item-isolated-test` / `LOCAL_ISOLATED`
- Endpoint/namespace (non-secret): application ports reserved as server `127.0.0.1:3000`, client `127.0.0.1:4173`; MySQL `127.0.0.1:3306/erp_dev`
- Relevant configuration fingerprint: source fingerprint `905b8478823c24e24f89af163c0d551edb42d616178572b1fd11dd64b04a3073`; Node `v26.6.0`; MySQL client/server `26.7.0`; Playwright `1.63.0`
- External dependencies: local MySQL only. No production service, third-party API, staging backup system or remote object storage is authorized.
- Business date/timezone assumptions: verification date `2026-09-14`; project/user timezone `Asia/Hong_Kong`; machine evidence timestamps are recorded in UTC where stated.

## Test Data

- Dataset/reference: synthetic Item fixtures defined by `06_technical_test_cases.md`; database schema `erp_dev`; file roots `server/storage/items` and `server/storage/imports` inside the isolated worktree.
- Reset/cleanup approach: suites use unique run prefixes and their existing fixture teardown. Before/after evidence must identify any retained fixture. No production data is permitted.

## Verification Result

`PARTIAL`

## Limitations

- This is a local isolated environment, not the approved staging-like environment required for backup/restore `TC-016`, production-scale load, or release approval.
- Ports 3000 and 4173 were observed without listeners before execution; the test-owned services may bind them during browser validation.
- The recovery acceptance adapter and Item UAT Playwright project configuration referenced by the approved profile are absent.
- Database credentials are provided through approved environment variables and must not appear in evidence.

## Runtime isolation and permission

- Runtime instance / owner / resource namespaces: `ITEM-TASK044-LOCAL-20260914`; owner `Primary TEST_AND_VERIFY agent`; worktree `/private/tmp/erp-item-management-task-038`; schema `erp_dev`; worktree-local media/import roots; ports 3000/4173.
- Real lease/coordinator observation (if serialized): MySQL advisory lock `erp-item-task044-local-20260914` is live on connection ID `23483`; `IS_USED_LOCK(...)` returned the same owner at `2026-09-14T09:21:56Z`.
- Approved environment/data authorization: active Codex task records ERP Product Owner (Sam) authorization for `TEST_AND_VERIFY`; the same task previously directed use of local MySQL. Synthetic data only.
- Mode-entry commit / source fingerprint / plan hash: `49d487e876932e6684cbdbec46043312b3f730bd` / `905b8478823c24e24f89af163c0d551edb42d616178572b1fd11dd64b04a3073` / `85253762f1aad08a605b0dc91f90dc0a8e524cd70b1ae1d2cbe567738e0fc3f3`.
- External deployment identity adapter and unsupported limits: not configured; local process identity is the maximum observable deployment identity. No claim is made about a remote deployment.
- Evidence classification, redaction and export permission: repository-local verification evidence; secrets redacted; profile `allow_export=false`, so evidence is not exported externally.
