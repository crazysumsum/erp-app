# ISO 4217 Snapshot Provenance

- Source authority: SIX ISO 4217 Maintenance Agency, List One XML
- Source publication date: 2026-01-01
- Retrieved: 2026-09-14
- Runtime artifact: `server/src/modules/businessMaster/iso4217Snapshot.js`

Business Master validates only whether an uppercase, trimmed alpha-3 code is an active legal-tender currency. The
runtime snapshot therefore stores the minimum data used by that rule: the legal-tender alpha-3 codes. Fund units,
precious-metal units, testing codes and the no-currency code are excluded. Names and minor units remain user-managed
catalog attributes and are deliberately not inferred from ISO data.

The current snapshot includes XCG and excludes the withdrawn ANG and BGN codes. Any snapshot update requires a
reviewed Maintenance Agency amendment plus boundary-test changes.
