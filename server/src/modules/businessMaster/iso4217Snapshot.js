/**
 * ISO 4217 active legal-tender snapshot used by Business Master.
 * Source: SIX ISO 4217 Maintenance Agency, List One XML published 2026-01-01.
 * Retrieved: 2026-09-14. Fund, testing, precious-metal and no-currency codes are excluded.
 * Updating this file requires a reviewed ISO 4217 amendment and matching boundary tests.
 */
export const ISO_4217_SNAPSHOT_DATE = "2026-09-14";
export const ISO_4217_SOURCE = "https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml";

export const ISO_4217_LEGAL_TENDER_CODES = Object.freeze(new Set([
  "AED", "AFN", "ALL", "AMD", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BHD", "BIF", "BMD", "BND", "BOB", "BRL",
  "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY",
  "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP",
  "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD",
  "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR",
  "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF",
  "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL",
  "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR",
  "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR",
  "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR",
  "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD",
  "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB",
  "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX",
  "USD", "UYU", "UZS", "VED", "VES", "VND", "VUV", "WST", "XAF", "XCD",
  "XCG", "XOF", "XPF", "YER", "ZAR", "ZMW", "ZWG"
]));
