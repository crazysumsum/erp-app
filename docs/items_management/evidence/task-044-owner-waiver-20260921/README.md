# TASK-044 Product Owner signer-independence waiver

- ERP Product Owner (Sam) explicitly authorized the executing agent to generate and use the temporary Ed25519 attestation key on 2026-09-21, accepting that this waives the original independent-signer control.
- The temporary private key is stored only in `/private/tmp/item-recovery-tc016-20260921/owner-waiver-private.pem` with mode 0600 and is not a repository artifact.
- Manifest SHA-256: `4bdf46c63c98b2183c29f2e81ab8a5b2e3360949ee423efc8182d6e529dc606e`.
- This evidence proves manifest integrity and recovery reconciliation only. It must be reported as `PASS_WITH_OWNER_WAIVER`, not as unqualified satisfaction of the original independent-attestation requirement.
