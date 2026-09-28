import assert from "node:assert/strict";
import test from "node:test";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { defaultRustNativeSourceLimits as limits } from "../../../../dist/providers/native/elaboration/limits.js";
import { nativeDefinition, nativeEvidenceFixture, nativeIdentity } from "./native-evidence-fixture.mjs";

const parameter = (owner, index) => ({ definition: nativeIdentity(owner), index, name: "",
  pureWrtDrop: false, value: { kind: "type", synthetic: false, default: null } });
const generics = parameters => ({ parent: null, parentCount: 0, hasSelf: false,
  parameters, predicatesParent: null, predicates: [] });

function evidence(kind = "closure") {
  const input = nativeEvidenceFixture();
  const parent = nativeDefinition(1, "function");
  parent.generics = generics([parameter(2, 0)]);
  const declaration = nativeDefinition(2, "type-parameter");
  declaration.parent = parent.id;
  const owner = nativeDefinition(3, kind);
  owner.parent = parent.id;
  owner.generics = { ...generics([parameter(3, 1), parameter(3, 2), parameter(3, 3)]),
    parent: parent.id, parentCount: 1 };
  input.definitions.push(parent, declaration, owner);
  input.items.push(parent.id);
  return input;
}

test("native implicit parameters retain repeated owner IDs with distinct inherited indices", () => {
  const input = evidence();
  const decoded = decodeNativeEvidence(input, limits);
  assert.deepEqual(decoded.definitions[3].generics, input.definitions[3].generics);
  assert.ok(Object.isFrozen(decoded.definitions[3].generics.parameters));
  const inline = evidence("inline-constant");
  inline.definitions[3].generics.parameters.length = 1;
  assert.deepEqual(decodeNativeEvidence(inline, limits).definitions[3].generics, inline.definitions[3].generics);
});

test("native generic identities reject duplicate indices, duplicate declarations and owner substitutions", () => {
  for (const mutate of [
    input => { input.definitions[3].generics.parameters[1].index = 1; },
    input => { input.definitions[3].generics.parameters[1].index = 4; },
    input => { input.definitions[3].generics.parentCount = 0; },
    input => { input.definitions[3].generics.parent = nativeIdentity(3); },
    input => { input.definitions[3].generics.parameters[1].definition = nativeIdentity(1); },
    input => { input.definitions[3].generics.parameters[1].definition = nativeIdentity(99); },
    input => { input.definitions[3].generics.parameters[1].value = { kind: "lifetime" }; },
    input => { input.definitions[3].generics.parameters[1].value.synthetic = true; },
    input => { input.definitions[3].generics.parameters[1].pureWrtDrop = true; },
    input => { input.definitions[1].generics.parameters.push(parameter(2, 1)); },
    input => { input.definitions[1].generics.parameters[0].definition = nativeIdentity(1); },
    input => { input.definitions[2].kind = "const-parameter"; },
    input => { input.definitions[3].generics.hasSelf = true; },
  ]) {
    const input = evidence();
    mutate(input);
    assert.throws(() => decodeNativeEvidence(input, limits), /Native Rust/u);
  }
});

test("native trait Self has exact owner identity and propagates through inherited generics", () => {
  for (const kind of ["trait", "trait-alias"]) {
    const input = evidence();
    input.definitions[1].kind = kind;
    input.definitions[1].generics = { ...generics([parameter(1, 0), parameter(2, 1)]), hasSelf: true };
    input.definitions[3].generics = { ...generics([parameter(3, 2), parameter(3, 3), parameter(3, 4)]),
      hasSelf: true, parent: nativeIdentity(1), parentCount: 2 };
    if (kind === "trait") input.scopes.push({ kind: "named", owner: nativeIdentity(1), bindings: [], ambiguities: [] });
    assert.equal(decodeNativeEvidence(input, limits).definitions[3].generics.hasSelf, true);
    for (const mutate of [
      value => { value.definitions[1].generics.hasSelf = false; },
      value => { value.definitions[3].generics.hasSelf = false; },
      value => { value.definitions[1].generics.parameters[0].definition = nativeIdentity(2); },
      value => { value.definitions[1].generics.parameters[1].definition = nativeIdentity(1); },
      value => { value.definitions[1].generics.parameters[0].value = { kind: "lifetime" }; },
    ]) {
      const invalid = structuredClone(input);
      mutate(invalid);
      assert.throws(() => decodeNativeEvidence(invalid, limits), /Native Rust/u);
    }
  }
});
