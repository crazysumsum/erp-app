# TASK-044 local recovery provisioning evidence

- Provisioned under ERP Product Owner (Sam)'s explicit local MySQL root authorization on 2026-09-15.
- Source fixture schema: `item_recovery_tc016_20260915`.
- Restored verification schema: `item_recovery_tc016_20260915_run1`.
- Restored roots: `/private/tmp/item-recovery-restored-20260915/media` and `/private/tmp/item-recovery-restored-20260915/imports`.
- All 40 source/target tables and the exact counts for the 16 Item tables matched after restore.
- The restored SKU/audit smoke records and database-linked media/import byte counts and SHA-256 values matched.
- `erp_user` successfully read the restored schema under a schema-scoped `SELECT` grant. `erp_dev` Item, SKU, media and import counts remained unchanged at zero.
- Exact manifest SHA-256: `3badb73c88fae7aefdc40baeb404616e32c4b75cc89837df9b6d3951b50314df`.

This is provisioning and developer preflight evidence, not formal `TC-016` acceptance. The manifest is deliberately unsigned, `server/config/itemRecoveryTrustPolicy.json` remains `UNPROVISIONED`, and an independent operator must sign these exact manifest bytes before the Product Owner approves the public trust key/environment binding and `TEST_AND_VERIFY` executes the adapter.
