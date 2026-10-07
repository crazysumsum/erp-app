# TASK-031 bounded confirmation flow — developer slice

Actual source b2d939c09e189623a092c8820441f8d8ddd5c93a8a68c68a8286df87e9b23bf0, HEAD949c87edcb948763906632227ef854fdf63d5333; adopted DEC-021 D/P unchanged.

Confirmation waits its configured bound, returns terminal200 only for an observed result, and otherwise202 with original event/actual operation ID/status URL/retry2. Phase B has an independently owned bounded DB signal and rejection is always observed after202. Real PhaseA commit uncertainty preserves an ID observed from INSERT/replay without claiming durability or blindly starting PhaseB. Current original-user operation lookup uses fresh permission guards and locking operation reads, hides other actors' events, and exposes no lease/hash/recovery payload.

Actual unit65PASS/zero skips and scopedlintPASS; actual native24PASS/zero failures/cancellations/skips at /private/tmp/sales-p2-private/task031-flow-native.log. Native probes execute COMMIT then lose acknowledgement, and actualROLLBACK then lose acknowledgement. Lookup distinguishes committed IN_PROGRESS from rolledback404; retry reuses originalevent and creates one reservation. These probes do not replace later controlled process crash/performance/full Phase gates.

Actual separate /root/sales_p1_review APPROVE TASK031-flow-R1-20261007. Four-file digest5d456027b1a4eac1baec1383eef94c65902ccd65c7cea8779c5ab05d0893e318; private exact file proof task031-flow-reviewer-source.json. A transient next-handler RED file changed global source outside reviewed scope; preserving it privately restores start source b2d939c0. Reviewed four-file bytes did not change.

Task remains IN_PROGRESS: next handlers/schemas/actualHTTP then stable frontend event/polling, build and real Playwright. No formal/UAT/CI/wholePhase/main merge completion claimed.
