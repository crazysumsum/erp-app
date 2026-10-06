# TASK-023 — Manual Draft sales order service and commands

Status: implemented; independent functional review approved; final whole-workspace/Phase gates remain pending.

Manual create and Draft edit use fresh view+management authorization, domain event claim/replay, exact decimal validation, current provider snapshots, immutable provenance and CAS. Sequence, header/lines, history and required audit commit atomically; Draft writes do not reserve Inventory. prepareSalesDocument reuses the established Quotation preparation at its second real caller. The four P1 Order handlers retain the approved sales-orders URL directory and strict named safe contracts.

Actual primary developer evidence:42 unit PASS; quotation/manual/expiry native26 PASS, zero skip. Separate reviewer42 unit/lint PASS and native22 PASS plus actual converted-Draft frozen-conversion/provenance and required-audit rollback probes2 PASS. Later full native quotation/manual/expiry/read run30 PASS, zero failures/skips. Logs remain private. Review provenance REV-TASK023-R1 is retained in state at reviewed source017d5a670a413362328fd434f780154813f528cd76f374057a1aaa5e7b0329df. Full server registry failure is still outstanding under DEC018; this report does not claim Task DONE or Phase/merge readiness.
