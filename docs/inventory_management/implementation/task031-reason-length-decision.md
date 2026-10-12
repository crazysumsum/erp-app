# TASK-031 — reason length unit / HD117

## Current disposition — actual Sam A; HD117 ANSWERED

Actual latest Sam 「A」 selects A, APR156: new TASK031 Adjustment/Status reason text after trim is nonempty/safe and <=500 UTF-8 bytes, checked before business effects, never truncated. Precise candidate/future UI must expose byte units (typical Chinese166 characters); central Audit reason acceptance and other routes are not expanded. Fixed categories and OTHER detailed requirement retained, but its minimum has not yet been chosen. [Next OTHER detail threshold HD118](task031-other-reason-decision.md). Direction/proposal preparation only, not unseen baseline/source approval. TASK031 IN_PROGRESS / BLOCKED; source/spec/head/160 native refs unchanged, no product/test/runtime/publication changes.

## Historical discovery — before HD117 answer

Status: DECISION_REQUIRED. HD116 actual Sam A / APR155 selects all-positive-status unexpired/current minimumReceiptLifeDays guards with no Adjustment override. TASK031 IN_PROGRESS / BLOCKED, resume IMPLEMENTING; TASK026–030 DONE locally, TASK032–034 PENDING.

## Evidence and material mismatch

Design §6.4 says free-text reason maximum500 characters; §5.4 requires reason text for all seven fixed Adjustment categories and more detailed OTHER. Actual InventoryAuditService boundedString enforces Buffer.byteLength(reasonText,'utf8') <=500. TASK030 Bin Move also explicitly uses500 UTF-8 bytes. Migrations0057/0060 define reason_text VARCHAR(500) in utf8mb4 tables, so the existing SQL declaration is characters, not a500-byte field. No runtime/DDL executed to inspect a live database in this turn.

A new TASK031 request accepting500 Chinese characters could pass a character-count boundary but exceed the current Audit limit, causing transaction rollback instead of the intended input behavior. Silently truncating would alter the reason/idempotent intent/Audit and is not an option. Standard Chinese BMP characters typically use3 UTF-8 bytes;500 bytes fits166 of those, while ASCII can fit500. Emoji/mixed text differ. Reason unit is a user-visible contract, not a hidden implementation detail.

## A — recommended minimal compatibility: TASK031 reason <=500 UTF-8 bytes

Both new Adjustment and Status Transfer reason text use the existing Audit-compatible500 UTF-8-byte ceiling after trim, with nonempty reason, fixed allowlist as applicable and existing safe-text rejection. Validate before business effects; never truncate to fit. Document this explicit endpoint limit in the precise candidate, without silently changing all other free-text policies or weakening OTHER's detailed explanation requirement. Exact OTHER minimum/detail handling remains the next focused decision.

Benefit: reuse current Inventory Audit limit and Bin Move convention; no broadening shared reason acceptance or migration. Cost: typical all-Chinese text is limited to166 characters rather than500; future TASK033 UI must explain/count the byte ceiling instead of promising500 Chinese characters. No UI work is authorized now.

## B — TASK031 reason <=500 Unicode code points

Use the stated character ceiling for the two new routes/domain commands, reject malformed/control text and >500 code points before posting. Align Inventory Audit reason acceptance so the full accepted string can be stored, with a bounded UTF-8 payload (at most2000 bytes for500 valid Unicode scalar values) and no truncation. Existing reason-bearing routes retain their approved input limits unless separately reviewed; exact Audit path change and regression scope must be in the candidate, not implicitly granted here. This is not a new schema migration: the inspected existing utf8mb4 VARCHAR(500) declarations already express the column character ceiling, but actual schema/runtime behavior must still be verified during developer checks.

Benefit: supports500 Chinese characters and follows the design wording. Cost: broadens central InventoryAuditService's reason acceptance; direct callers/old guards and Unicode-boundary compatibility require review/regression. It does not relax other Audit fields, sensitive-key/summary guards or required success-Audit atomicity.

## Decision / next safe action

Recommend A as the smallest compatible TASK031 contract; B is viable if500 Chinese-character capacity is required now. Harness major-impact gate pauses affected canonical/source writes pending actual Sam choice. API skill exposed the byte/character mismatch rather than choosing a public limit silently. Preserve seven categories, mandatory reason/OTHER detail, no truncation or acceptance waiver. Then resolve remaining consequential reason/FIFO-date details and obtain exact candidate independent Sam baseline/scope review before implementation.

HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source `fe3130fef55c9ec8cc71b2edf872a8a2076b5332581749ee281b211de38f2bc2`, DESIGN `46841dae185fab06e626fca722d1576726702a3d7183fdbb2f23e3459de7f663`, PLAN `8ab85d87051f437b74c6cfb4efc39ba93c8c2dd9e56ca7ea210d7bc5bc705dc8`, original0064 and all160 native refs/failure history unchanged. No TASK031 tests executed, old PASS is not new proof. Only reports/state updated; no canonical/product/test/shared-auth/UI writes, runtime/DB/DDL/permissions/dependencies, staging/commit/push/PR/remoteCI/merge/main adoption, TASK032+ or formal/release/capacity/floor waiver.
