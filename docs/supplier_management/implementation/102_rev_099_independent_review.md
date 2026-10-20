# REV-099 — independent review of HD-112 A (audit content)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-hd112-audit-content` at `54ba28ad`, reviewed as `git diff 37a8bb99..HEAD -- server client docs/supplier_management`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Four Medium and one Low, plus Info items.

## What the reviewer confirmed

- **null vs empty string:** handled correctly.
- **Payment term:** the BIGINT payment term compares as a number.
- **Purposes:** a pure reorder records nothing.
- **Old detail shape:** nothing reads it any more, and there is no Supplier audit display in the client.
- **Update paths:** every general-data update of these entities goes through the changed paths, including import upserts.
- **Locking order:** unchanged.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| F-1: digesting only `notes` did not keep every valid update under 8192 bytes. Supplier and address updates with 4-byte characters at maximum length, and address updates with control characters, failed with 500. The address case was a regression from this change. | Fixed. When the changed-field detail is still over the limit, every changed text value is recorded as a digest; codes, IDs and purposes keep their values. Unit test: Supplier and address at maximum length with 4-byte and control characters stay under 8192 bytes. Over HTTP, TC-106 updates both at maximum length with 4-byte characters (address also with control characters) and gets 200. Control: removing the fallback fails the unit test and TC-106. |
| F-2: the previous purposes were read from a snapshot taken before the Supplier lock, so a change committed while the request waited was reported as its own. | Fixed with `FOR UPDATE` on both reads. The reviewer's race test is kept as a regression test in the audit acceptance file. Control: removing `FOR UPDATE` fails it. |
| F-3: the tests did not catch six mutants: before-notes stored raw, unsorted purposes, `is_primary` ignored, empty previous purposes, UTF-16 length, and a no-change update returning a non-null detail. | Fixed. A new unit test `supplierAuditChanges.test.js` covers them. TC-103 now uses non-empty purposes, checks that a reorder records nothing and that a primary change records sorted before/after, and checks the identifier change. TC-106 checks both notes digests and that neither text is stored, using a 4-byte character. Controls: every mutant now fails. M6 fails in the unit test, which pins `null` for an update that changes nothing. |
| F-4: identifier updates still wrote a fixed snapshot and never recorded a notes change, and the map overclaimed. | Fixed. Identifier updates go through the same helper (type, country, value, notes digested). The TC-103 Note now names the four entities and says that Bank updates record change flags and the masked number. |
| F-5: the digest shape differed from the recorded answer `{changed, length, sha256}`. | The code now writes `{ changed: true, length, sha256 }`. |
| Info I-1: an update that changes nothing writes its audit row with `detail: null`. | Kept, and pinned by the unit test. |
| Info I-2: address fields accept control characters; Supplier and contact fields reject them. | Not changed. This gap existed before this change. It is reported to the Product Owner as a candidate follow-up. |
| Info I-3, I-4, I-5 | I-3, the lone-surrogate edge, is covered by the F-1 fallback. I-4 needs no change, because the digest is for size, not secrecy. I-5 is resolved: the unused digest option was removed. |
