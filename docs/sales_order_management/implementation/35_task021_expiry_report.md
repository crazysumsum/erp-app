# TASK-021 — Quotation expiry job

Status: implemented and functionally verified; task completion and P1 merge remain pending DEC018 registry scope and final regression.

SalesQuotationService owns the bounded HKT expiry operation. Nonlocking candidate pages avoid range-lock deadlocks; each primary-key lock rechecks persisted status/date, applies CAS and writes required audit atomically. Aborted work rolls back before commit. The scheduled singleton delegates to the existing scheduler/cluster lease and keeps transaction work in the domain service.

Actual developer evidence: expiry8 unit PASS; native4 boundary/concurrency/audit rollback/shutdown rollback PASS, zero skip. Historical deadlock and duplicate transition failures remain in private logs. Independent functional review found no product issue; exact built-in registry test still expects the pre-job service set. Full server regression fails that one assertion. Reviewed12-line registry correction is not applied while DEC018 human answer remains pending; neither assertion removal nor skip is proposed.

Design/Plan remain the actual DEC017 approved bindings. No formal acceptance, UAT, final CI or merge result is claimed.
