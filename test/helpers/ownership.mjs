export function createRustOwnershipFixture(node, carrier, kind = "move") {
  const value = Object.freeze(kind === "borrow" ? { kind, mutable: false } : { kind });
  return Object.freeze({ reads: new Map([[node, Object.freeze({ carrier, operandCarrier: carrier, formation: value,
    value, source: value, nativeResults: Object.freeze([]),
    snapshot: value, stablePlace: false, readsStorage: false, pure: false, sharedReference: false,
    flowResultBorrow: false, flowConversionInputBorrow: false, borrowedAcross: new Set(),
  })]]), captures: new Map(), writes: new Map() });
}
