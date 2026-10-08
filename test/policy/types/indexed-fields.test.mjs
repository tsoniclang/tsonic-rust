import assert from "node:assert/strict";
import test from "node:test";
import { resolveRustIndexedProperty } from "../../../dist/policy/types/resolution/indexed-fields.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";

function fixture() {
  const symbol = {};
  const rootSymbol = {};
  const ownerType = {};
  const result = { kind: "source-primitive", name: "int64" };
  const owner = rustStructuralObjectTargetType("/owner.ts", [{ sourceName: "value", type: result,
    presence: "required", readonly: true }], "value");
  const property = { name: "value", symbol, rootSymbols: [rootSymbol] };
  const registrations = [];
  const context = { currentSemantics: { types: { propertyInfos: selected => {
    assert.equal(selected === ownerType, true, "the exact selected owner is queried");
    return [property];
  } } } };
  const options = { sourceTypes: {
    structuralFieldProjectionForSymbol(selected, selectedOwner) {
      assert.equal(selected === symbol, true, "registration retains the selected property symbol");
      assert.equal(selectedOwner === owner, true, "registration retains the selected carrier");
      return { shape: { storage: "structural-value" },
        field: { resultCarrier: result, storageIndex: 0, readonly: true } };
    },
    typeFamilies: {
      register: () => true,
      registerFieldKey: (identity, name) => { registrations.push({ identity, name }); return true; },
      registerImplementation: selected => { registrations.push(selected); return true; },
    },
  } };
  return { symbol, rootSymbol, ownerType, result, owner, property, registrations, context, options };
}

test("indexed properties consume exact symbols, root symbols and canonical named demands", () => {
  for (const mode of ["symbol", "root", "name"]) {
    const input = fixture();
    const key = mode === "symbol" ? input.symbol : mode === "root" ? input.rootSymbol : "value";
    const selected = resolveRustIndexedProperty(input.ownerType, key, input.context, input.options, input.owner);
    assert.equal(selected?.result === input.result, true, "the exact native result carrier is retained");
    assert.equal(selected?.projection.kind, "associated-type");
    assert.equal(input.registrations.length, 2);
    assert.equal(input.registrations[0].name, "value");
    const implementation = input.registrations[1];
    assert.equal(implementation.owner === input.owner, true);
    assert.equal(implementation.output === input.result, true);
    assert.equal(implementation.sourceFileName, "/owner.ts");
    assert.equal(implementation.field.storageIndex, 0);
    assert.equal(implementation.field.readonly, true);
    assert.equal(implementation.field.sharedWrite, false);
  }
});

test("indexed property selection rejects foreign and ambiguous identity without name fallback", () => {
  for (const mode of ["foreign", "missing", "duplicate-symbol", "duplicate-root", "duplicate-name"]) {
    const input = fixture();
    let key = input.symbol;
    if (mode === "foreign") key = { name: "value" };
    if (mode === "missing") key = "missing";
    if (mode.startsWith("duplicate")) {
      input.context.currentSemantics.types.propertyInfos = () => [input.property,
        { ...input.property, symbol: mode === "duplicate-symbol" ? input.symbol : {} }];
      key = mode === "duplicate-root" ? input.rootSymbol : mode === "duplicate-name" ? "value" : input.symbol;
    }
    assert.equal(resolveRustIndexedProperty(input.ownerType, key, input.context, input.options, input.owner),
      undefined, "missing or non-unique exact selection is rejected");
    assert.equal(input.registrations.length, 0, "rejected selection publishes no native implementation");
  }
});
