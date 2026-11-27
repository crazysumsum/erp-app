// Pass the original decimal string to Intl so large SQL DECIMAL values stay exact.
const currencies = new Set(Intl.supportedValuesOf("currency"));
const decimalPattern = /^-?\d+(?:\.(\d+))?$/u;

export function formatMoney(value, currencyCode, decimalPlaces) {
  const text = String(value ?? "");
  const match = decimalPattern.exec(text);
  if (!match) return text || "—";

  let places = decimalPlaces;
  if (places == null) {
    places = currencies.has(currencyCode)
      ? new Intl.NumberFormat("zh-HK", { style: "currency", currency: currencyCode }).resolvedOptions().minimumFractionDigits
      : (match[1]?.length ?? 0);
  }
  return new Intl.NumberFormat("zh-HK", {
    minimumFractionDigits: places, maximumFractionDigits: places
  }).format(text);
}

export function formatQuantity(value) {
  const text = String(value ?? "");
  if (!decimalPattern.test(text) || !text.includes(".")) return text || "—";
  return text.replace(/0+$/u, "").replace(/\.$/u, "");
}
