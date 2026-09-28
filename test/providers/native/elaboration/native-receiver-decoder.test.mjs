import assert from "node:assert/strict";
import test from "node:test";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/limits.js";
import { nativeDefinition, nativeEvidenceFixture, nativeIdentity } from "./native-evidence-fixture.mjs";

function fixture(receiver) {
  const evidence = nativeEvidenceFixture();
  evidence.definitions.push(nativeDefinition(1, "trait"), {
    ...nativeDefinition(2, "associated-function"), parent: nativeIdentity(1), receiver, type: 1,
  });
  evidence.items.push(nativeIdentity(1), nativeIdentity(2));
  evidence.scopes.push({ kind: "named", owner: nativeIdentity(1), bindings: [], ambiguities: [] });
  evidence.types.push({ id: 0, value: { kind: "primitive", name: "u32" } }, {
    id: 1, value: { kind: "function", definition: nativeIdentity(2), arguments: [], signature: {
      variables: [], value: { inputs: [0], output: 0, variadic: false, unsafeCall: false, abi: "Rust" },
    } },
  });
  return evidence;
}

test("receiver evidence remains independent of a native function's input types", () => {
  for (const receiver of [true, false]) {
    const input = fixture(receiver);
    const decoded = decodeNativeEvidence(input, defaultRustNativeSourceLimits);
    assert.equal(decoded.definitions[2].receiver, receiver);
    assert.deepEqual(decoded.types, input.types);
    input.definitions[2].receiver = !receiver;
    assert.equal(decoded.definitions[2].receiver, receiver);
    assert.ok(Object.isFrozen(decoded.definitions[2]));
  }
  const empty = fixture(false);
  empty.types[1].value.signature.value.inputs = [];
  assert.equal(decodeNativeEvidence(empty, defaultRustNativeSourceLimits).definitions[2].receiver, false);
});

test("receiver decoding rejects missing, misplaced and untyped metadata", () => {
  for (const mutate of [
    value => { delete value.definitions[2].receiver; },
    value => { value.definitions[2].receiver = null; },
    value => { value.definitions[2].receiver = "true"; },
    value => { value.definitions[2].receiver = 1; },
    value => { value.definitions[0].receiver = false; },
    value => { value.definitions[1].receiver = true; },
    value => { value.definitions[2].type = null; },
    value => { value.definitions[2].type = 0; },
    value => { value.types[1].value.signature.value.inputs = []; },
    value => { value.definitions[2].kind = "function"; },
    value => {
      value.definitions.push(nativeDefinition(3, "function"));
      value.items.push(nativeIdentity(3));
      value.types[1].value.definition = nativeIdentity(3);
    },
  ]) {
    const evidence = fixture(true);
    mutate(evidence);
    assert.throws(() => decodeNativeEvidence(evidence, defaultRustNativeSourceLimits), /Native Rust/u);
  }
});
