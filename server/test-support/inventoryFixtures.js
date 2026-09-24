const COMMAND = Object.freeze({
  actor: {
    userId: 7,
    serviceName: "",
    claimedRoles: ["warehouse-operator"],
    claimedPermissions: ["receiving.operation"]
  },
  authorization: {
    purpose: "receipt.post",
    requiredCallerPermission: "receiving.operation"
  },
  source: {
    module: "RECEIVING",
    documentType: "PURCHASE_RECEIPT",
    documentId: "receipt-42",
    lineId: "",
    eventId: "posted-1"
  },
  correlationId: "correlation-1",
  payload: { skuId: 12, quantity: 3 }
});

export function inventoryCommandFixture(overrides = {}) {
  const fixture = structuredClone(COMMAND);
  return {
    ...fixture,
    ...structuredClone(overrides),
    actor: { ...fixture.actor, ...structuredClone(overrides.actor ?? {}) },
    authorization: { ...fixture.authorization, ...structuredClone(overrides.authorization ?? {}) },
    source: { ...fixture.source, ...structuredClone(overrides.source ?? {}) }
  };
}
