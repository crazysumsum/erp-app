# TASK-044 Product Owner signer-independence waiver

- ERP Product Owner (Sam) explicitly authorized the executing agent to generate and use the temporary Ed25519 attestation key on 2026-09-21, accepting that this waives the original independent-signer control.
- The temporary private key was stored only in `/private/tmp/item-recovery-tc016-20260921/owner-waiver-private.pem` with mode 0600, was never a repository artifact, and was deleted immediately after verification.
- Manifest SHA-256: `4bdf46c63c98b2183c29f2e81ab8a5b2e3360949ee423efc8182d6e529dc606e`.
- This evidence proves manifest integrity and recovery reconciliation only. It must be reported as `PASS_WITH_OWNER_WAIVER`, not as unqualified satisfaction of the original independent-attestation requirement.
- `APR-025` records ERP Product Owner (Sam)'s explicit approval of this waiver. The repository trust policy binds the waiver, environment, schema prefix and public key.
- The real MySQL verification passed 23/23 checks with RTO 176 ms and RPO 66,000 ms. `tc016-owner-waiver-report.json` deliberately retains harness status `NOT_RUN`, preventing the waived control from being promoted to ordinary `PASS`.
