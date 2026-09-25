import assert from "node:assert/strict";
import test from "node:test";
import { compilerCallableSignature, withCallableGenericProjections } from "../../../../dist/providers/native/projection/callable-generics.js";
import { sourceTypeFor, targetTypeFor } from "../../../../dist/providers/native/projection/types.js";

const identity = itemId => ({ itemId, canonicalPath: ["example", itemId] });
const scalar = { kind: "primitive", name: "u64" };
const parameter = { kind: "type", identity: identity("callback"), name: "Renamed", outlives: [], maybeSized: false,
  requirements: [{ kind: "trait", trait: { identity: { itemId: "core::function::FnMut", canonicalPath: ["core", "ops", "function", "FnMut"] },
    path: "core::ops::function::FnMut", genericArguments: [{ kind: "type", type: { kind: "tuple", elements: [scalar] } }],
    associatedConstraints: [{ kind: "equality", identity: identity("Output"), name: "Output", genericArguments: [], type: scalar }] } }] };

test("compiler callable bounds project checked functions and native closures without name-based ownership exemptions", () => {
  let sequence = 0;
  const context = withCallableGenericProjections({ genericParameters: [parameter] }, {
    allocateFunctionTypeIdentity: () => `signature:${sequence++}`,
    genericNames: new Map([[parameter.identity.itemId, { nativeName: "Renamed", sourceName: "Renamed" }]]),
  });
  const generic = { kind: "generic", identity: parameter.identity, name: parameter.name };
  const first = sourceTypeFor(generic, context, "parameter");
  const second = sourceTypeFor(generic, context, "result");
  assert.equal(first.kind, "function");
  assert.equal(second.kind, "function");
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.parameters[0].type, { kind: "source-primitive", name: "uint64" });
  assert.equal(targetTypeFor(generic, context, "parameter").kind, "closure");
  assert.deepEqual(compilerCallableSignature(parameter.requirements[0].trait), { callTrait: "FnMut", parameters: [scalar], result: scalar });
  assert.equal(targetTypeFor(generic, context, "parameter").callTrait, "FnMut");
  const sameSpelling = structuredClone(parameter);
  sameSpelling.requirements[0].trait.identity.canonicalPath[0] = "third_party";
  assert.equal(compilerCallableSignature(sameSpelling.requirements[0].trait), undefined);
  assert.equal(withCallableGenericProjections({ genericParameters: [sameSpelling] }, {}).callableGenerics, undefined);
  const additional = { ...parameter, requirements: [...parameter.requirements, "copy"] };
  assert.equal(withCallableGenericProjections({ genericParameters: [additional] }, {}).callableGenerics, undefined);
});

test("callable associated output projects a conditional result without imposing an unproved bound on its owner", () => {
  const context = {
    allocateFunctionTypeIdentity: () => "output-signature",
    genericNames: new Map([[parameter.identity.itemId, { nativeName: "Renamed", sourceName: "Renamed" }]]),
  };
  const output = sourceTypeFor({ kind: "associated-type", name: "Output", genericArguments: [],
    owner: { kind: "generic", identity: parameter.identity, name: parameter.name },
    trait: { ...parameter.requirements[0].trait, associatedConstraints: [] } }, context, "result");
  assert.equal(output.name, "ReturnType");
  const selection = output.typeArguments[0];
  assert.equal(selection.name, "Extract");
  assert.deepEqual(selection.typeArguments[0], { kind: "type-parameter", name: "Renamed" });
  assert.deepEqual(selection.typeArguments[1].parameters[0].type, { kind: "array", elementType: { kind: "never" } });
});
