import assert from "node:assert/strict";
import test from "node:test";
import { resolvedTargetStage, runTargetCompilationStages } from "@tsonic/target-api/artifacts";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustStructuralViewRequests } from "../../../dist/analysis/objects/structural-demands.js";
import { projectGenericSubstitutions } from "../../../dist/policy/types/project/generic-substitutions.js";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { substituteRustTargetGenerics } from "../../../dist/target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";

const selectedViewSource = `
type Selected<T> = { readonly selected?: T };
class Base<T> {
  value: T;
  constructor(value: T) { this.value = value; }
  get selected(): T { return this.value; }
}
class Box<T> extends Base<T> { constructor(value: T) { super(value); } }
function open<T>(owner: Box<T>): Selected<T> { return owner; }
function closed(): Selected<string> { return new Box<string>("closed"); }
export function run(): boolean {
  const owner = new Box<string>("before");
  const selected: Selected<string> = owner;
  owner.value = "after";
  return selected.selected === "after" && closed().selected === "closed" && open(new Box<number>(3)).selected === 3;
}
`;

const requestInput = program => ({
  views: program.classValues.instanceViewImplementations, projectTypes: program.projectTypes,
  representations: program.objectRepresentations, requirements: program.declarationGenericRequirements,
});

test("an admitted structural view requires its target under the exact representation substitution", () => {
  const { program } = analyzeRust({ files: { "index.ts": selectedViewSource } });
  const [view, ...otherViews] = program.classValues.instanceViewImplementations;
  assert.equal(view !== undefined && otherViews.length === 0, true, "the program admits one structural view implementation");
  const representation = program.objectRepresentations.representationFor(program.projectTypes.definitionForDeclaration(view.declaration));
  const expected = projectGenericSubstitutions(representation.definition, rustSourceTypeCarrierValue(view.sourceCarrier).genericArguments);
  const requests = rustStructuralViewRequests(requestInput(program));
  const required = requests.filter(request => request.required);
  assert.equal(required.length === 1 && required[0].carrier === view.targetCarrier, true, "the view target is the one required request");
  assert.equal(requests.every(request => request.context === requests[0].context), true, "every request of the view shares one selected context");
  const context = requests[0].context;
  assert.equal(context.types.size === expected.types.size && [...expected.types].every(([identity, carrier]) =>
    rustTargetTypeRefEquals(context.types.get(identity), carrier)), true, "the context is the canonical representation type substitution");
  assert.equal(context.lifetimes.size === expected.lifetimes.size, true, "the context carries the canonical lifetime substitution");
  const definitionParameters = representation.definition.genericParameters.filter(parameter => parameter.kind === "type");
  const sourceArguments = rustSourceTypeCarrierValue(view.sourceCarrier).genericArguments.filter(argument => argument.kind === "type");
  assert.equal(definitionParameters.every((parameter, index) => rustTargetTypeRefEquals(context.types.get(parameter.identity), sourceArguments[index].type)),
    true, "each representation parameter maps to the view source argument at its position");
  assert.equal(Object.isFrozen(requests) && requests.every(request => Object.isFrozen(request)), true, "requests are frozen");
  const carriers = requests.map(request => request.carrier);
  const member = view.fields[0];
  const contract = program.declarationGenericRequirements.contractFor(representation.definition.declaration);
  const optionalStorage = contract.optionalStorage.filter(entry => !entry.captured).map(entry => entry.carrier);
  for (const [label, carrier] of [["view source", view.sourceCarrier], ["accessor result", member.accessor.resultCarrier],
    ["read adapter source", member.readAdapter.sourceCarrier], ["read adapter target", member.readAdapter.targetCarrier],
    ...optionalStorage.map(carrier => ["representation optional storage", carrier])]) {
    assert.equal(carriers.includes(carrier), true, `${label} is a request root`);
  }
  assert.equal(optionalStorage.length > 0, true, "the admitted representation carries an optional storage requirement");
  const applied = substituteRustTargetGenerics(view.targetCarrier, context.types, context.lifetimes);
  assert.equal(program.structuralShapes.definitionForCarrier(applied) !== undefined, true, "the published plan holds the context-applied target");
  const undemanded = substituteRustTargetGenerics(view.targetCarrier, new Map([...context.types.keys()].map(identity =>
    [identity, { kind: "type-parameter", identity: "undemanded", name: "Undemanded" }])), new Map());
  assert.equal(program.structuralShapes.definitionForCarrier(undemanded) === undefined, true, "an undemanded instance stays an optional miss");
});

const primitive = name => ({ kind: "source-primitive", name });
const parameter = identity => ({ kind: "type-parameter", identity, name: identity });
const abi = name => ({ form: "value", valueCarrier: primitive(`${name}-value`), parameterCarrier: primitive(`${name}-parameter`), mode: "value" });
const adapter = (name, element) => element === undefined
  ? { kind: "identity", sourceCarrier: primitive(`${name}-source`), targetCarrier: primitive(`${name}-target`) }
  : { kind: "option-map", sourceCarrier: primitive(`${name}-source`), targetCarrier: primitive(`${name}-target`), element };

function internalViewFixture(overrides = {}) {
  const viewDeclaration = { fixture: "view" };
  const definitionDeclaration = { fixture: "definition" };
  const callableDeclaration = { fixture: "callable" };
  const definition = { declaration: definitionDeclaration, genericParameters: overrides.genericParameters ?? [{ kind: "type", identity: "Element" }] };
  const argument = primitive("int32");
  const view = {
    declaration: viewDeclaration,
    sourceCarrier: rustSourceTypeCarrier("/fixture.ts", "Owner", "object", overrides.sourceArguments ?? [{ kind: "type", type: argument }]),
    targetCarrier: rustStructuralObjectTargetType("/fixture.ts", [{ sourceName: "value", type: parameter("Element"), presence: "required", readonly: false }]),
    ownerFileName: "/fixture.ts",
    fields: [
      { declaration: {}, storageIndex: 0, field: { receiverCarrier: primitive("field-receiver"), resultCarrier: primitive("field-result"),
        dispatch: { read: "read", write: "write", ownerCarrier: primitive("field-dispatch") } } },
      { declaration: {}, storageIndex: 1, accessor: { receiver: { kind: "static", typeCarrier: primitive("accessor-static") },
        read: { declaration: {}, method: "get", resultCarrier: primitive("accessor-read") },
        write: { declaration: {}, method: "set", valueCarrier: primitive("accessor-write") },
        dispatch: { ownerCarrier: primitive("accessor-dispatch") }, resultCarrier: primitive("accessor-result") },
        readAdapter: adapter("read", adapter("read-element")) },
      { declaration: {}, storageIndex: 2, callable: { declaration: callableDeclaration, ownerCarrier: primitive("callable-owner"),
        targetName: "call", carrier: primitive("callable-carrier"), parameters: [abi("parameter")],
        parameterAdapters: [
          { kind: "runtime-value", contractParameterIndex: 0, source: abi("runtime-source"), target: abi("runtime-target"), adapter: adapter("runtime") },
          { kind: "logical-value", contractParameterIndex: 1, source: abi("logical-source"), target: abi("logical-target"), adapter: adapter("logical") },
          { kind: "rest-element", contractParameterIndex: 2, offset: 0, source: abi("element-source"), target: abi("element-target"), adapter: adapter("element") },
          { kind: "omitted", target: abi("omitted-target") },
          { kind: "rest", target: abi("rest-target"), segments: [
            { kind: "value", contractParameterIndex: 3, source: abi("segment-source"), adapter: adapter("segment") },
          ] },
        ],
        resultAdapter: adapter("result", adapter("result-element")) } },
    ],
  };
  const declaringOwner = { declaration: { fixture: "declaring-owner" } };
  const relatedTarget = primitive("relationship-target");
  const contract = {
    optionalStorage: [{ carrier: parameter("storage-selected"), captured: false, requirements: [] },
      { carrier: parameter("storage-captured"), captured: true, requirements: [] }],
    associatedTypes: [{ carrier: { kind: "associated-type", owner: parameter("Element"), name: "Output" }, requirements: [], output: primitive("associated-output") },
      { carrier: { kind: "associated-type", owner: parameter("Element"), name: "Plain" }, requirements: [] }],
    projectProjections: [{ sourceCarrier: primitive("projection-source"), targetCarrier: primitive("projection-target"), requiresBound: true }],
  };
  const viewContract = { typeParameters: [], associatedTypes: [{ carrier: { kind: "associated-type", owner: parameter("Element"), name: "View" },
    requirements: [], output: primitive("view-output") }] };
  const input = {
    views: [view],
    projectTypes: {
      definitionForDeclaration: declaration => declaration === viewDeclaration ? definition : undefined,
      definitionContainingDeclaration: declaration => declaration === callableDeclaration ? declaringOwner : undefined,
      relationship: (source, target) => target === declaringOwner && source === view.fields[2].callable.ownerCarrier
        ? { kind: "related", targetType: relatedTarget } : { kind: "unrelated" },
    },
    representations: { representationFor: selected => overrides.withoutRepresentation || selected !== definition ? undefined : { definition } },
    requirements: {
      contractFor: declaration => overrides.withoutContract || declaration !== definitionDeclaration ? undefined : contract,
      contractForStructuralView: selected => selected === view ? viewContract : undefined,
    },
  };
  return { input, view, argument, contract, viewContract, relatedTarget };
}

test("every field, accessor, callable, ABI, adapter and contract root is an optional request in its view context", () => {
  const { input, view, argument, contract, viewContract, relatedTarget } = internalViewFixture();
  const requests = rustStructuralViewRequests(input);
  const abiCarriers = value => [value.valueCarrier, value.parameterCarrier];
  const adapterCarriers = value => [value.sourceCarrier, value.targetCarrier, ...(value.element === undefined ? [] : adapterCarriers(value.element))];
  const [fieldMember, accessorMember, callableMember] = view.fields;
  const callable = callableMember.callable;
  const expected = [
    view.sourceCarrier,
    fieldMember.field.receiverCarrier, fieldMember.field.resultCarrier, fieldMember.field.dispatch.ownerCarrier,
    accessorMember.accessor.resultCarrier, accessorMember.accessor.receiver.typeCarrier, accessorMember.accessor.read.resultCarrier,
    accessorMember.accessor.write.valueCarrier, accessorMember.accessor.dispatch.ownerCarrier, ...adapterCarriers(accessorMember.readAdapter),
    callable.carrier, callable.ownerCarrier, relatedTarget, ...callable.parameters.flatMap(abiCarriers),
    ...abiCarriers(callable.parameterAdapters[0].source), ...abiCarriers(callable.parameterAdapters[0].target), ...adapterCarriers(callable.parameterAdapters[0].adapter),
    ...abiCarriers(callable.parameterAdapters[1].source), ...abiCarriers(callable.parameterAdapters[1].target), ...adapterCarriers(callable.parameterAdapters[1].adapter),
    ...abiCarriers(callable.parameterAdapters[2].source), ...abiCarriers(callable.parameterAdapters[2].target), ...adapterCarriers(callable.parameterAdapters[2].adapter),
    ...abiCarriers(callable.parameterAdapters[3].target),
    ...abiCarriers(callable.parameterAdapters[4].target), ...abiCarriers(callable.parameterAdapters[4].segments[0].source),
    ...adapterCarriers(callable.parameterAdapters[4].segments[0].adapter),
    ...adapterCarriers(callable.resultAdapter),
    contract.optionalStorage[0].carrier,
    contract.associatedTypes[0].carrier, contract.associatedTypes[0].output, contract.associatedTypes[1].carrier,
    contract.projectProjections[0].sourceCarrier, contract.projectProjections[0].targetCarrier,
    viewContract.associatedTypes[0].carrier, viewContract.associatedTypes[0].output,
  ];
  assert.equal(requests[0].carrier === view.targetCarrier && requests[0].required === true, true, "the view target is required first");
  const optional = requests.slice(1);
  assert.equal(optional.every(request => request.required === false), true, "every other root is optional");
  assert.equal(optional.length, expected.length);
  assert.equal(optional.every((request, index) => request.carrier === expected[index]), true,
    "the optional roots are exactly the selected member, ABI, adapter and contract carriers in owner order (internal enumeration fixture, not a source program)");
  assert.equal(optional.some(request => request.carrier === contract.optionalStorage[1].carrier), false, "captured optional storage is not a request root");
  assert.equal(requests.every(request => request.context === requests[0].context), true, "all roots share the view context");
  assert.equal(requests[0].context.types.size === 1 && requests[0].context.types.get("Element") === argument, true,
    "the context maps the representation parameter to the view source argument");
});

const assertAdmittedPremiseFailure = (input, message, declaration) => {
  let compiled;
  try {
    compiled = runTargetCompilationStages({ analyze: () => resolvedTargetStage(rustStructuralViewRequests(input)),
      plan: () => resolvedTargetStage({}), materialize: () => ({ artifacts: [] }) });
  } catch {
    compiled = undefined;
  }
  assert.equal(compiled !== undefined, true, "the missing admitted premise is classified by the shared analysis boundary");
  assert.equal(compiled.kind, "rejected");
  assert.equal(compiled.diagnostics.length, 1);
  const [diagnostic] = compiled.diagnostics;
  assert.equal(diagnostic.code, "TSONIC_INTERNAL_ANALYSIS_INVARIANT");
  assert.equal(diagnostic.source, "tsonic-rust");
  assert.equal(diagnostic.message, message);
  assert.equal(diagnostic.sourceNode === declaration, true, "the failure names the admitted view declaration");
};

test("an admitted view without its representation, canonical generic mapping or requirement contract fails at the analysis publisher", () => {
  const missingRepresentation = internalViewFixture({ withoutRepresentation: true });
  assertAdmittedPremiseFailure(missingRepresentation.input, "An admitted Rust structural view implementation has no object representation.",
    missingRepresentation.view.declaration);
  const missingArgument = internalViewFixture({ sourceArguments: [] });
  assertAdmittedPremiseFailure(missingArgument.input,
    "An admitted Rust structural view implementation does not match its representation's generic declaration.", missingArgument.view.declaration);
  const wrongKind = internalViewFixture({ genericParameters: [{ kind: "lifetime", lifetime: { kind: "parameter", identity: "a", name: "a" } }] });
  assertAdmittedPremiseFailure(wrongKind.input,
    "An admitted Rust structural view implementation does not match its representation's generic declaration.", wrongKind.view.declaration);
  const missingContract = internalViewFixture({ withoutContract: true });
  assertAdmittedPremiseFailure(missingContract.input, "An admitted Rust structural view representation has no sealed generic requirement contract.",
    missingContract.view.declaration);
  assert.equal(rustStructuralViewRequests({ ...internalViewFixture().input, views: [] }).length, 0, "no admitted view produces no request");
});
