import assert from "node:assert/strict";
import test from "node:test";
import { rustReferentMutationRequiresMutableBinding } from "../../../dist/policy/types/storage/referent-mutation.js";
import { rustOptionTargetType, rustSourceTypeCarrier, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustMutableJsErrorTargetType, rustSourceErrorTargetType, rustWritableSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";
import { rustJsValueTargetType, rustTsValueTargetType } from "../../../dist/target-model/types/index.js";

test("sealed Error identity storage uses immutable native receivers", () => {
  for (const carrier of [rustMutableJsErrorTargetType(), rustSourceErrorTargetType(), rustWritableSourceErrorTargetType()]) {
    assert.equal(rustReferentMutationRequiresMutableBinding([[carrier]], () => false), false);
    assert.equal(rustReferentMutationRequiresMutableBinding([[rustOptionTargetType(carrier)]], () => false), false);
  }
});

test("native value storage and mutable references retain native referent requirements", () => {
  for (const carrier of [rustStringTargetType(), rustSourceTypeCarrier("source.ts", "Error", "object"),
    { kind: "reference", mutable: true, referent: rustStringTargetType() }]) {
    assert.equal(rustReferentMutationRequiresMutableBinding([[carrier]], () => false), true);
    assert.equal(rustReferentMutationRequiresMutableBinding([[rustOptionTargetType(carrier)]], () => false), true);
  }
});

test("closed native payload backing mutates through its exact shared owner, not the outer value binding", () => {
  for (const carrier of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    assert.equal(rustReferentMutationRequiresMutableBinding([[carrier]], () => false), false);
    assert.equal(rustReferentMutationRequiresMutableBinding([[rustOptionTargetType(carrier)]], () => false), false);
    assert.equal(rustReferentMutationRequiresMutableBinding([[{
      ...carrier, genericArguments: [{ kind: "type", type: rustStringTargetType() }],
    }]], () => false), true);
  }
});

test("a native written path stops at its actual shared interior owner", () => {
  const owned = rustStringTargetType();
  const shared = rustSourceErrorTargetType();
  assert.equal(rustReferentMutationRequiresMutableBinding([[owned], [shared]], () => false), false,
    "a mutable leaf inside an interior-shared root does not require a mutable outer binding");
  assert.equal(rustReferentMutationRequiresMutableBinding([[shared], [owned]], () => false), false,
    "an interior-shared receiver terminates native mutable propagation at its actual path position");
  assert.equal(rustReferentMutationRequiresMutableBinding([[owned], [owned]], () => false), true,
    "a fully owned native value path retains its mutable-root obligation");
});
