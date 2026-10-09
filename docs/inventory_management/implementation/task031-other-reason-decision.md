# TASK-031 — minimum OTHER explanation / HD118

## Current disposition — actual Sam A; HD118 ANSWERED

Actual latest Sam 「A」 selects A, APR157: OTHER requires >=10 non-whitespace Unicode code points after trim, with HD117's500 UTF-8-byte/safe-text ceiling. Other six categories and Status require nonempty reason without this new minimum. No whitespace padding, normalization/truncation, extra fields/workflow or automated claim that length proves truth/sufficient meaning; required business explanation and human judgment remain. Direction/proposal preparation only, not independent approval of new candidate baselines/source. [Next new-Lot FIFO date HD119](task031-fifo-date-decision.md). TASK031 IN_PROGRESS / BLOCKED; source/spec/head/160 refs unchanged, no product/test/runtime/publication changes.

## Historical discovery — before HD118 answer

Status: DECISION_REQUIRED. HD117 actual Sam A / APR156 selects500 UTF-8-byte reason ceiling with no truncation/Audit expansion. TASK031 IN_PROGRESS / BLOCKED, resume IMPLEMENTING; TASK026–030 DONE locally, TASK032–034 PENDING.

## Evidence and material gap

Design §5.4/DEC024 and TASK031 fix seven Adjustment reason categories and require text for all; OTHER must be more detailed and understandable to a human. TC007 and ADJ002/UAT expect insufficient OTHER explanation to fail closed. No minimum or objective insufficiency rule is defined. A byte ceiling alone cannot distinguish a one-character placeholder from an explanation. Actual Receipt override uses a5-code-point minimum, but that is a different accepted business purpose, not an already-approved Adjustment threshold.

A deterministic minimum is an input-quality floor, not proof that text is true or sufficiently explains the event. Required business content remains describing the discovered discrepancy and why this correction is needed; human review/UAT must assess that intent. No NLP, filler detection, content scoring, new fields/approval workflow or machine claim of semantic adequacy is proposed.

## A — recommended: OTHER >=10 non-whitespace Unicode code points

Keep existing single reasonText field, trim then require at least10 non-whitespace Unicode code points for OTHER, and keep <=500 UTF-8 bytes/safe-text guard from HD117. Other six categories and Status Transfer still require nonempty safe reason without this new minimum. Internal whitespace cannot pad the minimum; no Unicode normalization/truncation/synthesized reason. Numeric threshold and safe validation must hold at trusted domain boundary as well as new HTTP schema as applicable, before Operation effects.

Benefit: distinguishes OTHER from ordinary required text with a small, reproducible testable guard; no extra business field or central Audit change. Cost: a concise legitimate explanation shorter than10 fails and must be elaborated, while10 repeated characters could still pass the length floor; human sufficiency/accuracy judgment is not automated. Both language-neutral counting and byte ceiling are explicit in the candidate; future UI follows them, no UI work now.

## B — OTHER >=5 non-whitespace Unicode code points

Same single field,500-byte/safe-text/no-padding rules and no extra workflow, but OTHER minimum5 instead of10. This uses the existing Receipt override's numeric scale as a reference, not its auth/exception contract or an already-approved reusable validation policy. Benefit: less burden for meaningful short Chinese reasons. Cost: a shorter floor admits more terse/ambiguous descriptions; TC/UAT insufficiency boundaries must explicitly reflect the selected floor, and semantic sufficiency still needs human judgment. Other categories/Status remain nonempty in either option.

## Decision / next safe action

Recommend A as the clearer OTHER-specific input-quality floor. Until actual Sam choice, Harness major-impact gate holds affected canonical/source writes rather than inventing a test expectation. API skill made the exact counting/whitespace semantics explicit without adding a speculative reason subsystem. After choice prepare remaining consequential FIFO-date/precise-contract details and exact candidate independent Sam baseline/scope review; no acceptance/test intent waiver or automatic proof of reason meaning.

HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source `fe3130fef55c9ec8cc71b2edf872a8a2076b5332581749ee281b211de38f2bc2`, DESIGN `46841dae185fab06e626fca722d1576726702a3d7183fdbb2f23e3459de7f663`, PLAN `8ab85d87051f437b74c6cfb4efc39ba93c8c2dd9e56ca7ea210d7bc5bc705dc8`, original0064 and all160 native refs/failures unchanged. No TASK031 tests executed; only reports/state updated, no canonical/product/test/shared-auth/UI changes, runtime/DB/DDL/permission/dependency, staging/commit/push/PR/remoteCI/merge/main adoption, TASK032+ or formal/release/capacity/floor waiver.
