export const BUSINESS_STATUS_LABEL = Object.freeze({ ACTIVE: "啟用", INACTIVE: "已停用" });
export const BUSINESS_STATUS_COLOUR = Object.freeze({ ACTIVE: "positive", INACTIVE: "grey-7" });
export const REQUIRED_CONSUMER_CHECKER_IDS = Object.freeze([
  "customer",
  "supplier",
  "sales",
  "purchasing",
  "ar",
  "ap"
]);

export const PAYMENT_RULE_LABEL = Object.freeze({
  IMMEDIATE: "即時到期",
  NET_DAYS: "淨日數",
  END_OF_MONTH: "月底到期",
  MANUAL: "手動指定"
});

export function paymentRuleSummary(calculationType, dueDays) {
  return calculationType === "NET_DAYS"
    ? `淨 ${dueDays} 日`
    : (PAYMENT_RULE_LABEL[calculationType] ?? calculationType);
}

export function previewDueDate(baseDate, calculationType, dueDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate ?? "")) {
    return null;
  }

  const [year, month, day] = baseDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  if (calculationType === "MANUAL") {
    return { dueDate: null, requiresManualDueDate: true };
  }
  if (calculationType === "END_OF_MONTH") {
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
  } else if (
    calculationType === "NET_DAYS"
    && Number.isInteger(dueDays)
    && dueDays >= 0
    && dueDays <= 3650
  ) {
    date.setUTCDate(date.getUTCDate() + dueDays);
  } else if (calculationType !== "IMMEDIATE") {
    return null;
  }

  if (date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999) {
    return null;
  }

  return { dueDate: date.toISOString().slice(0, 10), requiresManualDueDate: false };
}
