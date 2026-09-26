import assert from "node:assert/strict";
import test from "node:test";
import { implementationSubstitutions } from "../../../../../dist/providers/native/model/normalization/implementation-bindings.js";
import { directImplementationGenericParameterPositions } from "../../../../../dist/providers/native/model/types/requirements.js";

const identity = itemId => ({ itemId, canonicalPath: ["example", itemId] });
const parameter = (itemId, name) => ({ kind: "type", identity: identity(itemId), name,
  requirements: [], outlives: [], maybeSized: false });
const reference = parameter => ({ kind: "generic", identity: parameter.identity, name: parameter.name });

test("primitive implementation ownership uses the compiler type, not the export spelling", () => {
  const owner = identity("renamed-primitive");
  const implementation = { for: { primitive: "u32" } };
  assert.deepEqual(directImplementationGenericParameterPositions({}, implementation, {}, [], owner, "u32"), new Map());
  assert.equal(directImplementationGenericParameterPositions({}, implementation, {}, [], owner, "f32"), undefined);
  assert.equal(directImplementationGenericParameterPositions({}, implementation, {}, [], owner), undefined);
  assert.equal(directImplementationGenericParameterPositions({}, implementation, {}, [parameter("wrong", "T")], owner, "u32"), undefined);
});

test("implementation generics use declaration identities and exact associated equalities", () => {
  const declared = parameter("owner:type", "OwnerName");
  const input = parameter("impl:input", "DifferentName");
  const output = parameter("impl:output", "Value");
  const trait = { identity: identity("Producer"), path: "example::Producer", genericArguments: [],
    associatedConstraints: [{ kind: "equality", identity: identity("Producer::Output"), name: "Output", genericArguments: [], type: reference(output) }] };
  input.requirements = [{ kind: "trait", trait }];
  const positions = new Map([[input.identity.itemId, 0]]);
  const bindings = implementationSubstitutions([output, input], positions, [declared]);
  assert.deepEqual(bindings.types.get(input.identity.itemId), reference(declared));
  const selected = bindings.types.get(output.identity.itemId);
  assert.equal(selected.kind, "associated-type");
  assert.deepEqual(selected.owner, reference(declared));
  assert.deepEqual(selected.trait.associatedConstraints, []);
  assert.throws(() => implementationSubstitutions([output], new Map(), []), /one exact associated/u);
  assert.throws(() => implementationSubstitutions([output, { ...input, requirements: [...input.requirements, ...input.requirements] }], positions, [declared]), /one exact associated/u);
  const cyclic = { ...input, requirements: [{ kind: "trait", trait: { ...trait,
    genericArguments: [{ kind: "type", type: reference(output) }] } }] };
  assert.throws(() => implementationSubstitutions([output, cyclic], positions, [declared]), /cyclic or depends/u);
});
