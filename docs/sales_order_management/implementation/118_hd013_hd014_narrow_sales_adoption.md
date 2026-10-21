# HD013 / HD014 narrow Sales adoption

Status: approved policy delta adopted as partial IMPLEMENT work; narrow separate engineering review completed with zero required source findings. Full P0/P4 integration, real current P4 browser execution, CI and main merge remain pending. No new human decision is requested.

## Human authority and retained baselines

Sam directly approved in Sales userMessage `01a15d33-7ecb-7832-9e7b-a1cf622c1e36`: 「批准有 Fulfillment 歷史時僅禁止撤回並回傳明確 409，取消及關閉剩餘數量的規則不變。請繼續推進，所有 Gate 通過後直接合併到 main。」 Actual userMessage was read with the thread tool; private receipt0fd47c25 retains its exact text. The authorized Fulfillment owner separately reports actual HD013 A (`call_976a3633d1fc4df490e97514ce246b7d`, only three lifecycle RC) and HD012 A (`call_f7591bbe190142aa8b222fa48a8d9c99`, readiness-only NOWAIT exception), with preserved canonical adoption in owner reports19/18. The separate Sales reviewer checks original human provenance as part of narrow closure.

Earlier Sales DESIGN07325c78… / PLAN6370daf2… and every old approval, failure and test remain historical. New derived DESIGN `2c00e6c2dd7699e51d73f66af480b7b6a9c1a424e648ea375855f182ff948682`, PLAN `070531ee21f510969c679c281a6705eb3e0094cbb9b01a68cfe3164679e187b5` bind only the actual approved policy/isolation delta, minimal canonical/source/test/UI consumer change and provided-contract pin. This does not claim Sam inspected these composite hashes, renew unrelated UAT_NA, adopt a Customer waiver or qualify an old CI result for new source.

## Exact adoption

Owner eight-file patch a45058b3… at before9174f39b and whole Task01131-file subsetb7623070… were hash-checked against actual files. The owner reports actual separate reviewer /root/fulfillment_independent_review r2 APPROVED0C/H/M; full P0 Gate remains incomplete. Sales applied only minimal hunks: legacy/canonical FR062/064 and SAD008/Design7.6; lifecycle-only RC; bounded WITHDRAW history reason with locally created error identity; safe dedicated409; explicit test request contexts; and necessary clear409 UI intent completion/display. No Inventory/DB/Fulfillment source, DI, owner migrations, whole owner design or raw evidence was copied.

The P4-adapted eight-file patchbc97f6a4… preserves the complete P4 design and Export422; error catalogue becomes42, not owner41. The three UI hunks5a802ea2… retain the P4 detail page's other behavior. Only lifecycle WITHDRAW plus exact409/historycode becomes a completed REJECTED local intent, clears pending storage and displays the public Chinese guidance. Other uncertain failures retain original query/replay behavior. Terminal Fulfillment history is not falsely marked OPEN; malformed/wrong-purpose reasons, UNKNOWN and provider-thrown code lookalikes remain503. Completed durable replay precedes a new mutable history check. No history/FK deletion or confirmation generations are introduced.

## Observed checks and limitations

Actual current P4 focused backend8 PASS/0FAIL/0SKIP (private log98eca398…), client17 PASS (f86dacb0…), client build PASS (adea4958…, existing large-chunk warning retained), scoped lint PASS. Client tests are unit mocks, not native/browser evidence. Existing complete-P0 owner native21/lifecycle fault-history24/review-closure9/concurrency4 and actual Playwright2PASS logs were read separately with hashes; overlapping cases are never summed and those owner results are not relabelled as execution on this P4 candidate.

P4 has not adopted the formal complete P0 provider/schema/main, so it cannot yet execute its own actual HTTP/browser WITHDRAW-history409 flow. This required Playwright validation remains BLOCKED/PENDING, including refresh, localized message, no unexpected console/network errors and available Cancel. No frontend Task/Phase is marked complete by unit/build/static review. Existing P0 browser proof is relevant upstream evidence only, not a substitute for integrated P4 verification.

Trace check remains BLOCKED on the same existing Customer design pin. A mode-entry boundary comparison also reports previously integrated unrelated Customer/Supplier/CI history and old scope bindings; that failed result is preserved for full-phase baseline reconciliation. A separate narrow check against actual pre-adoption HEADdf8b6ee9 passes for this contribution's paths only, never as the full boundary/merge Gate. The earlier helper import mistake was corrected using the installed tool's actual interfaces; Harness source/thresholds were not modified.

## Remaining work

Finish narrow review custody and commit this partial slice. Await full formal P0 source/schema/CI/review/main, then integrate and reconcile the fresh P4 baseline/Customer pin/withdrawn0091–0093 installers, implement real Archive participant/coordinator, and run all original P4 mandatory checks/capacity/Playwright/current CI/whole-phase review/unchanged MERGE_READY. Existing commit/PR/main merge authority remains; no production deployment, formal technical acceptance or business UAT is asserted.


## Actual narrow review and current-chat human confirmation

Separate reviewer /root/def016_runtime_recovery_review proof sales-p4-hd013-hd014-r1-adoption-reviewer-proof.json SHA256 fffe0a870f751ac9049e989f0f49bdc80310e8d77a00328f9ef0570b8165b70a verifies12frozen paths,8+3hunks,P4Export/Detail differences and derivedD/P, with zero requiredsource findings. Prior automatic review twice rejected recording cross-thread human authority, even after original tool reads; neither rejected command made mutations. Sam then directly confirmed HD012/HD013 in this Sales conversation userMessage01a15d80-22e1-7022-9d66-1e8d95f916c7: 「確認沿用 HD012 的限定 NOWAIT readiness 讀鎖，以及 HD013 僅撤回、取消、關閉剩餘數量三條交易使用 READ COMMITTED。請繼續推進，所有 Gate 通過後直接合併到 main。」. This direct human message, together with prior directHD014, is the authority for state1290 narrow derivedbindings; no bypass or new consent is fabricated. Existing allGates remain required. Current P4 UI runtime/Playwright/native/fullPhase/CI are expressly unverified.
