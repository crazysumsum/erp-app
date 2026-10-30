# HD023 — Explicit historical evidence-loss disposition

Status: PROPOSED / awaiting actual human decision. No repair has been applied. This is a module-state integrity recovery, not a product scope, test/CI, timeout or safety waiver.

The above is the historical proposal status. Actual adoption and post-repair verification are recorded below; the reviewed three-file package remains byte-identical.

## Observed problem and exact reviewed package

The inherited `evidence_files` has64 pointers:20 existing narrative Markdown reports and44 genuine historical20261022 `run.json` paths whose original files are unavailable in the recovered worktree. The bounded independent backup search recovered0/44 from the known old runtime, persistent source backups, repository history and current task attachments; it does not prove no external backup exists. Neither summaries nor old directory names can recreate authentic typed runs or their missing hashes/results. The unmodified gate parses every active pointer as typed evidence; the normal checkpoint correctly refuses dropping earlier references. Adding new runs alone cannot fix these invalid inherited pointers.

The exact package lives at `implementation/recovery/hd023/`:

- `original-state.json`: full exact revision185 bytes, SHA8ad92e2987bf1573f27a1e6cded01ba3d744157d45ca87417e4f68dd15414607.
- `exact-reference-index.json`: all64 ordered original pointers,20 actual narrative hashes and44 UNAVAILABLE_HISTORICAL_RUN classifications with unknown original hashes/results, SHA7c223ccd91b39298bdeacca2c56465be70609b61134da31e355e449cf1adf314.
- `migrate_evidence.py`: one-time, dry-run-default, exact module-only tool, SHA4a63d4af0545afe291c657a5037d07ac7361c48525ddc43f659187612d556fa6.

Actual independent final review: APPROVED FOR HUMAN DECISION ONLY,0C/H/M. Receipt `independent-hd023-final-package-review.json` SHA611aadca7158ee07f47908c340f73d9738207e625e524ae59bdceafd91f680dd; ordered three-file subset9bb3071136ce92a1daef4fcf6216394d98832d37d50fd3c1bb73c79221eaf9b7.22 private copied-fixture probes passed, including strict schema/path/symlink/lock/revision+byteSHA CAS, exact history and a newly appended synthetic failed run retained, changed narrative/recovered original/late state or tool mutation refusal, actual pre-repair full-byte archive path/hash linkage and replay refusal. Synthetic approvals/runs remain private fixtures and are never imported as actual authority/evidence. Four reviewer safeguards were corrected before this final digest; original findings/probes remain preserved.

## A — Recommended, actual human approval required

Approve acknowledging44 original historical run artifacts as unavailable/unknown and reclassifying the exact20 narrative pointers, using only the reviewed tool/index. Preserve immutable revision185 state/index, all narrative files, every original approval/review/decision/defect/action/result report and all newly appended genuine typed runs, including failures. Move only these64 pointers out of the gate-active typed array; retain every pointer in the archived provenance index, without inventing old PASS/FAIL or missing hashes.

Application requires externally authenticated actual HD023 A recorded with this index/tool digest, reconciled observed current baseline, an exclusive normal state lock and exact current revision/full-byte SHA/tool CAS. The only changed fields are revision+1, the precisely enumerated evidence_files entries and one appended LOCAL_STATE_REPAIR action. A separate exact-current pre-repair snapshot is fsynced and its full SHA/path is linked in that action. All other fields and historical collections are unchanged. Refuse available/recovered originals, changed narratives/index/tool, path escapes/symlinks, stale CAS, pre-existing lock or replay. There is no force option, schema edit or Harness/global-policy change.

Then run the unmodified state inspection/schema/trace/boundary/gate checks and perform all unchanged fresh current-source mandatory P1 suites, independent review and exact-candidate CI. Repair grants no PASS/qualification, closes no Task/defect by itself and cannot create a PR prematurely. Rollback is a separately observed higher-revision checkpoint restoring the original pointers while preserving every new run/action/history; do not overwrite an old state or decrement revision. Such restoration honestly blocks the gate again unless authentic originals are restored.

## B — Recover authentic originals before final Gate

Keep the affected final Gate blocked and restore authentic44 run records/artifacts from a trusted external backup, validating original hashes/baselines/provenance without fabrication. The20 narrative entries still require precise classification. This avoids acknowledging permanent loss but is currently unavailable from inspected sources and delays final readiness. Unaffected P1 development continues under either option.

## Authority for asking

software-engineering-harness `references/19-state-and-recovery.md`: “Preserve original approvals, failures, DEF/CR and run references”; checkpoints “cannot simply erase known history to make a gate green.” Its SKILL.md requires a human decision for “uncertain loss of authoritative content”. Existing P1/product decisions do not authorize this distinct loss disposition. Default recommendation is A if no authentic external backup exists, but elapsed time is not consent and no actual mutation may occur before the human answer.

## Actual adoption and post-repair checks — 2026-10-26

Actual Sam directly answered the asynchronous HD023 question: “A：批准精確修復並保留完整歷史（建議）”. Normal checkpoint186→187 recorded the actual answer with the full reviewed index/tool SHA and reconciled current source observations. The exact reviewed tool then performed dry-run and apply187→188 using current revision187 plus full pre-repair bytes SHAac7a010dc50fc4852490fe846804987739d1e1dac37e7fd765df5069604ae6eb. Exact original current state is durably saved as `recovery/hd023/pre-repair-ac7a010dc50fc4852490fe846804987739d1e1dac37e7fd765df5069604ae6eb.json` and linked with its SHA in the appended LOCAL_STATE_REPAIR action. The original revision185 snapshot/index and all narratives are unchanged.

Independent actual-application audit APPROVED0C/H/M: `independent-hd023-actual-application-review.json` SHAb9fbc46cd511b80d3f06ed142a79b95f1bfa01b527ae35464de04cc3fae1c8a2. Actual revision188 full-byte state SHA c83d4ea04cea5c12ee984b83f5cea6174d8710a03f4ab68803521bd30705d42c differs from exact187 only in revision, appended repair action and the indexed64 active pointers. Every other field, actual HD023 answer/new authority, every earlier approval/review/defect/failure/action/status/task/baseline is identical. There were no newly appended typed runs, so64→0 removed no fresh failure.20 narrative hashes still match;44 original run artifacts remain explicitly unavailable. No original result was reconstructed.

Unmodified official observed state inspection at188: LOCAL_CHECKS_PASS/no issues; traceability: STRUCTURE_PASS/no issues; module boundary: LOCAL_CHECKS_PASS/no issues. Unmodified MERGE_READY/PHASE002 honestly remains BLOCKED for dirty current candidate,6 required fresh runs missing, current CI/review/approval readiness,2 incomplete Tasks and runtime resources. It no longer fails by parsing narrative files or absent legacy evidence. The then-listed DEF014 is this targeted metadata issue and may be closed on the above repair/audit/regression evidence only; no Task/full-gate readiness follows. Fresh developer tests, current candidate review and CI are still required. Future backups must preserve authentic new typed run metadata/artifacts separately from private auth/runtime secrets.
