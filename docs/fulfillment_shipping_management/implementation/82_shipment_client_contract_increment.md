# TASK031 — Shipment client wire component

Status: limited client component verified and saved in locala3369bfb; polling, pages, public Confirm HTTP and full TASK031 remain incomplete. Actual Sam proposal75 B admits one deterministic CLIENT-CONTRACT scenario, not an arbitrary new test family. No push/CI or nonfunctional execution occurred.

`client/src/services/shipment.js` provides strict document/event paths, scalar Shipment filters/child pages, shipping lookups, Draft create/update/cancel, Confirm, original-event lookup and document calls. Weight remains an exact decimal string; no floating-point conversion or rounding. Commands retain the original event and separate transport identity, with no automatic POST retry. Pending status URLs must equal the fixed same-event endpoint; only safe event/correlation/status URL references are extracted.

Durable Draft outcomes are action-specific and have their exact original version. Current Shipment projections may legitimately be newer. Confirm200 requires a confirmed or later reversed Shipment projection with sufficient version and valid original movement identities. Operation SUCCEEDED requires a valid durable identity/status/version; missing/foreign/contradictory responses become safe dependency errors, preserving original-event recovery. No owner eligibility, stock budget or write authority is calculated by the client.

## Actual developer evidence and independent review

- `client-contract-3dbe550818ea/result.json`: original expected1FAIL/0SKIP/no timeout, the sole assertion found no Shipment client module. Retain original test/source/HEAD identities.
- `client-contract-a21e8292fe39/result.json`: earlier1PASS on its own source/test version. Independent review then found three response-guard gaps; this result is not relabeled as current validation.
- `client-contract-af03b63b7a75/result.json`: repaired1PASS/0FAIL/0SKIP/exit0/no timeout, same approved one pure scenario and zero live writes. Added finite malformed mocks reject unconfirmed Confirm200, missing terminal status/version, and wrong action outcome. Valid mock Draft ownership/versions were corrected; no assertion was removed.
- Independent component source/actual closure: private `independent-p2-client-contract-component-source-actual-results-closure-review.json` SHA1ec5b2a7e5e8dd55d31e4fa3cd7282b7f2f16ac0ab3f8f5c66593440201e4840,0C/H/M. Raw results keep original precommit966d553a and their own fingerprints; locala3369bfb is an exact two-file byte bridge, not a rerun.
- Actual developer `npm run build --workspace client` exited0. The existing large-bundle warning remains; no threshold was changed or performance benchmark executed. This tool observation is not a fabricated harness run report.

The exact1 case is in `client/test/services/shipmentService.test.js`. Routine CI admission still requires the final indexed Git blobs and trusted administrator digest; no self-approved receipt or bypass workflow was used. Real Playwright remains mandatory after the planned UI integration; no browser/UI PASS is claimed from this pure component.
