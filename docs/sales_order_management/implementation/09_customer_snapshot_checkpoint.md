# TASK-009 Customer transaction snapshot

Sam 2026-10-02 adopted TASK009–011 proposal and implementation scope. CustomerLookupService now locks Customer then credit using caller transaction only, returns minimal immutable current versions/defaults/credit including absent/zero/null/on_hold, no PII. Generic purpose provider remains unchanged.

Developer RED: two new tests failed solely because method absent. GREEN: customerLookupService + customerCreditService **18 PASS / 0 FAIL / 0 SKIP**. Focused eslint PASS. New salesCustomerSnapshot.integration.test.js exercises actual Customer root serialization with competing status/credit creation/update/clear, rollback and pool-read rejection; **pending ephemeral CI, no local SQL**.

Independent reviewer Codex /root/sales_readiness_review initially CHANGES_REQUESTED: restore session lock timeout and use actual credit status normal. Both corrected, final **APPROVE** (integration reviewed SHA b7229a011f3fadf458be2f1d0729b1292f3350e8dddd3848d2c29d3a6826d384). No formal TC/UAT or full TASK009/Phase completion claimed.

Item/FK graph independent review APPROVE implementation direction: snapshots UOM SHARE → Item SHARE → SKU SHARE → mapping SHARE; writer UOM SHARE → Item SHARE → SKU UPDATE → mappings UPDATE → barcode; Draft roots before children, revalidate complete discovered IDs under current locks. Guarded writer uses existing local READ COMMITTED/nonlocking reference probes to avoid stale RR or reverse child locks. Real DB proof pending. Existing InventoryPosting first-receipt stale-profile race separately observed, outside this source slice; not waived or represented as fixed.
