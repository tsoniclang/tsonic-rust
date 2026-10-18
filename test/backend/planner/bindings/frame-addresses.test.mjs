import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { rustPackageFallibleBoundary } from "../../../../dist/backend/planner/program/fallible-boundaries.js";
import { rustRawLocationRoot, planRustSourceLocationStorage } from "../../../../dist/backend/planner/expressions/typed-locations.js";
import { planRustProjectedObjectLocation } from "../../../../dist/backend/planner/expressions/object-field-locations.js";
import { writeRustProjectDispatchedField } from "../../../../dist/backend/planner/objects/project-objects.js";
import { createRustNativeFrameOwner } from "../../../../dist/backend/planner/bindings/frame-storage.js";
import { planRustNativeFrameStorageItems } from "../../../../dist/backend/planner/declarations/callables/frame-implementations.js";
import { rustTypeFromSelectedNativeCarrier } from "../../../../dist/backend/planner/types/render.js";
import { requireRustNativeCaptureEnvironment, requireRustNativeCaptureStorage }
  from "../../../../dist/backend/planner/expressions/binding-storage.js";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { recursiveCallbackProtocolCases } from "../../../../../tsonic/test/fixtures/recursive-callback-protocols.mjs";

import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";

test("completed native capture readers use exact context, owner and slot identities without recomputing policy", () => {
  const use = {};
  const definition = {};
  const implementation = {};
  const member = {};
  const declaration = {};
  const slots = Object.freeze([{ kind: "binding", capture: { declaration, reference: {}, storage: "value", carrier: {} } }]);
  const generic = Object.freeze({ kind: "generic", use, definition, implementation, member, slots });
  const frame = Object.freeze({ kind: "frame", use, definition, implementation, entry: {}, slots: Object.freeze([]),
    payload: Object.freeze({ kind: "none" }) });
  const suspended = Object.freeze({ kind: "suspended", use, implementation, slots });
  const bindings = [generic, suspended].map(environment => Object.freeze({ declaration,
    owner: Object.freeze({ kind: "capture", environment, slotIndex: 0 }), storage: {}, readCarrier: {} }));
  const emission = Object.freeze({ use, nativeEnvironments: Object.freeze([generic, frame, suspended]),
    nativeBindings: Object.freeze(bindings) });
  const context = { input: { program: {
    physicalEmissionContexts: { contextFor: selected => selected === use ? emission : undefined },
    get callableValues() { throw new Error("a sealed lookup cannot run a callable producer"); },
    get source() { throw new Error("a sealed lookup cannot inspect or classify source"); },
  } } };
  assert.equal(requireRustNativeCaptureEnvironment(emission,
    { kind: "generic", definition, implementation, member }, context) === generic, true,
  "the exact physical member selects its identical completed environment");
  assert.equal(requireRustNativeCaptureEnvironment(emission,
    { kind: "frame", definition, entry: frame.entry, implementation }, context) === frame, true,
  "an exact frame alternative keeps actual absence of a state payload");
  assert.equal(requireRustNativeCaptureEnvironment(emission,
    { kind: "suspended", implementation }, context) === suspended, true,
  "the original suspended implementation selects its identical owner");
  for (const [index, environment] of [generic, suspended].entries())
    assert.equal(requireRustNativeCaptureStorage(environment, 0, emission, context) === bindings[index], true,
      "identical source declarations in distinct environments never select the first unrelated slot");
  assert.throws(() => requireRustNativeCaptureEnvironment(emission,
    { kind: "generic", definition, implementation, member: {} }, context), /one completed original owner/,
  "an equal-shaped foreign member cannot replace the admitted identity");
  assert.throws(() => requireRustNativeCaptureStorage({ ...generic }, 0, emission, context), /original completed environment/,
    "an equal-shaped foreign environment cannot impersonate the sealed owner");
  assert.throws(() => requireRustNativeCaptureEnvironment({ ...emission },
    { kind: "suspended", implementation }, context), /original physical emission context/,
  "a reconstructed context is not the original admitted physical use");
});

for (const name of ["addressed-lexical-frame", "captured-class-field"]) {
  test(`${name} constructs its one actual native frame owner with exact original slots`, () => {
    const source = recursiveCallbackProtocolCases.find(current => current.name === name).source;
    const { program } = analyzeRust({ files: { "index.ts": source } });
    assert.equal(program !== undefined, true, "the original checked frame program is admitted");
    assert.equal(program.callableValues.frames.definitions.length, 1, "one actual recursive activation");
    const definition = program.callableValues.frames.definitions[0];
    assert.equal(definition.storage.kind, "standalone", "the real selected activation owns a separate frame");
    const emissionContext = program.physicalEmissionContexts.contexts.find(context => context.nativeBindings.some(row =>
      row.owner.kind === "frame" && row.owner.declaration === definition.activation.ownerDeclaration));
    assert.equal(emissionContext !== undefined, true, "the original native holder is completed before rendering");
    const native = emissionContext.nativeBindings.find(row =>
      row.owner.kind === "frame" && row.owner.declaration === definition.activation.ownerDeclaration);
    const values = new Map(definition.bindings.map((binding, index) =>
      [binding.declaration, { kind: "path", path: `native_slot_${index}` }]));
    const form = definition.activation.kind === "class"
      ? program.nativeDeclarations.get(definition.activation.ownerDeclaration) : undefined;
    const counterName = definition.activation.kind === "class" ? form.frameCounterName : definition.counterName;
    const counter = counterName === undefined ? undefined : { name: counterName,
      value: { kind: "call", path: "rt::FrameEntryCounter::new", args: [] } };
    const context = { input: { program }, emissionContext, usedAliases: new Set() };
    const declarations = planRustNativeFrameStorageItems(definition, context);
    assert.equal(declarations?.length, 1, "the canonical owner supplies its real native frame declaration");
    const declaration = declarations[0];
    assert.equal(declaration.kind, "struct");
    assert.equal(declaration.name, definition.targetName, "query and output do not create two nominal storage types");
    const declaredContext = program.physicalEmissionContexts.contextForOwner(definition, "frame");
    assert.equal(declaredContext !== undefined, true, "the template declaration retains its own original native use");
    for (const binding of definition.bindings) {
      const field = declaration.fields.find(field => field.name === binding.fieldName);
      const storage = declaredContext.nativeBindings.find(row => row.declaration === binding.declaration);
      assert.equal(storage !== undefined && field !== undefined, true, "every original slot has completed native declaration evidence");
      assert.equal(JSON.stringify(field.type) === JSON.stringify(rustTypeFromSelectedNativeCarrier(storage.storage.slotCarrier)),
        true, "the real declaration renders the complete slot, not its logical payload or a structural lookalike");
    }
    const selected = createRustNativeFrameOwner(definition, values, counter, context);
    assert.equal(selected?.kind, "call", "the exact native holder constructor is emitted once");
    assert.equal(selected.path, native.owner.constructor, "the canonical native policy owns the whole-frame constructor");
    assert.equal(native.storage.holderCarrier === native.storage.slotCarrier, true,
      "the captured slot cannot masquerade as its enclosing frame allocation");
    assert.equal(selected.args.length, 1, "the actual frame is its sole owner-constructor argument");
    const fields = selected.args[0].fields;
    assert.equal(fields.length, definition.bindings.length + (counter === undefined ? 0 : 1) +
      (definition.environmentParameters.length === 0 ? 0 : 1), "no invented fields or erased environment marker");
    for (const binding of definition.bindings) {
      const field = fields.find(field => field.name === binding.fieldName);
      assert.equal(field?.value === values.get(binding.declaration), true, "the original slot expression is neither copied nor rebuilt");
    }
    const missing = new Map(values);
    missing.delete(definition.bindings[0].declaration);
    assert.equal(createRustNativeFrameOwner(definition, missing, counter, context), undefined,
      "an incomplete actual holder is not synthesized from a tuple or payload fallback");
    assert.equal(createRustNativeFrameOwner(definition, values,
      { name: "foreign_counter", value: { kind: "path", path: "foreign" } }, context), undefined,
    "a different activation counter cannot replace the original frame owner");
  });
}

test("dispatched field writes borrow their physical receiver instead of consuming or cloning it", () => {
  const owner = { kind: "path", path: "owner" };
  for (const receiver of [owner, { kind: "reference", expr: owner }]) {
    for (const operator of ["=", "+="]) {
      const value = { kind: "int-literal", value: "7" };
      const write = writeRustProjectDispatchedField(receiver, "selected_owner", "read", "write", operator, value);
      const binding = write.body.statements[0];
      assert.equal(binding.name, "selected_owner");
      assert.equal(binding.init.kind, "reference");
      assert.equal(binding.init.expr === owner, true, "repeatable native field operations retain the same owner");
      assert.equal(write.body.statements.length, 2, "one receiver selection and one write expression");
    }
  }
});

test("prepared physical addresses transfer one existing handle without reconstructing or recloning a local", () => {
  const expression = {};
  const value = { kind: "method-call", receiver: { kind: "path", path: "frame.seed" }, method: "clone", args: [] };
  let queries = 0;
  const context = { valueFieldLocations: new Map([[expression, { address: (member, selected) => {
    assert.equal(selected === context, true, "query receives the current consuming context");
    assert.equal(member, undefined);
    queries += 1;
    return { kind: "infallible", value };
  } }]]) };
  for (const cloneRoot of [false, true]) assert.equal(rustRawLocationRoot(expression, context, cloneRoot) === value, true,
    "prepared owner already supplies one owned physical handle");
  assert.equal(queries, 2);
});

test("prepared field addresses retain their exact member and current failure domain without infallible erasure", () => {
  const expression = {};
  const value = { kind: "path", path: "native_field_pointer" };
  const context = { input: { program: { records: createRustRecordFixture({targetOperation: { get: (node) => node === expression ? { kind: "source-field", operationId: "exact-member" } : undefined }}) } },
    valueFieldLocations: new Map([[expression, { address: (member, selected) => {
      assert.equal(selected === context, true, "query must not retain its preparation context");
      return member === "exact-member" ? { kind: "fallible", value } : undefined;
    } }]]) };
  assert.equal(rustRawLocationRoot(expression, context), undefined, "fallible field pointers are not raw infallible roots");
  assert.equal(planRustSourceLocationStorage(expression, expression, context, () => {
    assert.fail("prepared field address must not reconstruct a source receiver");
  }) === value, true, "selected fallible pointer passes through without another adapter");
});

test("native projected addresses clone one auto-borrowed owner and select each physical callback once", () => {
  const context = { fallibleBoundary: rustPackageFallibleBoundary({ componentId: "test", errorDomain: "project",
    errorTypePath: "ExactError", errorTypeIdentity: "exact-error" }),
    syntheticNames: createRustSyntheticNameState({ kindName: () => "KindBlock", forEachChild: () => {} }, {}, []),
    usedAliases: new Set() };
  const owner = { kind: "path", path: "owner" };
  let reads = 0;
  let writes = 0;
  const address = planRustProjectedObjectLocation({ kind: "reference", expr: owner }, "exact-member", context,
    reader => { reads += 1; return { kind: "field", receiver: reader, name: "seed" }; },
    (writer, value) => { writes += 1; return { kind: "assignment", operator: "=",
      target: { kind: "field", receiver: writer, name: "seed" }, value }; });
  assert.equal(reads, 1);
  assert.equal(writes, 1);
  assert.equal(address.kind, "block");
  const initialization = address.body.statements[0].init;
  assert.equal(initialization.kind, "method-call");
  assert.equal(initialization.method, "clone");
  assert.equal(initialization.receiver === owner, true, "native method auto-borrow avoids (&owner).clone()");
  const readCallback = address.body.statements.at(-1).expr.args[2];
  assert.equal(readCallback.body.genericArguments[1].type.path, "ExactError",
    "even a discarded native address retains its exact error domain");
  assert.equal(readCallback.body.genericArguments[1].type.identity, "exact-error");
  assert.equal(context.usedAliases.has("rt"), true);
});
