export function createRustOwnershipFixture(node, carrier, kind = "move") {
  const value = Object.freeze(kind === "borrow" ? { kind, mutable: false } : { kind });
  return Object.freeze({ uses: new Map(), reads: new Map([[node, Object.freeze({ carrier, value, source: value,
    snapshot: value, stablePlace: false, readsStorage: false, pure: false, sharedReference: false, borrowedAcross: new Set(),
  })]]), captures: new Map(), writes: new Map() });
}
