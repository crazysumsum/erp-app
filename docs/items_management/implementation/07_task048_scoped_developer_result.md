# TASK-048 — scoped Item provider implementation

2026-10-14. Active mode: IMPLEMENT; module status remains BLOCKED. Actual Sam authorization APR-064/065 approves PLAN `a988403a54052de14169c49fd4596a05415499ae2aeadd0f306bc9100313d126` and the [pinned scoped procedure](06_task048_scoped_implementation_entry.md), SHA `8b073ef4a4eaf8ea732faa4704aaa0f008f60f84f01e57bd6bafeb91e7426e6b`. DESIGN remains `3daef7460516dd7e24d5db5575a1b580dbc81f078d31a1c54867192bc1904a66`. No push, PR, merge, raw evidence export or formal acceptance is authorized.

## Implemented scope and baseline

Fresh DEFAULT main `8bbb0d3d69e5843f663ada3313644d704363ccc1`; managed worktree `item-task048-provider`, branch `codex/item-task048-provider`. Local planning recovery `535f549c93b90e24ddad036bbb74c74b9af9af4c` was applied without conflicts as `f8ce9027f5c2692c9ee3d69d5bc31c78dd64ac98`, preserving the original planning worktree. No stacked downstream branch or other-module source change.

The only product change is the 32-line named `ItemLookupService.findManyForCommittedReceipt(skuIds, { atMs })`. It validates positive safe-integer IDs / nonnegative safe-integer time before SQL, deduplicates / sorts at most100 unique identities, rejects the lowest missing identity before the lowest serial identity, and returns current facts with ordered warnings and all historical UOM mappings. Nonempty success uses exactly two parameterized SELECTs on the injected executor; empty input uses none. There is no new generic purpose, receiving eligibility/authority field, endpoint, schema, permission, dependency, lock, transaction lifecycle or downstream integration. Existing purchase / inventory / Sales rules remain unchanged; caller-owned transaction reads are snapshots, normal pool reads are advisory.

Only the provider and its two existing Item lookup test files changed; optional `itemConstants.js` was unnecessary. Nine unit + four actual-MySQL TC-019 developer leaves cover validation/batching, exact projection/UOM shape, warning order/date boundaries/time capture, deterministic all-or-error, SQL failure propagation, old-rule non-relaxation, multi-SKU mapping identity, and controlled concurrent master updates through both transaction and ordinary pool executors. The complete preexecution catalog has537 server and866 client leaves; parents/min_tests=1 are not used as completeness credit.

Frozen original provider/test hashes independently reviewed:

- Provider: `c0c317859b5a80e673618971f89437deac3782f23e9f9dc638d7836c1a9ec3fc`.
- Unit tests: `e36df73cda31cb5272d29a5d8ffe2057956e46da7723002a5cb7fae7e16e5a36`.
- Integration tests: `5f6774a37448bc52e7fa6a338be5955a7deb8dd19a810473b9613f88988d2dc8`.
- Final unmutated source fingerprint: `f7d34aaf823791612ac011a6a037a172f056e9a581b5a0d61fd30dbc7e9890f2`.

## Runtime and preserved failures

New task-owned MySQL26.7.0, private socket/schema/account (actual resource values retained LOCAL_ONLY); parent directory700 and private credentials600 outside repository. TCP/MySQLX disabled. Existing migrations through0081 succeeded; no migration changed or shared `erp_dev` touched. The first sandbox initialization signal11 was preserved; permitted unsandboxed initialization in a separate `owned-data` directory succeeded. Initial migration1419 at0057 was preserved; this disposable nonreplicated instance was restarted without binlog, retaining schema-only test account and immutable triggers; idempotent migration retry succeeded.

Initial full server RED `c9c341a4` failed237:228 application-config failures because the synthetic Customer/Supplier rings were mistakenly generated separately, plus9 missing-method cases. Only private synthetic rings were corrected to the latest-main shared-ring contract. Corrected RED `17ba729a` and strengthened-test RED `3841cb95` each discovered537:524 existing PASS,13 expected new missing-method FAIL,0 skip/NOT_RUN. Original evidence/catalog hashes remain local and unchanged; these failures are not final PASS or formal defect disposition.

First unmutated four native runs: lint/build exit0, client866/866 PASS, server537/537 PASS including13 TC-019 and0 skips. Server helper `500a886d` nevertheless recorded FAIL_OR_BLOCKED because its additional all-table row-count equality observed nonce20→30 / idempotency68→102. Schema/identity/PID/all other counts were identical. This failed observation remains unchanged, not relabeled PASS.

Read-only diagnosis verified framework stores intentionally retain replay-security records until TTL. Independent review required a fail-closed cleanup observer instead of deleting records or masking arbitrary growth: exact nonce+10 / idempotency+34, identical schema/table set/identity/PID/all other counts, all old rows retained unchanged (full idempotency row hash), and bounded newly identified SHA-only TTL rows; new idempotency records must be completed/201. This affects only supporting runtime observation, not original tests/profile/command/gate/thresholds. Observer policy/hash, helper SHA `ae56e47026047c9ec34426825b4c2c0838fb0c8ec63bc39ab398d3a665598f29`, full deltas and the immutable failed-run reference accompany new local evidence. Supporting synthetic self-check accepts the precise valid retention and refuses9 unexpected count/schema/PID/expiry/old-row/table-set/identity/state/status mutations; it is not a fifth developer suite.

## Independent review and final verification

Actual separate reviewer `/root/item_design_review` first requested precise top-level keys, explicit undefined-time and404/409 assertions. These were added before the strengthened RED. Subsequent actual source/test review APPROVED with0 P0/P1/P2 on the three hashes above; this is not reuse of the proposal review. The cleanup-observation review initially requested P1 pinned fail-closed policy / P2 preservation of `500a886d`; follow-up approved their closure, and optional remaining self-check predicates were also added. No actual review grants TC/UAT, CI or merge credit.

Actual controlled condition mutation `1b474117` inverted only the new inventory warning:537 leaves,531 PASS/6 TC-019 FAIL,0 skip/NOT_RUN, no unrelated failures, precise TTL retention validated. Its FAIL_OR_BLOCKED metadata is retained, not rewritten. Provider was then restored to the exact independently reviewed SHA above before executing all four final original commands on the same frozen source/spec baseline.

| Final native developer check | Actual result | Evidence availability |
| --- | --- | --- |
| lint | exit0 / PASS | LOCAL_ONLY retained artifact |
| client-build | exit0 / PASS | LOCAL_ONLY retained artifact |
| item-client-technical | 866/866 PASS,0 fail/skip/NOT_RUN | LOCAL_ONLY retained artifact |
| item-server-technical | 537/537 PASS including13 TC-019,0 fail/skip/NOT_RUN | LOCAL_ONLY retained artifact |

All four metadata records identify DEVELOPER/native-authorized execution, original command-contract hashes, frozen HEAD `f8ce9027` / source fingerprint above, complete leaf catalog SHA `ce31d6caae7e01eed1d1edfe1b2a64c40120375f84a9c681bf180373f52610c2`, unchanged source/spec/HEAD/helper and actual tools. Final server evidence verifies exact nonce+10/idempotency+34 with bounded new TTLs, preserved old rows, unchanged schema/identity/PID/all other table counts. No application assertion/profile/mandatory mapping/threshold was relaxed. Python3.12.14 coordinates the final process captures; source commands still use the original Node/npm/MySQL probes.

Native evidence is retained as LOCAL_ONLY artifacts, and is not added to the40 historical generic Harness-run pointers or staged for commit. All retained reports/logs are bounded, classified/redacted and re-parsed with leaf identities/status unchanged; no keyring/password/session/trace export. Local candidate creation and exact owned-runtime shutdown are separately observed in revisioned state after the corresponding actions; the candidate snapshots the exact checked/reviewed source, not a claim that CI or formal acceptance ran against a future Git commit.

## Resumed delivery closeout — 2026-10-15

Sam explicitly authorized finishing supporting evidence, document review/state reconciliation and a local candidate only, with the original publication/GR/UAT restrictions unchanged. No product/test/profile/canonical-spec bytes changed during this closeout; the four actual developer results above retain the same source/spec identity. They were rechecked from original artifacts, not rerun or converted into formal/generic gate credit.

The supporting cleanup self-check was actually executed again with Python3.12.14 and30-second/2MiB bounds: exit0, no timeout/oversize/stderr, one valid retention case plus9 rejected mutations. A LOCAL_ONLY retained artifact records exact argv/cwd/times, script/helper hashes, stdout/stderr hashes/bytes, unchanged source/spec/HEAD and explicit no-suite/no-gate credit. Output was checked against the exact synthetic expected sentence; no secret/DB/application data or environment values are captured. This closes the provenance finding without creating a fifth mandatory suite or new generic run pointer.

The private runtime was already stopped after interruption: owned `mysql.log` records actual SHUTDOWN via user signal at2026-10-15T00:51:51Z and Shutdown complete at00:51:52Z; the exact private socket/PID files are absent and the owned datadir is retained. This is a read-only observed stopped state, not a claim that the resumed agent issued shutdown or deleted data. No runtime was restarted or shared process touched. The local unmerged worktrees/branches and local-only evidence remain for recovery; candidate creation is observed separately after commit.

Actual independent follow-up by `/root/item_design_review` APPROVED the limited local-candidate step with0 P0/P1/P2, closing the preserved delivery/provenance findings (REV-055 → REV-056). The reviewer independently parsed the fresh supporting artifact SHA `b3cc553ba801c1ae4b5922a801b098afbbab32a90c4d1ecaa0c8c00cbfeef6f9`, logs/hashes/bytes, exact source/spec identity, actual final-suite results, stopped-runtime observations, current state and unchanged40 generic pointers. This grants only local delivery/source mapping; no formal TC/UAT, CI, publication or global gate credit.

## Remaining boundary

TASK-048/PHASE-010 remain IN_PROGRESS rather than full DoD/exit; TASK-043 IN_PROGRESS, DEF-107 HIGH/OPEN with no risk approval/closure evidence, authoritative GR-01/02/03 BLOCKED. Generic PLAN_READY / MERGE_READY are not passed by native checks. TC-019 formal technical acceptance, UAT-018 / other formal UAT, business/release acceptance and CI are NOT_RUN for this candidate. Historical Recovery owner waiver / TC-016 NOT_RUN remain unchanged. Later publication/CI/review/merge or raw-evidence export requires separate explicit authority and honest disposition of the existing global gate. Retain local unmerged candidate/worktrees for recovery; do not clean unrelated modules.
