import assert from "node:assert/strict";
import test from "node:test";
import { classifyCarrierRequirements, rustFinalContractSupportsStatic } from "../../../dist/analysis/declarations/generic-carrier-requirements.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustLifetimeOutlives } from "../../../dist/policy/constraints/lifetime-outlives.js";
import { rustGenericCallablePhysicalBindings } from "../../../dist/policy/types/callables/generic-bindings.js";
import { rustCallableTargetType, rustFixedArrayTargetType, rustNamedTargetType, rustStringTargetType, rustStructuralObjectTargetType,
  rustSourceTypeCarrier } from "../../../dist/target-model/types/index.js";
import { rustNativeFutureOutputType } from "../../../dist/target-model/types/callable-completions.js";
import { rustNativeErrorJoinTargetType } from "../../../dist/target-model/types/native-error-joins.js";
import { rustFrameCallableTargetType } from "../../../dist/target-model/types/carriers/frame-callables.js";
import { rustClassConstructorTargetType } from "../../../dist/target-model/types/carriers/class-constructors.js";
import { rustInfallibleTargetId, rustOptionTargetId, rustCallableTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { recursiveCallbackProtocolCases } from "../../../../tsonic/test/fixtures/recursive-callback-protocols.mjs";

const number = Object.freeze({ kind: "source-primitive", name: "float64" });
const unit = Object.freeze({ kind: "tuple", elements: [] });
const staticLifetime = Object.freeze({ kind: "static" });
const scopedLifetime = Object.freeze({ kind: "parameter", identity: "scope:env", name: "env" });
const parameter = Object.freeze({ kind: "type-parameter", identity: "source:Value", name: "Value" });
const families = Object.freeze({ implementation: () => undefined });
const contract = fields => Object.freeze({ declaration: {}, typeParameters: [], capturedTypeParameters: [], nativeInputs: [],
  associatedTypes: [], projectProjections: [], optionalStorage: [], ...fields });
const evidence = fields => Object.freeze({ lifetimeContract: undefined, genericCallables: undefined, structuralShapes: undefined,
  frameCallables: undefined, classValues: undefined, objectRepresentations: undefined,
  projectTypes: undefined, records: undefined, ...fields });
const selected = (carrier, options = {}) => {
  const parameters = options.parameters ?? [];
  const demands = new Map(parameters.map(parameter => [parameter.identity, new Set()]));
  return classifyCarrierRequirements(carrier, ["static"], new Set(parameters.map(parameter => parameter.identity)), demands,
    options.associated ?? (() => false), options.definitions ?? emptyRustTypeDefinitions, options.evidence);
};
const borrowed = lifetime => ({ kind: "reference", mutable: false, lifetime, referent: rustStringTargetType() });

test("static retention distinguishes known owned storage, borrowed storage and absent physical evidence", () => {
  for (const [label, carrier] of [["scalar", number], ["owned string", rustStringTargetType()], ["unit", unit],
    ["tuple", { kind: "tuple", elements: [number, rustStringTargetType()] }],
    ["native fixed array", rustFixedArrayTargetType(number, 3)], ["unsized native slice", { kind: "slice", element: number }]])
    assert.equal(selected(carrier).kind, "supported", label);
  for (const [label, carrier] of [["actual borrow", borrowed(scopedLifetime)],
    ["slice borrow", { kind: "reference", lifetime: scopedLifetime, mutable: false, referent: { kind: "slice", element: number } }],
    ["const raw pointer", { kind: "pointer", mutability: "const", pointee: borrowed(scopedLifetime) }],
    ["mutable raw pointer", { kind: "pointer", mutability: "mut", pointee: borrowed(scopedLifetime) }]])
    assert.equal(selected(carrier).kind, "unsatisfied", label);
  for (const [label, carrier] of [["unknown native", { kind: "target-named", id: "foreign:Unknown" }],
    ["missing option argument", { kind: "target-named", id: rustOptionTargetId }],
    ["missing callable protocol", { kind: "target-named", id: rustCallableTargetId }],
    ["unknown descriptor", { kind: "target-specific", target: "rust", name: "foreign" }],
    ["opaque identity", { kind: "opaque", id: "source:opaque" }], ["unbound generic", parameter],
    ["unselected reference", { kind: "reference", mutable: false, referent: number }],
    ["logical closure", { kind: "closure", args: [], result: unit }]])
    assert.equal(selected(carrier).kind, "unresolved", label);
});

test("function pointer type outlives bounds retain every free lifetime and exclude inner HRTB binders", () => {
  const boundLifetime = { kind: "bound", binderIdentity: "signature", identity: "signature:call", name: "call" };
  const boundReference = borrowed(boundLifetime);
  const higherRanked = { kind: "function-pointer", args: [boundReference], result: boundReference,
    lifetimeBinder: { identity: "signature", parameters: [{ lifetime: boundLifetime, outlives: [] }] } };
  assert.equal(selected(higherRanked).kind, "supported", "HRTB binder is not captured storage");
  assert.equal(selected({ kind: "function-pointer", args: [borrowed(scopedLifetime)], result: unit }).kind,
    "unsatisfied", "an explicit native function type retains its free input lifetime");
  assert.equal(selected({ kind: "function-pointer", args: [], result: borrowed(scopedLifetime) }).kind,
    "unsatisfied", "free output lifetime remains a native requirement");
  assert.equal(selected({ kind: "function-pointer", args: [borrowed(scopedLifetime)], result: borrowed(scopedLifetime) }).kind,
    "unsatisfied", "a free output is not made bound by input use");
  assert.equal(selected({ kind: "function-pointer", args: [], result: borrowed(staticLifetime) }).kind,
    "supported", "static output positive");
  const callable = { kind: "function-pointer", args: [parameter], result: unit };
  assert.equal(rustFinalContractSupportsStatic(contract({ typeParameters: [{ ...parameter, requirements: [] }] }), callable,
    families, emptyRustTypeDefinitions, undefined).kind, "unsatisfied", "fn(T) still requires the actual T static bound");
  assert.equal(rustFinalContractSupportsStatic(contract({ typeParameters: [{ ...parameter, requirements: ["static"] }] }), callable,
    families, emptyRustTypeDefinitions, undefined).kind, "supported", "T static is sufficient for the exact fn(T) type");
  const higherRankedGeneric = { ...higherRanked, args: [{ ...boundReference, referent: parameter }], result: unit };
  assert.equal(rustFinalContractSupportsStatic(contract({ typeParameters: [{ ...parameter, requirements: [] }] }), higherRankedGeneric,
    families, emptyRustTypeDefinitions, undefined).kind, "unsatisfied", "an inner lifetime binder does not bind free T");
  assert.equal(rustFinalContractSupportsStatic(contract({ typeParameters: [{ ...parameter, requirements: ["static"] }] }), higherRankedGeneric,
    families, emptyRustTypeDefinitions, undefined).kind, "supported", "the exact HRTB fn type retains the proven free T bound");
});

test("native trait-object static storage preserves free signature and principal lifetime obligations", () => {
  const principal = { kind: "trait-ref", id: "native:Callback", path: "Callback", genericArguments: [], associatedConstraints: [] };
  const object = value => ({ kind: "trait-object", lifetime: staticLifetime, principal: value, autoTraits: [] });
  assert.equal(selected(object(principal)).kind, "supported", "static native object without free arguments");
  assert.equal(selected({ ...object(principal), lifetime: scopedLifetime }).kind, "unsatisfied", "borrowed object");
  assert.equal(selected(object({ ...principal, genericArguments: [{ kind: "lifetime", lifetime: scopedLifetime }] })).kind,
    "unsatisfied", "free principal lifetime is not erased by object static");
  assert.equal(selected(object({ ...principal, associatedConstraints: [{ kind: "equality", identity: "Callback.Output", name: "Output",
    genericArguments: [], type: borrowed(scopedLifetime) }] })).kind, "unsatisfied", "free output lifetime");
});

test("declared direct and transitive static outlives edges are honored only by the lifetime owner", () => {
  const intermediate = { kind: "parameter", identity: "scope:inner", name: "inner" };
  const edge = (lifetime, outlives) => ({ kind: "lifetime", declaration: {}, sourceName: lifetime.name, lifetime, outlives });
  const direct = { declaration: {}, parameters: [edge(scopedLifetime, [staticLifetime])] };
  const transitive = { declaration: {}, parameters: [edge(scopedLifetime, [intermediate]), edge(intermediate, [staticLifetime])] };
  const missing = { declaration: {}, parameters: [edge(scopedLifetime, [intermediate]), edge(intermediate, [])] };
  assert.equal(rustLifetimeOutlives(scopedLifetime, staticLifetime, direct), true, "direct edge");
  assert.equal(rustLifetimeOutlives(scopedLifetime, staticLifetime, transitive), true, "transitive edge");
  assert.equal(rustLifetimeOutlives(scopedLifetime, staticLifetime, missing), false, "no implicit static edge");
  assert.equal(selected(borrowed(scopedLifetime), { evidence: evidence({ lifetimeContract: transitive }) }).kind, "supported", "same declared relation");
  assert.equal(selected(borrowed(scopedLifetime), { evidence: evidence({ lifetimeContract: missing }) }).kind, "unsatisfied", "same missing relation");
});

test("final contracts never infer a bound or confuse unknown identity with native unsatisfied storage", () => {
  const entry = requirements => ({ identity: parameter.identity, name: parameter.name, requirements });
  const run = fields => rustFinalContractSupportsStatic(contract(fields), parameter, families, emptyRustTypeDefinitions, undefined);
  assert.equal(run({}).kind, "unresolved", "foreign identity");
  const missing = contract({ nativeInputs: [entry(["clone"])] });
  assert.equal(rustFinalContractSupportsStatic(missing, parameter, families, emptyRustTypeDefinitions, undefined).kind,
    "unsatisfied", "known native input without static");
  assert.equal(missing.nativeInputs[0].requirements.includes("static"), false, "final proof does not collect");
  assert.equal(run({ nativeInputs: [entry(["static"])] }).kind, "supported", "actual native static bound");
});

test("Future output and logical empty capture lists are not physical ownership evidence", () => {
  const ownedOutput = rustNativeFutureOutputType({ identity: "unknown:future", output: unit, captures: [] });
  const borrowedOutput = rustNativeFutureOutputType({ identity: "unknown:borrowed-future", output: borrowed(scopedLifetime), captures: [] });
  assert.equal(selected(ownedOutput).kind, "unresolved", "unit output says nothing about actual captures");
  assert.equal(selected(borrowedOutput).kind, "unresolved", "output alone is not captured storage either");
  assert.equal(selected({ ...ownedOutput, outlives: [staticLifetime] }).kind, "supported", "explicit native outlives guarantee");
  assert.equal(selected(rustNativeFutureOutputType({ identity: "ready", output: borrowed(scopedLifetime), captures: [], ready: true })).kind,
    "unsatisfied", "Ready really stores its output");
  assert.equal(selected(rustNativeFutureOutputType({ identity: "ready", output: borrowed(staticLifetime), captures: [], ready: true })).kind,
    "supported", "Ready static output positive");
});

test("closed native joins and actual union variants retain all physical payload lifetime demands", () => {
  const owned = rustNativeErrorJoinTargetType("/source.ts", [number, rustStringTargetType()]);
  const borrowedJoin = rustNativeErrorJoinTargetType("/source.ts", [number, borrowed(scopedLifetime)]);
  assert.equal(selected(owned).kind, "supported", "all actual owned join fields");
  assert.equal(selected(borrowedJoin).kind, "unsatisfied", "borrowed join alternative");
  assert.equal(selected(rustNamedTargetType("native:Box", "Box", [{ kind: "type", type: borrowed(scopedLifetime) }])).kind,
    "unsatisfied", "actual native generic field bound");
});

test("structural methods require their actual selected storage rather than their call signature", () => {
  const carrier = rustStructuralObjectTargetType("/source.ts", [{ sourceName: "read", type: { kind: "closure", args: [], result: number },
    presence: "required", readonly: true, method: true }]);
  assert.equal(selected(carrier).kind, "unresolved", "no selected method storage");
  const shapes = storage => {
    const field = { sourceName: "read", methodPlan: { kind: "stored", carrier: storage, constructions: [], receiver: "included" } };
    return { instances: [{ carrier, fields: [field] }], field: (selected, index) =>
      selected === carrier && index === 0 ? field : undefined };
  };
  const infallible = { kind: "target-named", id: rustInfallibleTargetId };
  assert.equal(selected(carrier, { evidence: evidence({ structuralShapes: shapes(rustCallableTargetType([], number, staticLifetime, infallible)) }) }).kind,
    "supported", "the admitted physical method storage is owned");
  assert.equal(selected(carrier, { evidence: evidence({ structuralShapes: shapes(rustCallableTargetType([], number, scopedLifetime, infallible)) }) }).kind,
    "unsatisfied", "the admitted physical method storage is borrowed");
});

test("fixed structural retention classifies the exact bound context rather than free invocation lifetimes", () => {
  const error = { kind: "target-named", id: "rust.program.TsonicError", errorOwner: { kind: "logical" } };
  const signature = rustCallableTargetType([borrowed(scopedLifetime)], number, scopedLifetime, error);
  const shape = method => rustStructuralObjectTargetType("/source.ts", [{ sourceName: "read", type: method,
    presence: "required", readonly: true, method: true }]);
  const logical = shape(signature);
  const native = shape(rustCallableTargetType([borrowed(scopedLifetime)], number, scopedLifetime,
    { ...error, errorOwner: { kind: "physical", domain: "runtime" } }));
  const shapes = context => {
    const field = { sourceName: "read", methodPlan: { kind: "fixed", declaration: {}, carrier: signature, context } };
    return { instances: [{ carrier: logical, fields: [field] }],
      field: (owner, index) => rustTargetTypeRefEquals(owner, logical) && index === 0 ? field : undefined };
  };
  assert.equal(selected(native, { evidence: evidence({ structuralShapes: shapes({ kind: "tuple", elements: [number] }) }) }).kind,
    "supported", "a native method's free invocation signature does not borrow its owned bound receiver context");
  assert.equal(selected(native, { evidence: evidence({ structuralShapes: shapes({ kind: "tuple", elements: [borrowed(scopedLifetime)] }) }) }).kind,
    "unsatisfied", "an actual captured reference still retains its original native lifetime");
  assert.equal(selected(native, { evidence: evidence({ structuralShapes: { field: () => undefined } }) }).kind,
    "unresolved", "missing actual context evidence is never replaced by a signature or an owned guess");
});

test("actual source instance fields are read once and cannot be replaced by empty generic arguments", () => {
  const declaration = {};
  const definition = { declaration, kind: "class", genericParameters: [] };
  const carrier = rustSourceTypeCarrier("/source.ts", "Owner", "object", []);
  const field = {};
  const context = stored => evidence({ projectTypes: { definitionForCarrier: () => definition,
    objectLayoutForDefinition: () => ({ fields: [{ declaration: field }], indexSignatures: [] }),
    isPolymorphic: () => false, directSupertypes: () => [], instantiateMemberCarrier: (_field, _receiver, exact) => exact },
    classValues: { forDeclaration: () => undefined }, records: { runtimeCarrier: { get: node =>
      node === field ? { carrier: stored } : undefined } } });
  assert.equal(selected(carrier).kind, "unresolved", "no field layout is not empty owned storage");
  assert.equal(selected(carrier, { evidence: context(rustStringTargetType()) }).kind, "supported", "actual owned field");
  assert.equal(selected(carrier, { evidence: context(borrowed(scopedLifetime)) }).kind, "unsatisfied", "actual borrowed field");
});

test("polymorphic native wrappers use their admitted dispatch object, not a guessed closed class census", () => {
  const definition = { declaration: {}, kind: "interface" };
  const carrier = rustSourceTypeCarrier("/source.ts", "Open", "object", []);
  const projectTypes = { definitionForCarrier: () => definition, openCarrier: () => carrier,
    objectLayoutForDefinition: () => ({ fields: [], indexSignatures: [] }), isPolymorphic: () => true,
    concreteClassesFor: () => assert.fail("a sealed native dispatch-object type is not a concrete-class enumeration") };
  const run = representation => selected(carrier, { evidence: evidence({ projectTypes,
    objectRepresentations: { representationFor: () => representation } }) });
  assert.equal(run({ kind: "open-hierarchy", dispatchObjectLifetime: staticLifetime }).kind, "supported", "actual static dispatch object");
  assert.equal(run({ kind: "open-hierarchy", dispatchObjectLifetime: scopedLifetime }).kind, "unsatisfied", "actual borrowed dispatch object");
  assert.equal(run(undefined).kind, "unresolved", "no representation selection is not a static guarantee");
});

test("polymorphic dispatch lifetimes are instantiated through the existing exact native binder", () => {
  const definition = { declaration: {}, kind: "interface" };
  const open = rustSourceTypeCarrier("/source.ts", "Open", "object", [{ kind: "lifetime", lifetime: scopedLifetime }]);
  const projectTypes = { definitionForCarrier: () => definition, openCarrier: () => open,
    objectLayoutForDefinition: () => ({ fields: [], indexSignatures: [] }), isPolymorphic: () => true };
  const context = evidence({ projectTypes,
    objectRepresentations: { representationFor: () => ({ kind: "open-hierarchy", dispatchObjectLifetime: scopedLifetime }) } });
  const run = lifetime => selected(rustSourceTypeCarrier("/source.ts", "Open", "object", [{ kind: "lifetime", lifetime }]), { evidence: context });
  assert.equal(run(staticLifetime).kind, "supported", "the selected instance replaces its declaration lifetime");
  assert.equal(run(scopedLifetime).kind, "unsatisfied", "a real borrowed dispatch remains borrowed");
});

test("full native frames prove owned activation bindings even when every entry capture is filtered out", () => {
  const owner = { fileName: "/source.ts", declarationIdentity: "owner" };
  const carrier = rustFrameCallableTargetType([], number, { kind: "lexical", origin: owner });
  assert.equal(carrier !== undefined, true, "valid native frame carrier");
  const declaration = {};
  const capturedDeclaration = {};
  const run = stored => {
    const capture = { declaration: capturedDeclaration, reference: {}, carrier: stored };
    const implementation = { declaration, carrier, capture: { captures: [capture], receiverFields: [], receivers: [] },
      captures: [], receiverFields: [], receivers: [] };
    const entry = { implementations: [implementation], environmentIndexes: [] };
    const definition = { storage: { kind: "standalone" }, entries: [entry], bindings: [
      { declaration: capturedDeclaration, carrier: stored, entry: undefined },
      { declaration, carrier, entry },
    ], environmentParameters: [] };
    return selected(carrier, { evidence: evidence({ frameCallables: { definitionFor: () => definition, entryFor: () => entry } }) });
  };
  assert.equal(run(rustStringTargetType()).kind, "supported", "owned activation is checked, not recursive entry handles");
  assert.equal(run(borrowed(scopedLifetime)).kind, "unsatisfied", "empty filtered entries cannot hide a borrowed activation field");
  assert.equal(selected(carrier).kind, "unresolved", "a frame descriptor alone is not static evidence");
});

test("native frame external state fields preserve their exact physical vector correspondence", () => {
  const owner = { fileName: "/source.ts", declarationIdentity: "owner" };
  const carrier = rustFrameCallableTargetType([], number, { kind: "lexical", origin: owner });
  assert.equal(carrier !== undefined, true, "valid native frame carrier");
  const run = carriers => {
    const capture = { declaration: {}, reference: {}, carrier: carriers[0] ?? number };
    const implementation = { declaration: {}, carrier, capture: { captures: [capture], receiverFields: [], receivers: [] },
      captures: carriers.length === 0 ? [] : [capture], receiverFields: [], receivers: [] };
    const entry = { implementations: [implementation], environmentIndexes: [] };
    const definition = { storage: { kind: "standalone" }, entries: [entry], bindings: [], environmentParameters: [] };
    return selected(carrier, { evidence: evidence({ frameCallables: { definitionFor: () => definition, entryFor: () => entry } }) });
  };
  assert.equal(run([rustStringTargetType()]).kind, "supported", "actual owned entry storage");
  assert.equal(run([borrowed(scopedLifetime)]).kind, "unsatisfied", "actual borrowed entry storage");
  assert.equal(run([]).kind, "unresolved", "missing physical capture is not an empty environment");
});

test("native frame bindings use the selected activation's exact generic arguments", () => {
  const owner = { fileName: "/source.ts", declarationIdentity: "generic-owner" };
  const template = rustFrameCallableTargetType([], parameter, { kind: "lexical", origin: owner });
  assert.equal(template !== undefined, true, "valid generic frame protocol");
  const capture = { declaration: {}, reference: {}, carrier: parameter };
  const implementation = { declaration: {}, carrier: template,
    capture: { captures: [capture], receiverFields: [], receivers: [] }, captures: [], receiverFields: [], receivers: [] };
  const entry = { implementations: [implementation], environmentIndexes: [0] };
  const definition = { storage: { kind: "standalone" }, entries: [entry], bindings: [{ declaration: capture.declaration, carrier: parameter, entry: undefined }],
    environmentParameters: [parameter] };
  const run = argument => selected(substituteRustTargetTypeParameters(template, new Map([[parameter.identity, argument]])), {
    evidence: evidence({ frameCallables: { definitionFor: () => definition, entryFor: () => entry } }),
  });
  assert.equal(run(rustStringTargetType()).kind, "supported", "selected owned activation argument");
  assert.equal(run(borrowed(scopedLifetime)).kind, "unsatisfied", "selected borrowed activation argument is not the template identity");
});

test("every admitted frame entry alternative contributes its actual stored payload", () => {
  const owner = { fileName: "/source.ts", declarationIdentity: "alternatives-owner" };
  const carrier = rustFrameCallableTargetType([], number, { kind: "lexical", origin: owner });
  assert.equal(carrier !== undefined, true, "valid native alternative protocol");
  const run = stored => {
    const implementations = [rustStringTargetType(), stored].map(field => {
      const capture = { declaration: {}, reference: {}, carrier: field };
      return { declaration: {}, carrier, capture: { captures: [capture], receiverFields: [], receivers: [] },
        captures: [capture], receiverFields: [], receivers: [] };
    });
    const entry = { implementations, environmentIndexes: [] };
    const definition = { storage: { kind: "standalone" }, entries: [entry], bindings: [], environmentParameters: [] };
    return selected(carrier, { evidence: evidence({ frameCallables: { definitionFor: () => definition, entryFor: () => entry } }) });
  };
  assert.equal(run(number).kind, "supported", "all actual alternatives are owned");
  assert.equal(run(borrowed(scopedLifetime)).kind, "unsatisfied", "the second alternative cannot hide a real borrow");
  assert.equal(run({ kind: "closure", args: [], result: number }).kind, "unresolved", "a logical callable is not a physical stored capture proof");
});

test("class factories and instances inspect the actual sealed capture and static-field environment", () => {
  const declaration = {};
  const definition = { declaration, kind: "class", genericParameters: [] };
  const instance = rustSourceTypeCarrier("/source.ts", "Factory", "object", []);
  const constructor = rustClassConstructorTargetType(instance);
  const run = (carrier, stored, instancesUseEnvironment, staticField) => selected(carrier, { evidence: evidence({
    projectTypes: { definitionForCarrier: () => definition, openCarrier: () => instance,
      objectLayoutForDefinition: () => ({ fields: [], indexSignatures: [] }), isPolymorphic: () => false,
      directSupertypes: () => [] },
    classValues: { forDeclaration: () => ({ environment: { genericParameterIndexes: [], instancesUseEnvironment,
      captures: staticField ? [] : [{ carrier: stored }], staticFields: staticField ? [{ carrier: stored }] : [] } }) },
  }) });
  assert.equal(run(constructor, rustStringTargetType(), false, false).kind, "supported", "owned lexical factory environment");
  assert.equal(run(constructor, borrowed(scopedLifetime), false, false).kind, "unsatisfied", "factory retains lexical borrow");
  assert.equal(run(constructor, borrowed(scopedLifetime), false, true).kind, "unsatisfied", "factory retains borrowed static field");
  assert.equal(run(instance, borrowed(scopedLifetime), false, false).kind, "supported", "unused constructor environment is not instance storage");
  assert.equal(run(instance, borrowed(scopedLifetime), true, false).kind, "unsatisfied", "actual instance-retained environment");
  assert.equal(selected(constructor).kind, "unresolved", "constructor signature is not factory storage");
});

test("native factory environment fields use the existing exact class argument binder", () => {
  const definition = { declaration: {}, kind: "class" };
  const open = rustSourceTypeCarrier("/source.ts", "Factory", "object", [{ kind: "type", type: parameter }]);
  const run = argument => {
    const instance = substituteRustTargetTypeParameters(open, new Map([[parameter.identity, argument]]));
    return selected(rustClassConstructorTargetType(instance), { evidence: evidence({
      projectTypes: { definitionForCarrier: () => definition, openCarrier: () => open },
      classValues: { forDeclaration: () => ({ environment: { genericParameterIndexes: [0],
        captures: [{ carrier: parameter }], staticFields: [] } }) },
    }) });
  };
  assert.equal(run(rustStringTargetType()).kind, "supported", "owned instantiated factory");
  assert.equal(run(borrowed(scopedLifetime)).kind, "unsatisfied", "the actual factory argument is borrowed");
  const boundConstructor = rustClassConstructorTargetType(open, [0]);
  const boundEvidence = evidence({ projectTypes: { definitionForCarrier: () => definition, openCarrier: () => open },
    classValues: { forDeclaration: () => ({ environment: { genericParameterIndexes: [], captures: [], staticFields: [] } }) } });
  assert.equal(rustFinalContractSupportsStatic(contract({}), boundConstructor, families, emptyRustTypeDefinitions, boundEvidence).kind,
    "supported", "a constructor's universally bound parameter is not captured storage");
});

test("physical generic argument binding reuses the existing exact type lifetime and const binder", () => {
  const lifetime = { kind: "parameter", identity: "capture:env", name: "env" };
  const constant = { kind: "parameter", identity: "capture:length", name: "Length" };
  const parameters = [{ kind: "type", type: parameter }, { kind: "lifetime", lifetime }, { kind: "const", value: constant }];
  const arguments_ = [{ kind: "type", type: number }, { kind: "lifetime", lifetime: staticLifetime },
    { kind: "const", value: { kind: "integer", value: "3" } }];
  const bound = rustGenericCallablePhysicalBindings(parameters, arguments_);
  assert.equal(bound !== undefined, true, "complete exact binding");
  assert.equal(bound.types.get(parameter.identity) === number, true, "same physical type");
  assert.equal(bound.lifetimes.size, 1, "same physical lifetime");
  assert.equal(bound.consts.get(constant.identity) === arguments_[2].value, true, "same exact const");
  assert.equal(rustGenericCallablePhysicalBindings(parameters, arguments_.slice(1)) === undefined, true, "no shortened argument acceptance");
});

test("real native capture producer supplies owned physical storage without laundering logical signatures", () => {
  const program = analyzeRustErrorEffects(`
    export function make(captured: number): <Value>(value: Value) => number {
      return <Value>(value: Value): number => captured;
    }
  `, { surfaces: [] });
  const declaration = program.sourceStorage.nodes.find(node => program.source.ast.is.IsArrowFunction(node));
  const physical = program.callableValues.selected.nativeCaptures.forDeclaration(declaration);
  assert.equal(physical.kind, "resolved", "actual required producer entry");
  assert.equal(physical.captures.length, 1, "actual captured field remains present");
  assert.equal(Object.isFrozen(physical.captures), true, "physical vector is immutable");
  assert.equal(selected({ kind: "tuple", elements: [...physical.captures, ...physical.receiverFields, ...physical.receivers] }).kind,
    "supported", "actual native owned fields");
  assert.equal(selected(program.records.targetOperation.get(declaration).resultCarrier).kind, "unresolved", "logical generic signature alone is not proof");
  const owner = program.sourceStorage.nodes.find(node => program.source.ast.is.IsFunctionDeclaration(node));
  const stored = program.callableValues.nativeStorage.returnFor(owner);
  assert.equal(stored.kind !== "unresolved", true, "actual returned physical family");
  assert.equal(selected(stored.carrier, { evidence: evidence({ genericCallables: program.callableValues.generic }) }).kind,
    "supported", "actual physical family binds its captured field once");
});

test("the real frame inventory proves the exact emitted fields without a fictitious external self handle", () => {
  const source = recursiveCallbackProtocolCases.find(test => test.name === "captured-class-field")?.source;
  assert.equal(typeof source, "string", "the recorded accepted source premise exists");
  const program = analyzeRustErrorEffects(source, { surfaces: [] });
  const plan = program.callableValues.selected;
  assert.equal(program.diagnostics.length, 0, "the real source premise has no diagnostics");
  assert.equal(plan.frames.definitions.length, 1, "one actual owning activation");
  const classValues = program.classValues.seal(program);
  for (const definition of plan.frames.definitions) for (const entry of definition.entries) {
    assert.equal(definition.bindings.length, 2, "the actual frame stores both seed and its callable entry slot");
    assert.equal(definition.bindings.some(binding => binding.entry === entry), true, "the self slot stores the exact entry enum");
    for (const implementation of entry.implementations) {
      assert.equal(implementation.receiverFields.length, 0, "there is no external self handle in the emitted entry payload");
      assert.equal(implementation.capture.receiverFields.length, 2, "original source capture evidence is not discarded");
      assert.equal(implementation.capture.receiverFields.every(capture =>
        definition.bindings.some(binding => binding.declaration === capture.declaration)), true, "every removed field lives in its actual owning frame");
    }
    assert.equal(selected(entry.implementations[0].carrier, { evidence: evidence({
      frameCallables: plan.frames,
      objectRepresentations: program.objectRepresentations, classValues, projectTypes: program.projectTypes, records: program.records,
    }) }).kind, "supported", "all actual bindings and external state are owned");
  }
});

test("the real class factory plan preserves lexical environment fields before final static validation", () => {
  const program = analyzeRustErrorEffects(`
    export function factory(captured: number) {
      return class Entry { read(): number { return captured; } };
    }
  `, { surfaces: [] });
  const definition = program.projectTypes.definitions.find(definition => definition.kind === "class");
  assert.equal(definition !== undefined, true, "actual local class declaration");
  const classValues = program.classValues.seal(program);
  const environment = classValues.forDeclaration(definition.declaration)?.environment;
  assert.equal(environment !== undefined, true, "sealed actual lexical class environment");
  assert.equal(environment.captures.length, 1, "the lexical capture is not an empty signature");
  const instance = program.projectTypes.openCarrier(definition);
  const context = evidence({ classValues, projectTypes: program.projectTypes, records: program.records,
    objectRepresentations: program.objectRepresentations,
    frameCallables: program.callableValues.selected.frames });
  assert.equal(selected(rustClassConstructorTargetType(instance), { evidence: context }).kind, "supported", "owned native factory storage");
  assert.equal(selected(instance, { evidence: context }).kind, "supported", "actual instance-retained class environment");
});
