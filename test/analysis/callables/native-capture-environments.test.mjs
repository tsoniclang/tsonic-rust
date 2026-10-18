import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { targetUseSiteRef } from "@tsonic/target-api/analysis";
import { completeRustNativeNamedCaptureEnvironment, rustNativeCaptureInputs, rustNativeCaptureInputsForCreation } from "../../../dist/analysis/callables/emission-capture-environments.js";
import { selectRustNativeCallableEnvironment } from "../../../dist/policy/types/model/native-type-selection.js";
import { rustNamedTypeCarrierValue, rustNativeTraitRef } from "../../../dist/target-model/types/carriers/native.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustGenericRequirementBound } from "../../../dist/target-model/lifetimes/model.js";
import { rustBuiltInCarrierDefinitions } from "../../../dist/target-model/types/carriers/built-ins.js";
import { rustRetainedErrorTargetId } from "../../../dist/target-model/types/carriers/source-error.js";

function captures() {
  const carrier = { kind: "source-primitive", name: "number" };
  const declaration = {};
  const binding = { declaration, reference: {}, carrier, storage: "value" };
  const field = { declaration: {}, reference: {}, receiver: {}, references: [{}, {}], carrier,
    storage: { kind: "copy" } };
  const receiver = { owner: {}, reference: {}, references: [{}, {}], carrier };
  return { captures: [binding], receiverFields: [field], receivers: [receiver] };
}

test("capture inventories retain all original slot kinds and emitted field order", () => {
  const capture = captures();
  const producer = { declaration: {}, identity: "native:first", fileName: "/index.ts", environment: [],
    parameterCarriers: [], inputLifetimeParameters: [] };
  const environment = Object.freeze({ kind: "native", producer, capture, creation: Object.freeze({ kind: "definition" }) });
  const rows = rustNativeCaptureInputs(environment, capture);
  assert.equal(rows.length, 1, "the complete original environment is retained once");
  const slots = rows[0].slots;
  assert.equal(slots.length, 3, "lexical binding, receiver field and whole receiver are all retained");
  for (const [index, kind] of ["binding", "receiver-field", "receiver"].entries()) {
    assert.equal(slots[index].slot.kind, kind, `${kind}: its original semantic slot is retained`);
    assert.equal(slots[index].slotIndex, index, `${kind}: the actual combined field index is unchanged`);
    assert.equal(rows[0].environment === environment, true, `${kind}: original producer/environment identity is retained`);
    assert.equal(Object.isFrozen(slots[index]) && Object.isFrozen(slots[index].slot), true, `${kind}: preparation is immutable`);
  }
  assert.equal(slots[0].slot.capture === capture.captures[0], true, "original capture identity is not reconstructed");
  assert.equal(slots[1].slot.capture === capture.receiverFields[0], true, "the full field receiver and reference vector survive");
  assert.equal(slots[2].slot.capture === capture.receivers[0], true, "the full original receiver vector survives");
  assert.equal(Object.isFrozen(rows) && Object.isFrozen(rows[0]) && Object.isFrozen(slots), true, "the complete input vector is immutable");
});

test("a real empty capture environment survives preparation without a fabricated slot", () => {
  const capture = { captures: [], receiverFields: [], receivers: [] };
  const implementation = { ...capture, declaration: {} };
  const environment = { kind: "generic", definition: {}, implementation, member: undefined,
    environment: { ...capture, parameters: [], arguments: [], inputs: [], substitutions: {
      types: new Map(), lifetimes: new Map(), consts: new Map() } }, arguments: [] };
  const rows = rustNativeCaptureInputs(environment, capture);
  assert.equal(rows.length, 1, "empty slots do not erase the actual original environment owner");
  assert.equal(rows[0].environment === environment, true, "the exact original generic environment survives");
  assert.equal(rows[0].slots.length, 0, "no dummy binding, receiver or capture is invented");
  assert.equal(Object.isFrozen(rows[0]) && Object.isFrozen(rows[0].slots), true);
  const native = { kind: "native", producer: {}, capture, creation: { kind: "definition" } };
  const nativeRows = rustNativeCaptureInputs(native, capture);
  const use = targetUseSiteRef({}, "native-body", "empty-creation");
  const created = rustNativeCaptureInputsForCreation(nativeRows, use);
  assert.equal(created.length === 1 && created[0].slots.length === 0, true, "native zero-slot owners survive creation transport");
  assert.equal(created[0].environment.creation.use === use, true, "the actual empty environment retains its creation site");
  assert.equal(nativeRows[0].environment === native, true, "the original definition row is not mutated");
});

test("two environments capturing one declaration remain distinct original owners", () => {
  const capture = captures();
  const firstProducer = { declaration: {}, identity: "native:first" };
  const secondProducer = { declaration: {}, identity: "native:second" };
  const first = rustNativeCaptureInputs({ kind: "native", producer: firstProducer, capture, creation: { kind: "definition" } }, capture);
  const secondCapture = { ...capture, captures: [{ ...capture.captures[0], reference: {} }] };
  const second = rustNativeCaptureInputs({ kind: "native", producer: secondProducer, capture: secondCapture,
    creation: { kind: "definition" } }, secondCapture);
  assert.equal(first.length + second.length, 2, "no declaration-only deduplication removes either complete environment");
  assert.equal(first[0].slots.length + second[0].slots.length, 6, "both complete original slot vectors survive");
  assert.equal(first[0].slots[0].slot.capture.declaration === second[0].slots[0].slot.capture.declaration, true, "the source binding really is shared");
  assert.equal(first[0].slots[0].slot.capture.reference === second[0].slots[0].slot.capture.reference, false, "each original capture reference remains distinct");
  assert.equal(first[0].environment.producer === firstProducer, true, "first cleanup owner retains its producer");
  assert.equal(second[0].environment.producer === secondProducer, true, "second cleanup owner retains its producer");
});

test("inferred native captures retain the original creation use, never a fabricated named environment", () => {
  const capture = captures();
  const producer = { declaration: {}, identity: "native:original" };
  const inputs = rustNativeCaptureInputs({ kind: "native", producer, capture, creation: { kind: "definition" } }, capture);
  const firstUse = targetUseSiteRef({}, "native-body", "creation:first");
  const secondUse = targetUseSiteRef({}, "native-body", "creation:second");
  const first = rustNativeCaptureInputsForCreation(inputs, firstUse);
  const second = rustNativeCaptureInputsForCreation(inputs, secondUse);
  for (const [index, row] of first.entries()) {
    assert.equal(row.slots === inputs[index].slots, true, "all original binding/receiver slot provenance is unchanged");
    assert.equal(row.environment.producer === producer, true, "the actual original callable producer is retained");
    assert.equal(row.environment.creation.kind, "expression", "an actual creation is distinct from its source body template");
    assert.equal(row.environment.creation.use === firstUse, true, "the precise enclosing physical creation use is retained");
    assert.equal(second[index].environment.creation.use === secondUse, true, "another creation never recovers the first use");
    assert.equal("stateCarrier" in row.environment || "holderCarrier" in row.environment || "path" in row.environment, false,
      "a signature/capture tuple is never relabelled as the anonymous native closure allocation");
  }
  assert.equal(inputs.every(input => input.environment.creation.kind === "definition"), true,
    "creating an emitted body never mutates or overwrites the original immutable template");
});

test("frame entry alternatives retain their exact entry and implementation provenance", () => {
  const capture = captures();
  const definition = {};
  const firstImplementation = { ...capture, declaration: {} };
  const secondImplementation = { ...capture, declaration: {} };
  const firstEntry = { implementations: [firstImplementation] };
  const secondEntry = { implementations: [secondImplementation] };
  const first = rustNativeCaptureInputs({ kind: "frame", definition, entry: firstEntry,
    implementation: firstImplementation }, firstImplementation);
  const second = rustNativeCaptureInputs({ kind: "frame", definition, entry: secondEntry,
    implementation: secondImplementation }, secondImplementation);
  assert.equal(first.length + second.length, 2, "every entry/implementation retains its own complete environment");
  assert.equal(first[0].slots.length + second[0].slots.length, 6, "every entry/implementation retains its full capture vector");
  assert.equal(first[0].environment.entry === firstEntry && second[0].environment.entry === secondEntry, true,
    "equal capture fields do not collapse distinct original frame entries");
  assert.equal(first[0].environment.implementation === firstImplementation && second[0].environment.implementation === secondImplementation, true,
    "the original selected implementation is never replaced by the first entry's implementation");
});

test("generic member capture preparation keeps the complete original argument and binding correlation", () => {
  const capture = captures();
  const bindings = { types: new Map([["captured:T", capture.captures[0].carrier]]), lifetimes: new Map(), consts: new Map() };
  const arguments_ = [{ kind: "lifetime", lifetime: { kind: "parameter", identity: "owner:a", name: "a" } },
    { kind: "type", type: capture.captures[0].carrier }, { kind: "const", value: { kind: "integer", value: "4" } }];
  const implementation = { ...capture, declaration: {} };
  const member = { implementation, arguments: arguments_, bindings };
  const environment = { kind: "generic", definition: {}, implementation, member,
    environment: { ...capture, parameters: [], arguments: arguments_, inputs: [], substitutions: bindings }, arguments: arguments_ };
  const rows = rustNativeCaptureInputs(environment, capture);
  assert.equal(rows.length, 1, "the original generic environment is retained once");
  assert.equal(rows[0].slots.length, 3, "the generic environment contains all original capture sections");
  assert.equal(rows.every(row => row.environment.member === member), true, "the actual physical member is shared by its own slots");
  assert.equal(rows.every(row => row.environment.arguments === arguments_), true, "lifetimes, types and consts retain the complete argument vector");
  assert.equal(rows[0].environment.member.bindings === bindings, true, "bindings are not reconstructed from names or substituted concrete types");
  assert.equal(rows[0].environment.environment.substitutions === bindings, true, "the canonical prepared environment is retained once");
});

function nativeContext() {
  return {
    moduleName: "consumer", crateName: "consumer_crate",
    moduleNameByFileName: new Map([["/owner.ts", "owner"]]),
    externalCrateNameByFileName: new Map([["/owner.ts", "owner_crate"]]),
    externalPublicPathFor: () => undefined, nativeTypeItemFor: () => undefined,
    externalStructuralShapeModuleByFileName: new Map(), structuralShapesModuleName: "shapes",
    typeParameterNames: new Map([["owner:T", "ActualT"]]), typeDefinitions: emptyRustTypeDefinitions,
    projectTypes: { definitionForCarrier: () => undefined }, objectRepresentations: { representationFor: () => undefined },
    structuralShapes: { definitionForCarrier: () => undefined, unionForCarrier: () => undefined },
    callableValues: { generic: { physical: { definitionFor: () => undefined, argumentsFor: () => undefined } },
      frames: { definitionFor: () => undefined, entryFor: () => undefined } },
    classValues: { forCarrier: () => undefined, forDeclaration: () => undefined },
    errorRegions: { producerError: () => undefined, declarationsFor: () => [] },
    additionalArgumentsFor: () => undefined, programErrorBoundaryFor: () => undefined,
  };
}

function namedEnvironment(storage) {
  return {
    fileName: "/owner.ts", stateName: "CapturedState", storage,
    arguments: [{ kind: "lifetime", lifetime: { kind: "parameter", identity: "owner:a", name: "a" } },
      { kind: "type", type: { kind: "type-parameter", identity: "owner:T", name: "T" } },
      { kind: "const", value: { kind: "integer", value: "9007199254740993" } }],
    typeRequirements: [{ typeArgumentIndex: 0, trait: rustNativeTraitRef("core::clone::Clone") }],
  };
}

for (const [storage, constructor] of [["value", null], ["shared", "alloc::rc::Rc::new"],
  ["cyclic", "alloc::rc::Rc::new_cyclic"]]) test(`${storage} environment selection owns the complete named state and actual constructor`, () => {
  const environment = namedEnvironment(storage);
  const result = selectRustNativeCallableEnvironment(environment, nativeContext());
  assert.equal(result.kind, "resolved", `${storage}: the original native state is representable`);
  const state = rustNamedTypeCarrierValue(result.stateCarrier);
  assert.equal(state !== undefined, true, `${storage}: actual state is a native named carrier`);
  assert.equal(state.path, "owner_crate::owner::CapturedState", `${storage}: defining package and original state name are retained`);
  assert.equal(state.genericArguments.length, 3, `${storage}: no lifetime, type or exact const argument is dropped`);
  assert.equal(state.genericArguments[0].kind === "lifetime" && state.genericArguments[0].lifetime.identity === "owner:a", true,
    `${storage}: the original lifetime identity is unchanged`);
  assert.equal(state.genericArguments[1].kind === "type" && state.genericArguments[1].type.identity === "owner:T", true,
    `${storage}: original binder identity survives native spelling selection`);
  assert.equal(state.genericArguments[2].kind === "const" && state.genericArguments[2].value.value === "9007199254740993", true,
    `${storage}: exact native integers never round through a number`);
  assert.equal(state.typeRequirements.length, 1, `${storage}: required native TYPE evidence is retained`);
  assert.equal(state.typeRequirements[0].typeArgumentIndex, 0, `${storage}: lifetime/const arguments do not shift TYPE-only proof slots`);
  assert.equal(state.typeRequirements[0].trait.path, "core::clone::Clone", `${storage}: the original Clone obligation is not guessed empty`);
  assert.equal(result.constructor, constructor, `${storage}: constructor is selected once with its actual owner`);
  if (storage === "value") assert.equal(result.holderCarrier === result.stateCarrier, true, "inline state has no invented allocation");
  else {
    const holder = rustNamedTypeCarrierValue(result.holderCarrier);
    assert.equal(holder.path, "alloc::rc::Rc", `${storage}: actual enclosing allocation is distinct from captured slots`);
    assert.equal(holder.genericArguments.length === 1 && holder.genericArguments[0].type === result.stateCarrier, true,
      `${storage}: the holder contains the complete selected state, not a capture tuple or invocation signature`);
  }
});

test("native environment selection refuses missing evidence, foreign paths and inferred signatures as named storage", () => {
  const environment = namedEnvironment("shared");
  const context = nativeContext();
  const missingRequirements = selectRustNativeCallableEnvironment({ ...environment, typeRequirements: undefined }, context);
  assert.equal(missingRequirements.kind, "rejected", "superseded requirement-free constructor input is not admitted");
  const missingStorage = selectRustNativeCallableEnvironment({ ...environment, storage: undefined }, context);
  assert.equal(missingStorage.kind, "rejected", "unknown storage never becomes an Rc or cyclic guess");
  const foreign = selectRustNativeCallableEnvironment({ ...environment, fileName: "/foreign.ts" }, context);
  assert.equal(foreign.kind, "rejected", "an unowned file cannot recover a path from a matching state name");
  const anonymous = selectRustNativeCallableEnvironment({ ...environment, arguments: [{ kind: "type", type: {
    kind: "closure", args: [], result: { kind: "tuple", elements: [] } } }], typeRequirements: [] }, context);
  assert.equal(anonymous.kind, "rejected", "an inferred callable signature is not a nameable environment allocation type");
});

test("the native bound model loads cold before carrier metadata without an ESM initialization cycle", () => {
  const model = new URL("../../../dist/target-model/lifetimes/model.js", import.meta.url).href;
  const builtIns = new URL("../../../dist/target-model/types/carriers/built-ins.js", import.meta.url).href;
  const sourceError = new URL("../../../dist/target-model/types/carriers/source-error.js", import.meta.url).href;
  const cold = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import assert from "node:assert/strict";
    const { rustGenericRequirementBound } = await import(${JSON.stringify(model)});
    const { rustBuiltInCarrierDefinitions } = await import(${JSON.stringify(builtIns)});
    const { rustRetainedErrorTargetId } = await import(${JSON.stringify(sourceError)});
    const retained = Object.freeze({ identity: rustRetainedErrorTargetId,
      path: rustBuiltInCarrierDefinitions[rustRetainedErrorTargetId].renderPath });
    const expected = ["core::clone::Clone", "core::default::Default", "static", "js_abi::SourceNumeric",
      "js_abi::NativeNumberPredicate", "core::convert::Into"];
    for (const [index, requirement] of ["clone", "default", "static", "source-numeric", "number-predicate", "js-rejection"].entries()) {
      const bound = rustGenericRequirementBound(requirement, retained);
      assert.equal(bound === undefined ? undefined : bound.kind === "static" ? "static" : bound.path,
        expected[index], requirement);
    }
  `], { encoding: "utf8", timeout: 10_000 });
  assert.equal(cold.error === undefined, true, "the cold module process starts and completes within its bound");
  assert.equal(cold.status, 0, cold.stderr);
});

test("one pure native bound constructor retains all six selected grammars and the exact retained error argument", () => {
  const retained = Object.freeze({ identity: rustRetainedErrorTargetId,
    path: rustBuiltInCarrierDefinitions[rustRetainedErrorTargetId].renderPath });
  for (const [requirement, path] of [["clone", "core::clone::Clone"], ["default", "core::default::Default"],
    ["source-numeric", "js_abi::SourceNumeric"], ["number-predicate", "js_abi::NativeNumberPredicate"],
    ["js-rejection", "core::convert::Into"]]) {
    const bound = rustGenericRequirementBound(requirement, retained);
    assert.equal(bound?.kind, "trait-ref", `${requirement}: the original native constraint remains typed data`);
    assert.equal(bound.path, path, `${requirement}: native identity is selected once`);
    assert.equal(Object.isFrozen(bound) && Object.isFrozen(bound.genericArguments), true, `${requirement}: data is immutable`);
  }
  assert.equal(rustGenericRequirementBound("static", retained).kind, "static", "static remains a lifetime, not a fake trait");
  const rejectedError = rustGenericRequirementBound("js-rejection", retained).genericArguments[0];
  const nativeError = rustNamedTypeCarrierValue(rejectedError.type);
  assert.equal(nativeError.path, retained.path, "Into uses the actual retained runtime error declaration, never TsonicError or E");
  assert.equal(nativeError.nativeErrorIdentity, rustRetainedErrorTargetId, "the genuine native error identity is retained");
  assert.equal(nativeError.genericArguments.length + nativeError.typeRequirements.length, 0,
    "the concrete non-generic runtime declaration has proved empty arguments and requirements");
  for (const evidence of [undefined, { ...retained, path: undefined }, { ...retained, path: "" },
    { ...retained, identity: "foreign:error" }]) {
    assert.equal(rustGenericRequirementBound("js-rejection", evidence) === undefined, true,
      "missing or foreign runtime evidence never becomes an empty requirement");
  }
  assert.equal(rustGenericRequirementBound("unknown", retained) === undefined, true,
    "an unselected grammar is not recovered as source-numeric");
});

function requirementContract(declaration, parameters) {
  return { declaration, typeParameters: parameters, capturedTypeParameters: [], nativeInputs: [],
    associatedTypes: [], projectProjections: [], optionalStorage: [] };
}

test("native frame state uses every entry contract and original TYPE geometry before concrete binding substitution", () => {
  const capture = captures();
  const parameter = { kind: "type-parameter", identity: "owner:T", name: "T" };
  const first = { ...capture, declaration: {}, carrier: parameter, stateName: "FirstState", copy: false, independent: false };
  const second = { ...capture, declaration: {}, carrier: parameter, stateName: "SecondState", copy: true, independent: false };
  const entry = { implementations: [first] };
  const other = { implementations: [second] };
  const definition = { ownerFileName: "/owner.ts", environmentParameters: [parameter], entries: [entry, other] };
  const firstContract = requirementContract(first.declaration, [{ identity: parameter.identity, name: "T", requirements: ["clone", "static"] }]);
  const secondContract = requirementContract(second.declaration, [{ identity: parameter.identity, name: "T", requirements: ["default"] }]);
  const contracts = new Map([[first.declaration, firstContract], [second.declaration, secondContract]]);
  const bindings = { types: new Map([[parameter.identity, { kind: "source-primitive", name: "int32" }]]),
    lifetimes: new Map(), consts: new Map() };
  const environment = { kind: "frame", definition, entry, implementation: first };
  const input = { bindings, nativeContext: nativeContext(), declarationGenericRequirements: { contractFor: node => contracts.get(node) } };
  const result = completeRustNativeNamedCaptureEnvironment(environment, input);
  assert.equal(result.kind, "resolved", "the real original native state is selected");
  const state = rustNamedTypeCarrierValue(result.stateCarrier);
  assert.equal(state.path, "owner_crate::owner::FirstState");
  assert.equal(state.genericArguments[0].kind === "type" && state.genericArguments[0].type.name === "int32", true,
    "actual substitution follows original template-index selection");
  assert.equal(state.typeRequirements.length, 2, "another entry's Default is retained alongside original Clone");
  assert.equal(state.typeRequirements.every(row => row.typeArgumentIndex === 0), true,
    "concrete substitution cannot erase the original TYPE slot identity");
  assert.equal(state.typeRequirements.some(row => row.trait.path === "core::clone::Clone") &&
    state.typeRequirements.some(row => row.trait.path === "core::default::Default"), true);
  assert.equal(firstContract.typeParameters[0].requirements.includes("static"), true,
    "the full original static/lifetime contract is not mutated or replaced by a TYPE-only vector");
  assert.equal(result.slotPaths.length, 3, "all original capture sections retain their native field paths");
  assert.equal(result.slotPaths.every((path, index) => path.length === 1 && path[0] === `capture_${index}`), true);
  assert.equal(result.constructor, "alloc::rc::Rc::new", "the complete actual non-Copy environment owns the holder");
  const missing = completeRustNativeNamedCaptureEnvironment(environment, { ...input,
    declarationGenericRequirements: { contractFor: node => node === first.declaration ? firstContract : undefined } });
  assert.equal(missing.kind, "rejected", "a missing second entry is never silently ignored");
  const unmatched = completeRustNativeNamedCaptureEnvironment(environment, { ...input,
    declarationGenericRequirements: { contractFor: node => requirementContract(node, []) } });
  assert.equal(unmatched.kind, "rejected", "an unknown generic requirement row never becomes proved empty");
});

test("empty frame payload absence is distinct from a real generic ZST and a marker-only frame state", () => {
  const capture = { captures: [], receiverFields: [], receivers: [] };
  const implementation = { ...capture, declaration: {}, carrier: { kind: "tuple", elements: [] },
    sourceFileName: "/owner.ts", stateName: "EmptyState", copy: true, storage: "value", independent: false };
  const entry = { implementations: [implementation] };
  const definition = { ownerFileName: "/owner.ts", environmentParameters: [], entries: [entry] };
  const bindings = { types: new Map(), lifetimes: new Map(), consts: new Map() };
  const input = { bindings, nativeContext: nativeContext(), declarationGenericRequirements: {
    contractFor: node => requirementContract(node, []) } };
  const frame = completeRustNativeNamedCaptureEnvironment({ kind: "frame", definition, entry, implementation }, input);
  assert.equal(frame.kind, "none", "no un-emitted named frame state is fabricated for absent payload");
  const generic = completeRustNativeNamedCaptureEnvironment({ kind: "generic", definition: { signature: { environmentParameters: [] } },
    implementation, member: undefined, environment: { ...capture }, arguments: [] }, input);
  assert.equal(generic.kind, "resolved", "the actual generic ZST is a real named emitted state even with no slots");
  assert.equal(rustNamedTypeCarrierValue(generic.stateCarrier).path, "owner_crate::owner::EmptyState");
  assert.equal(generic.slotPaths.length, 0, "the real empty state needs no fabricated cleanup slot");
  const parameter = { kind: "type-parameter", identity: "owner:T", name: "T" };
  const marker = completeRustNativeNamedCaptureEnvironment({ kind: "frame", definition: { ...definition, environmentParameters: [parameter] },
    entry, implementation }, { ...input, declarationGenericRequirements: { contractFor: node =>
      requirementContract(node, [{ identity: parameter.identity, name: "T", requirements: [] }]) } });
  assert.equal(marker.kind, "resolved", "a real retained type marker still requires its original named frame state");
  assert.equal(marker.slotPaths.length, 0, "a marker is not misreported as a captured binding");
  const independent = completeRustNativeNamedCaptureEnvironment({ kind: "frame", definition, entry,
    implementation: { ...implementation, independent: true } }, input);
  assert.equal(independent.kind, "rejected", "an independent native producer cannot be relabelled as a frame state");
});
