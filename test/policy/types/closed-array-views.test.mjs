import assert from "node:assert/strict";
import test from "node:test";
import { selectRustClosedArrayView } from "../../../dist/policy/types/closed-array-views.js";
import { rustJsArrayValueTargetType } from "../../../dist/target-model/types/index.js";

test("broad array flow requires the exact checked source-profile declaration and element", () => {
  const declaration = {};
  const identifier = {};
  const type = {};
  const symbol = {};
  const any = {};
  const context = (name, owned = true, arguments_ = [any], typeReference = true) => ({
    ast: { is: { IsClassDeclaration: () => false, IsInterfaceDeclaration: node => node === declaration,
      IsTypeAliasDeclaration: () => false, IsEnumDeclaration: () => false, IsIdentifier: node => node === identifier },
      name: () => identifier, text: () => name },
    currentSemantics: {
      declarations: { typeSymbol: () => symbol, symbolDeclarations: () => [declaration] },
      types: { isTypeReference: () => typeReference, typeArguments: () => arguments_,
        isAny: selected => selected === any, isUnknown: () => false },
    },
    owned,
  });
  const options = context_ => ({ jsEnabled: true,
    sourceProfiles: { profileForNode: () => context_.owned ? {} : undefined } });
  for (const name of ["Array", "ReadonlyArray"]) {
    const exact = context(name);
    const carrier = selectRustClosedArrayView(type, exact, options(exact));
    assert.deepEqual(carrier, rustJsArrayValueTargetType());
    assert.equal(carrier.genericArguments, undefined);
    for (const invalid of [context(name, false), context(name, true, []), context(name, true, [undefined]),
      context(name, true, [{}]), context(name, true, [any, any]), context(name, true, [any], false), context("UserArray")]) {
      assert.equal(selectRustClosedArrayView(type, invalid, options(invalid)), undefined);
    }
    assert.equal(selectRustClosedArrayView(type, exact, { ...options(exact), jsEnabled: false }), undefined);
  }
});
