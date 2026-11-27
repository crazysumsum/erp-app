const labels = { AVAILABLE: "可用", QUARANTINED: "隔離", DAMAGED: "損壞" };

export function stockStatusLabel(status) {
  return Object.hasOwn(labels, status) ? labels[status] : status;
}
