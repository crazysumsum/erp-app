# HD-025 — Shipment optional weight input contract (proposal)

Status: APPROVED A. Actual Sam reply:「A：精確字串，KG／G（建議）」。Proposal SHA at approval a62d1914aff95eaa5f15a7c0ecf79acc1965550993e723a2846b28f13bb59949; independent proposal review0 C/H/M. No test/gate waiver.

## Observed gap

Approved design §4.8 specifies nullable DECIMAL(20,6) total_weight and VARCHAR(20) ASCII weight_uom selected from a server allowlist, but does not enumerate units or specify the non-null JSON weight representation. §5.3 only demonstrates null. Existing fulfillmentOperationHash rejects non-integer Number payload values. Therefore accepting decimal JSON numbers by assumption could fail valid Draft intents or require a broader hash contract change. Do not silently choose physical units or round weight.

## Recommended A

Weight remains optional. Non-null totalWeight is a positive decimal string with at most14 integer and6 fractional digits, within DECIMAL(20,6), no exponent/sign/leading zeroes; permit the zero integer part for fractional weights. Reject zero, overprecision and overflow without rounding/coercion. Normalize insignificant trailing fractional zeroes before hashing/storage comparison. The exact string max is 99999999999999.999999, and min is0.000001.

Use a fixed case-sensitive allowlist KG and G; no automatic unit conversion. totalWeight=null requires weightUom=""; non-null requires an allowed unit. Preserve identity/version/ownership/permissions, immutable SHIPPING fields, the original operation hash machinery, exact replay, all safety/capacity/20s and full P2 gate. Existing null input remains valid. UI uses decimal text input and explicit unit selection; JSON numbers are rejected before operation claim. Confirm hash includes the canonical saved weight/unit.

## Alternative B

Use the same decimal-string and safety rules but allow KG, G, LB and OZ. This supports imperial logistics without a second contract change, with a larger unit list and UI/test matrix. Neither option converts values or touches Inventory/Sales base quantities. User may specify another set rather than either list.

## Verification required

Strict command/API and client parity; null pairing;0/min/max,7 fraction/15 integer digits, unsafe Numbers, exponent/sign/leading-zero/whitespace, negative and unknown units; canonical same-event replay versus changed unit/value; DB exact decimal roundtrip; SHIPPING immutable fields; safe audit (no address/payload); actual Draft/Confirm/print UI including native browser checks. No weight option changes any acceptance limit or exempts tests.

## Authority

This is a previously unspecified public input/business-unit choice. Actual Sam decision required by software-engineering-harness SKILL.md major impact rule; existing P2 implementation authority does not authenticate an unchosen unit list. Await approval only on this affected contract; independent P2 recovery/verification planning may continue.
