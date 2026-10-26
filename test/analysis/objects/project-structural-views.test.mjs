import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { receiverFieldStorageCases } from "../../../../tsonic/test/fixtures/receiver-field-storage-cases.mjs";
import { genericCallableOwnershipCases } from "../../../../tsonic/test/fixtures/generic-callable-ownership.mjs";
import { sourcePackageGraphFixture } from "../../../../tsonic/test/fixtures/source-package-graph.mjs";
import { generalizeRustProjectStructuralView } from "../../../dist/analysis/objects/project-structural-views-generics.js";
import { selectRustProjectStructuralViewFields, selectRustProjectStructuralViewSources } from "../../../dist/analysis/objects/project-structural-views-members.js";
import { rustProjectViewMatches } from "../../../dist/policy/types/objects/project-view-bindings.js";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue, rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";
import { rustStringTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustProgramErrorOwner } from "../../../dist/target-model/types/carriers/program-errors.js";
import { selectRustPhysicalProgramErrorOwner, normalizeRustErrorType } from "../../../dist/analysis/errors/error-types.js";
import { substituteRustTargetGenerics, substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { selectRustCallableValueAdapter } from "../../../dist/policy/conversions/callable-adapters.js";
import { selectRustStructuralDispatchArguments } from "../../../dist/policy/types/objects/structural-generics.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { authoredObjectMethodEvidenceSource } from "../../../../tsonic/test/fixtures/generic-object-methods.mjs";

const parameter = { kind: "type-parameter", identity: "source:Value", name: "Value" };

test("canonical structural publication retains source aliases and rejects missing, duplicate and sealed writes", () => {
  const { program } = analyzeRust({ surfaces: [], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": authoredObjectMethodEvidenceSource + '\nexport function main(): void { if (!run()) throw new Error("authored method evidence"); }\nmain();\n',
  } });
  const canonical = program.structuralShapes.definitionForCarrier;
  const aliases = program.structuralShapes.definitions.flatMap(definition => definition.sourceCarriers);
  const alias = aliases.find(carrier => {
    const selected = canonical(carrier);
    return selected !== undefined && !rustTargetTypeRefEquals(carrier, selected.carrier);
  });
  assert.equal(alias !== undefined, true, "the original fixed native methods have a genuine distinct source-key alias");
  const expected = canonical(alias);
  const owner = createRustProgramRecordBuilder();
  const producer = owner.projectEmissionPlans;
  const invariant = message => error => error.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT" &&
    error.diagnostic.message === message;
  assert.throws(() => owner.structuralShape.get(alias),
    invariant("Native structural lookup requires its sealed canonical publication."));
  assert.equal(Object.hasOwn(producer, "shape"), false, "the superseded instance-replay publisher does not exist");
  producer.structuralShapes(canonical);
  assert.equal(owner.structuralShape.get(alias) === expected, true, "the original source alias retains its exact canonical physical definition");
  assert.equal(owner.structuralShape.get(expected.carrier) === canonical(expected.carrier), true,
    "the physical key reads the same canonical index rather than a copied inventory");
  assert.equal(owner.structuralShape.get(rustStringTargetType()) === undefined, true,
    "a genuine nonstructural carrier cannot manufacture a shape");
  assert.throws(() => producer.structuralShapes(canonical),
    invariant("The sealed canonical structural lookup is published exactly once."));
  owner.seal([]);
  assert.equal(owner.structuralShape.get(alias) === expected, true, "sealed repeated reads preserve native definition identity");
  assert.throws(() => producer.structuralShapes(canonical),
    invariant("Rust semantic plans cannot be written after analysis is sealed."));
});

test("native structural method emission preserves its canonical source field and sealed liveness owner", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
type View = { read(): number; readonly identity: (value: number) => number };
class Box {
  constructor(public value: number) {}
  read(): number { return this.value; }
  identity = (value: number): number => value;
}
function view(owner: Box): View { return owner; }
export function run(): number { return view(new Box(7)).identity(3); }
` } });
  let checked = 0;
  for (const definition of new Set([...program.structuralShapes.definitions, ...program.structuralShapes.instances])) {
    const selected = program.records.structuralShapeEmission.get(definition)?.dispatch;
    if (selected === undefined) continue;
    for (const [index, field] of definition.fields.entries()) {
      if (field.method !== true) continue;
      const member = selected.members.find(member => member.name === field.targetName);
      assert.equal(member?.field?.index === index && member.field.role === "value", true,
        `${field.sourceName}: the native method retains its original structural value slot`);
      assert.equal(program.records.structuralLiveness.get(definition.sourceCarriers, false)?.fields.has(index), true,
        `${field.sourceName}: emission consumes the one existing sealed field-liveness owner`);
      checked++;
    }
  }
  assert.equal(checked > 0, true, "the original checked class and structural view exercise actual native method slots");
});
const otherParameter = { kind: "type-parameter", identity: "destination:Value", name: "Value" };
for (const name of ["supported-nested-payload", "captured-native-constraint", "transitive-native-constraint"]) {
  test(`native generic header structural applications close before publication: ${name}`, () => {
    const original = genericCallableOwnershipCases.find(example => example.name === name);
    assert.notEqual(original, undefined);
    const { program } = analyzeRust({ surfaces: [], files: { "index.ts": original.source + "\nmain();\n" } });
    let checked = 0;
    const admitted = carrier => {
      if (rustStructuralObjectCarrierValue(carrier) === undefined) return;
      assert.equal(program.structuralShapes.definitionForCarrier(carrier) !== undefined, true,
        "the exact native binder application is in the sealed structural publication");
      assert.equal(program.records.typeEmission.get(carrier)?.structural !== undefined, true,
        "TYPE consumes the already admitted native header application without reopening shapes");
      checked++;
    };
    for (const definition of program.callableValues.generic.physical.definitions()) {
      const emission = program.records.genericDefinition.get(definition);
      if (emission?.invoked === true) {
        for (const carrier of [...emission.parameters, emission.result]) admitted(carrier);
      }
      for (const member of definition.members) {
        const implementation = program.records.genericImplementation.get(member.implementation);
        const returned = program.records.sourceCallableReturn.get(member.implementation.declaration);
        assert.equal(implementation !== undefined && returned !== undefined, true, "the real checked native helper is admitted");
        const substitutions = implementation.environment.substitutions;
        admitted(substituteRustTargetGenerics(returned.returnCarrier, substitutions.types, substitutions.lifetimes, substitutions.consts));
      }
    }
    assert.equal(checked > 0, true, "the original program exercises real structural native header applications");
  });
}
const text = { kind: "target-named", id: "rust.std.String" };
const number = { kind: "source-primitive", name: "float64" };
const source = (type, name = "Box") => rustSourceTypeCarrier("/model.ts", name, "object", [{ kind: "type", type }]);
const target = (type, options = {}) => rustStructuralObjectTargetType(options.file ?? "/view.ts", [
  { sourceName: "value", type, presence: options.presence ?? "required", readonly: options.readonly ?? true,
    ...(options.accessor === undefined ? {} : { accessor: options.accessor }) },
]);

for (const surfaces of [[], ["js"]]) test(`native dispatch instances retain canonical generic membership in ${surfaces[0] ?? "native"}`, () => {
  const { program } = analyzeRust({ surfaces, files: { "index.ts": `
type View<Value> = { readonly value: Value; read(): Value; };
class Box<Value> {
  value: Value;
  constructor(value: Value) { this.value = value; }
  read(): Value { return this.value; }
}
function open<Value>(owner: Box<Value>): View<Value> { return owner; }
function closed(): View<number> { return new Box(3); }
export function run(): number { return open(new Box(7)).read() + closed().value; }
` } });
  const definitions = program.structuralShapes.definitions.filter(definition => definition.dispatchName !== undefined);
  assert.equal(definitions.length > 0, true, "the checked native class publishes a structural dispatch declaration");
  let instances = 0;
  for (const definition of definitions) {
    const selected = program.records.structuralShapeEmission.get(definition)?.dispatch;
    assert.equal(selected !== undefined, true, "the canonical declaration has its completed native membership");
    assert.equal(selected.genericParameterIndices.every(index => definition.stateGenericParameters[index]?.kind === "type"), true,
      "receiver-storage lifetimes do not become unused trait ABI parameters");
    assert.equal(selected.genericParameterIndices.length, definition.stateGenericParameters.filter(parameter => parameter.kind === "type").length,
      "all genuine native type parameters remain in the trait contract");
    for (const instance of program.structuralShapes.instances) {
      if (program.structuralShapes.templateForCarrier(instance.carrier) !== definition) continue;
      const current = program.records.structuralShapeEmission.get(instance)?.dispatch;
      assert.equal(current !== undefined, true, "every actual instance has a completed emission selection");
      assert.equal(current.genericParameterIndices.join(","), selected.genericParameterIndices.join(","),
        "substitution cannot change the canonical native trait arity or binder positions");
      instances++;
    }
  }
  assert.equal(instances > 0, true, "closed and original-binder instances actually exercise the same native declaration");
});

test("structural supertrait arguments close only inferred header lifetimes from the native object contract", () => {
  const named = { kind: "parameter", identity: "native:lifetime", name: "native" };
  const known = [
    { kind: "lifetime", lifetime: named },
    { kind: "lifetime", lifetime: { kind: "static" } },
    { kind: "type", type: parameter },
    { kind: "const", value: { kind: "integer", value: "3" } },
  ];
  const placeholders = [
    { kind: "lifetime", lifetime: { kind: "placeholder" } },
    { kind: "lifetime", lifetime: { kind: "call-scoped-elision", callIdentity: "call", parameterIdentity: "input" } },
  ];
  for (const objectLifetime of [named, { kind: "static" }]) {
    const selected = selectRustStructuralDispatchArguments([...known, ...placeholders], objectLifetime);
    assert.equal(selected !== undefined, true, "the actual native contract closes the supertrait header");
    for (const [index, argument] of known.entries()) assert.equal(selected[index] === argument, true,
      `known argument ${index} retains its exact type, const or authored lifetime identity`);
    for (const argument of selected.slice(known.length)) assert.equal(argument.lifetime === objectLifetime, true,
      "the header receives the selected native object lifetime, not an invented static bound");
    assert.equal(Object.isFrozen(selected), true, "the selected header arguments are data only");
    assert.equal(placeholders[0].lifetime.kind, "placeholder", "expression and implementation input carriers remain unchanged");
  }
  assert.equal(selectRustStructuralDispatchArguments(known, undefined)?.every((argument, index) => argument === known[index]), true,
    "a fully authored header needs no substitute object lifetime");
  for (const absent of [undefined, { kind: "placeholder" }, { kind: "call-scoped-elision", callIdentity: "call", parameterIdentity: "input" }]) {
    assert.equal(selectRustStructuralDispatchArguments(placeholders, absent) === undefined, true,
      "unknown native storage never grants static or inferred header lifetime permission");
  }
});

test("native structural view selection instantiates the same exact source and destination binder", () => {
  const view = { sourceCarrier: source(parameter), targetCarrier: target(parameter) };
  for (const type of [text, number, otherParameter]) {
    assert.equal(isRustTargetTypeRef(source(type)), true, "the source uses a valid native carrier");
    assert.equal(isRustTargetTypeRef(target(type)), true, "the destination uses a valid native carrier");
    assert.equal(rustProjectViewMatches(view, source(type), target(type)), true);
  }
  assert.equal(rustProjectViewMatches(view, source(text), target(number)), false);
  assert.equal(rustProjectViewMatches(view, source(otherParameter), target(parameter)), false);
  assert.equal(rustProjectViewMatches(view, source(text, "Other"), target(text)), false);
  assert.equal(rustProjectViewMatches(view, source(text), target(text, { file: "/foreign.ts" })), false);
  assert.equal(rustProjectViewMatches(view, source(text), target(text, { presence: "optional" })), false);
  assert.equal(rustProjectViewMatches(view, source(text), target(text, { readonly: false })), false);
  assert.equal(rustProjectViewMatches({ ...view, targetCarrier: target(otherParameter) }, source(text), target(text)), false);
});

test("monomorphic structural views retain exact carriers without introducing a generic match", () => {
  const view = { sourceCarrier: source(text), targetCarrier: target(text) };
  assert.equal(rustProjectViewMatches(view, source(text), target(text)), true);
  assert.equal(rustProjectViewMatches(view, source(number), target(number)), false);
});

function structuralFieldSelection({ callable = false, accessor = false, nativeReadonly = true,
  optional = !callable, sourceParameter = type => type,
  destinationParameter = type => type, result = type => type } = {}) {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/structural-view",
    compilerOptions: { strict: true, target: "es2022", module: "esnext" }, files: {
      "/structural-view/index.ts": "export class Box<Value> { value!: Value; } export interface View<Value> { value: Value; }",
    } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, "structural selection has an actual checked generic owner");
  const sourceProgram = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/structural-view/index.ts");
  const ast = sourceProgram.ast;
  const declaration = ast.children(file).find(node => ast.is.IsClassDeclaration(node));
  const destinationOwner = ast.children(file).find(node => ast.is.IsInterfaceDeclaration(node));
  assert.equal(declaration !== undefined && destinationOwner !== undefined, true,
    "the actual source and destination retain distinct checked declarations");
  const member = ast.members(declaration)[0];
  const destination = ast.members(destinationOwner)[0];
  const checkedSemantics = sourceProgram.semantics.forFile(file);
  const sourceType = checkedSemantics.declarations.declaredType(declaration);
  const destinationType = checkedSemantics.declarations.declaredType(destinationOwner);
  const destinationMembers = checkedSemantics.types.structuralMembers(destinationType, destinationType, "read");
  assert.equal(destinationMembers.kind, "available", "the checked destination owns its member symbol");
  const symbol = destinationMembers.members[0].destination.property.symbol;
  const storage = createSourceStorageQuery(sourceProgram, sourceProgram.navigation.sourceFiles);
  assert.equal(storage.bindingsForLexicalOwner(member).kind, "resolved",
    "the exact checked generic member owns its real source-storage binding");
  const nativeText = rustStringTargetType();
  const sourceCarrier = callable ? rustCallableTargetType([sourceParameter(parameter)], result(parameter)) : parameter;
  const destinationCarrier = type => callable ? rustCallableTargetType([destinationParameter(type), number], result(type))
    : optional ? rustSourceOptionalTargetType(type) : type;
  const presence = optional ? "optional" : "required";
  const access = accessor ? { getter: true, setter: !nativeReadonly } : undefined;
  const template = target(destinationCarrier(otherParameter), { presence, readonly: nativeReadonly, accessor: access });
  const carrier = target(destinationCarrier(nativeText), { presence, readonly: nativeReadonly, accessor: access });
  const shape = { sourceType: destinationType, carrier, fields: [{ symbols: [symbol], declarations: [destination],
    storageIndex: 0, resultCarrier: destinationCarrier(nativeText), readonly: nativeReadonly, presence,
    ...(access === undefined ? {} : { accessor: access }) }] };
  const definition = { declaration };
  const projectTypes = {
    definitionForCarrier: carrier => {
      const selected = rustSourceTypeCarrierValue(carrier);
      return selected?.fileName === "/model.ts" && selected.typeName === "Box" && selected.shape === "object" ? definition : undefined;
    },
    definitionForDeclaration: node => node === declaration ? definition : undefined,
    definitionContainingDeclaration: node => node === member ? definition : undefined,
    objectLayoutForDefinition: owner => owner === definition ? { declaration, kind: "class",
      fields: [{ declaration: member, sourceName: "value", storageIndex: 0, presence: "required" }], indexSignatures: [] } : undefined,
    isPolymorphic: () => true, openCarrier: () => source(parameter), externalBaseForDefinition: () => undefined,
    relationship: receiver => ({ kind: "related", targetType: receiver }), memberSlotName: (_, access) => `slot_${access}`,
    instantiateMemberCarrier: (_, receiver, declared) => substituteRustTargetTypeParameters(declared,
      new Map([[parameter.identity, receiver.value.genericArguments[0].type]])),
  };
  const semantics = { declarations: { declaredType: node => node === declaration ? sourceType : undefined },
    types: { typeArgumentBindings: () => [], structuralMembers: (_sourceType, _targetType, purpose) => {
      assert.equal(purpose, "read", "a structural view selects an actual readable native member");
      return { kind: "available", destination: { calls: [], constructs: [], indexes: [] },
      members: [{ kind: "present", destination: { declarations: [destination], property: { symbol } },
        source: { read: "field", declarations: [member], getters: [], setters: [], property: { readonly: false } } }] };
    } } };
  // A generalized destination registers its own shape storage as an instance of the view's structural template.
  const registrations = [];
  const sourceTypes = { structuralInstantiations: () => [{ template, instance: carrier }], typeFamilies: { get: () => undefined },
    registerStructuralObject: (shape, registration) => { registrations.push({ shape, registration }); return true; } };
  const walk = { sourceTypes, operationOptions: { projectTypes, sourceTypes, receiverFieldAliases: { aliasFor: () => undefined } },
    context: { ast, projectTypes, typeDefinitions: emptyRustTypeDefinitions, semanticsFor: () => semantics,
      source: sourceProgram, sourceStorage: storage,
      records: createRustRecordFixture({runtimeCarrier: { get: () => ({ carrier: sourceCarrier }) }}),
      classValues: { instanceViewRequests() { assert.fail("selection must not depend on earlier requests"); } } } };
  const selectedSource = source(nativeText);
  const sources = selectRustProjectStructuralViewSources(walk, selectedSource, shape, semantics, sourceType);
  assert.equal(sources !== undefined, true, "the exact selected source field exists");
  const fields = selectRustProjectStructuralViewFields(sources, shape, walk);
  assert.equal(fields !== undefined, true, "the canonical selected optional adapter exists");
  return { view: { declaration, sourceCarrier: selectedSource, targetCarrier: carrier, fields },
    shape, walk, sources, member, nativeText, template, registrations };
}

test("closed optional views select their open adapter without any earlier request", () => {
  const { view, shape, walk, sources } = structuralFieldSelection();
  assert.equal(view.fields[0].readAdapter.kind, "option-some");
  const generalized = generalizeRustProjectStructuralView(view, shape, walk, sources);
  assert.equal(generalized !== undefined, true);
  assert.equal(rustTargetTypeRefEquals(generalized.sourceCarrier, source(parameter)), true);
  assert.equal(generalized.fields[0].readAdapter.kind, "option-some");
  assert.equal(rustTargetTypeRefEquals(generalized.fields[0].readAdapter.element.sourceCarrier, parameter), true);
  assert.equal(rustTargetTypeRefEquals(generalized.fields[0].readAdapter.targetCarrier, rustSourceOptionalTargetType(parameter)), true);
  assert.equal(rustProjectViewMatches(generalized, view.sourceCarrier, view.targetCarrier), true);
});

for (const accessor of [false, true]) for (const nativeReadonly of [false, true]) {
  test(`generic native ${accessor ? "accessor" : "field"} views preserve their ${nativeReadonly ? "read" : "write"} role without rewriting the logical template`, () => {
    const { view, shape, walk, sources, template, registrations } = structuralFieldSelection({ accessor,
      nativeReadonly, optional: nativeReadonly });
    const logical = rustStructuralObjectCarrierValue(template);
    assert.equal(logical !== undefined, true, "the original generic native template is closed data");
    const logicalTemplate = rustStructuralObjectTargetType(logical.ownerFileName, logical.fields.map(field => ({
      ...field, readonly: false,
      ...(field.accessor === undefined ? {} : { accessor: { ...field.accessor, setter: true } }),
    })), logical.representation, logical.construction, logical.bases, logical.implementation);
    const originalField = shape.fields[0];
    walk.sourceTypes.structuralInstantiations = () => [{ template, instance: shape.carrier }];
    const generalized = generalizeRustProjectStructuralView(view, shape, walk, sources);
    assert.equal(generalized !== undefined, true, "the selected native role survives generic inference");
    const physical = rustStructuralObjectCarrierValue(generalized.targetCarrier);
    assert.equal(physical?.fields[0].readonly, nativeReadonly, "generalization retains exactly the selected native writer requirement");
    if (accessor) assert.equal(physical.fields[0].accessor.setter, !nativeReadonly, "the selected native accessor capability is unchanged");
    assert.equal(rustProjectViewMatches(generalized, view.sourceCarrier, view.targetCarrier), true,
      "all native type and role correspondence remains exact");
    const registration = registrations[0];
    assert.equal(registration !== undefined, true, "the generalized native instance is registered before publication");
    assert.equal(registration.registration.kind, "generic-instantiation", "only actual substitution shares native storage");
    assert.equal(registration.registration.template === template, true, "the selected native template owns the actual generic instance");
    assert.equal(registration.shape.sourceType === shape.sourceType, true, "the checked logical source type is unchanged");
    assert.equal(registration.shape.fields[0].declarations === originalField.declarations, true, "member declarations are unchanged");
    assert.equal(registration.shape.fields[0].symbols === originalField.symbols, true, "member symbols are unchanged");
    assert.equal(registration.shape.fields[0].readonly, nativeReadonly, "only the selected native field contract is published");
    assert.equal(rustStructuralObjectCarrierValue(logicalTemplate).fields[0].readonly, false, "logical source mutability is untouched");
    if (accessor) assert.equal(rustStructuralObjectCarrierValue(logicalTemplate).fields[0].accessor.setter, true,
      "the original logical accessor remains writable");
    const wrongRole = target(rustStructuralObjectCarrierValue(view.targetCarrier).fields[0].type, {
      presence: originalField.presence, readonly: !nativeReadonly,
      ...(accessor ? { accessor: { getter: true, setter: nativeReadonly } } : {}),
    });
    assert.equal(rustProjectViewMatches(generalized, view.sourceCarrier, wrongRole), false,
      "a different native writer requirement still fails exact matching");
  });
}

test("native structural sibling roles and generic identities remain independent", () => {
  const fields = (type, readonlyRoles) => ["first", "second"].map((sourceName, index) => ({
    sourceName, type, presence: "required", readonly: readonlyRoles[index],
  }));
  const native = (type, readonlyRoles) => rustStructuralObjectTargetType("/view.ts", fields(type, readonlyRoles));
  const template = native(otherParameter, [false, false]);
  const view = { sourceCarrier: source(parameter), targetCarrier: native(parameter, [true, false]) };
  assert.equal(rustProjectViewMatches(view, source(text), native(text, [true, false])), true,
    "each sibling retains its actual selected native role under the same generic substitution");
  for (const roles of [[true, true], [false, false], [false, true]]) assert.equal(
    rustProjectViewMatches(view, source(text), native(text, roles)), false,
    `sibling native roles ${roles.join(",")} cannot replace the selected contract`);
  assert.equal(rustProjectViewMatches(view, source(text), native(otherParameter, [true, false])), false,
    "native role agreement cannot hide a different generic identity");
  assert.equal(rustStructuralObjectCarrierValue(template).fields.every(field => field.readonly === false), true,
    "neither sibling changes the original writable logical template");
});

test("open structural selection rejects malformed identity and contradictory adapter evidence", () => {
  const { view, shape, walk, sources, nativeText } = structuralFieldSelection();
  const selected = view.fields[0];
  const variants = [
    ["source owner", { ...view, sourceCarrier: source(nativeText, "Other") }],
    ["target identity", { ...view, targetCarrier: target(nativeText) }],
    ["member declaration", { ...view, fields: [{ ...selected, declaration: {} }] }],
    ["member storage", { ...view, fields: [{ ...selected, storageIndex: 1 }] }],
    ["receiver owner", { ...view, fields: [{ ...selected, field: { ...selected.field, receiverCarrier: source(nativeText, "Other") } }] }],
    ["source field carrier", { ...view, fields: [{ ...selected, field: { ...selected.field, resultCarrier: number } }] }],
    ["native storage index", { ...view, fields: [{ ...selected, field: { ...selected.field, storageIndex: 1 } }] }],
    ["native dispatch slot", { ...view, fields: [{ ...selected, field: { ...selected.field,
      dispatch: { ...selected.field.dispatch, read: "foreign_slot" } } }] }],
    ["native dispatch owner", { ...view, fields: [{ ...selected, field: { ...selected.field,
      dispatch: { ...selected.field.dispatch, ownerCarrier: source(nativeText, "Other") } } }] }],
    ["invented identity", { ...view, fields: [{ ...selected, readAdapter: { kind: "identity",
      sourceCarrier: nativeText, targetCarrier: selected.readAdapter.targetCarrier } }] }],
    ["contradictory element", { ...view, fields: [{ ...selected, readAdapter: { ...selected.readAdapter,
      element: { kind: "identity", sourceCarrier: number, targetCarrier: nativeText } } }] }],
  ];
  for (const [label, candidate] of variants) {
    assert.equal(generalizeRustProjectStructuralView(candidate, shape, walk, sources) === undefined, true, label);
  }
  walk.sourceTypes.structuralInstantiations = () => [{ template: shape.carrier, instance: shape.carrier },
    { template: target(parameter), instance: shape.carrier },
    { template: target(otherParameter), instance: shape.carrier }];
  assert.equal(generalizeRustProjectStructuralView(view, shape, walk, sources) === undefined, true, "ambiguous destination templates");
});

test("closed callable-field adapters infer the open binder from selected parameter and result correspondence", () => {
  const { view, shape, walk, sources } = structuralFieldSelection({ callable: true });
  assert.equal(view.fields[0].readAdapter.kind, "conversion");
  assert.equal(view.fields[0].readAdapter.conversion.kind, "callable-adapter");
  const generalized = generalizeRustProjectStructuralView(view, shape, walk, sources);
  assert.equal(generalized !== undefined, true);
  const selected = generalized.fields[0].readAdapter;
  assert.equal(selected.kind, "conversion");
  assert.equal(selected.conversion.kind, "callable-adapter");
  assert.equal(selected.conversion.parameters.length, 1);
  const protocol = rustCallableProtocol(selected.targetCarrier);
  assert.equal(protocol !== undefined, true);
  assert.equal(protocol.parameters.length, 2);
  assert.equal(rustTargetTypeRefEquals(protocol.parameters[0], parameter), true);
  assert.equal(rustTargetTypeRefEquals(protocol.parameters[1], number), true);
  assert.equal(rustTargetTypeRefEquals(protocol.result, parameter), true);
  assert.equal(rustProjectViewMatches(generalized, view.sourceCarrier, view.targetCarrier), true);
  const member = view.fields[0];
  const contradictory = { ...view, fields: [{ ...member, readAdapter: { ...member.readAdapter,
    conversion: { ...member.readAdapter.conversion, parameters: [] } } }] };
  assert.equal(generalizeRustProjectStructuralView(contradictory, shape, walk, sources) === undefined, true,
    "contradictory callable parameter correspondence must reject");
});

for (const [name, sourceParameter, destinationParameter] of [
  ["borrowed input", type => ({ kind: "reference", mutable: false, referent: type }), type => type],
  ["contravariant callback input", type => rustCallableTargetType([type], number),
    type => rustCallableTargetType([{ kind: "reference", mutable: false, referent: type }], number)],
]) {
  test(`closed callable-field ${name} retains the canonical parameter-only borrow correspondence`, () => {
    const { view, shape, walk, sources, nativeText } = structuralFieldSelection({ callable: true,
      sourceParameter, destinationParameter, result: () => number });
    const adapter = view.fields[0].readAdapter;
    assert.equal(adapter.kind, "conversion");
    assert.equal(adapter.conversion.kind, "callable-adapter");
    const parameterConversion = adapter.conversion.parameters[0];
    assert.equal(parameterConversion !== undefined, true);
    assert.equal(parameterConversion.kind, name === "borrowed input" ? "borrow" : "value");
    if (name !== "borrowed input") assert.equal(parameterConversion.conversion.kind, "callable-adapter");
    const borrow = name === "borrowed input" ? parameterConversion : parameterConversion.conversion.parameters[0];
    assert.equal(borrow.kind, "borrow");
    assert.equal(selectRustCallableValueAdapter(nativeText, { kind: "reference", mutable: false, referent: nativeText },
      walk.context.projectTypes, walk.context.typeDefinitions) === undefined, true,
      "parameter-only borrowing must not become a general value adaptation");
    const generalized = generalizeRustProjectStructuralView(view, shape, walk, sources);
    assert.equal(generalized !== undefined, true, "the destination binder must be inferred from the parameter, not the constant result");
    const selected = generalized.fields[0].readAdapter;
    assert.equal(selected.kind, "conversion");
    assert.equal(selected.conversion.kind, "callable-adapter");
    const provided = rustCallableProtocol(selected.sourceCarrier);
    const expected = rustCallableProtocol(selected.targetCarrier);
    assert.equal(provided !== undefined && expected !== undefined, true);
    assert.equal(rustTargetTypeRefEquals(provided.parameters[0], sourceParameter(parameter)), true);
    assert.equal(rustTargetTypeRefEquals(expected.parameters[0], destinationParameter(parameter)), true);
    assert.equal(rustTargetTypeRefEquals(expected.result, number), true);
    assert.equal(rustProjectViewMatches(generalized, view.sourceCarrier, view.targetCarrier), true);
    const member = view.fields[0];
    for (const [label, conversion] of [
      ["invented identity", { ...adapter.conversion, parameters: [{ kind: "identity" }] }],
      ["borrowed result", { ...adapter.conversion, result: { kind: "borrow" } }],
      ["unselected borrow data", { ...adapter.conversion, parameters: [{ ...parameterConversion, referent: number }] }],
    ]) {
      const contradictory = { ...view, fields: [{ ...member,
        readAdapter: { ...adapter, conversion } }] };
      assert.equal(generalizeRustProjectStructuralView(contradictory, shape, walk, sources) === undefined, true, label);
    }
  });
}

test("nonpolymorphic structural implementations keep their selected optional and callable adapters", () => {
  const view = { declaration: {}, sourceCarrier: source(text), targetCarrier: target(text), fields: [{ callable: {} }] };
  const walk = { context: {
    projectTypes: { definitionForDeclaration: () => ({}), isPolymorphic: () => false,
      openCarrier() { assert.fail("a direct concrete root does not require a polymorphic supertrait"); } },
  } };
  assert.equal(generalizeRustProjectStructuralView(view, { carrier: view.targetCarrier }, walk, []) === view, true);
});

for (const surfaces of [[], ["js"]]) {
  for (const order of ["closed-only", "closed-first", "open-first"]) {
    test(`inherited inferred methods select their exact permuted owner binders ${order} in ${surfaces[0] ?? "native"}`, () => {
      const closed = "export function closed(): View<number, string> { return new Box<string, number>(3, 'value'); }";
      const open = "export function open<Outer, Inner>(owner: Box<Outer, Inner>): View<Inner, Outer> { return owner; }";
      const { program } = analyzeRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": `type View<First, Second> = { readonly first?: First; readFirst(): First; readonly second?: Second; readSecond(): Second; writeFirst(value: First): void };
class Base<Left, Right> {
  constructor(public first: Left, public second: Right) {}
  readFirst() { return this.first; }
  readSecond() { return this.second; }
  writeFirst(value: Left): void { this.first = value; }
}
class Box<Outer, Inner> extends Base<Inner, Outer> {
  constructor(first: Inner, second: Outer) { super(first, second); }
}
${order === "open-first" ? `${open}\n${closed}` : order === "closed-first" ? `${closed}\n${open}` : closed}`,
      } });
      const definition = program.projectTypes.definitions.find(entry => entry.sourceName === "Box");
      const base = program.projectTypes.definitions.find(entry => entry.sourceName === "Base");
      assert.equal(definition !== undefined && base !== undefined, true);
      const views = program.classValues.instanceViewImplementations.filter(view => view.declaration === definition.declaration);
      assert.equal(views.length, 1);
      const view = views[0];
      const shape = rustStructuralObjectCarrierValue(view.targetCarrier);
      assert.equal(shape !== undefined, true);
      const physical = program.structuralShapes.definitionForCarrier(view.targetCarrier);
      assert.equal(physical !== undefined, true, "the exact native view has its canonical physical layout");
      for (const field of physical.fields) assert.equal(field.method === true
        ? field.methodPlan?.kind === "native-dispatch" : field.storage === "property", true,
      `${field.sourceName}: the native implementation owns its dispatch or getter, not a callable payload`);
      assert.equal(rustTargetTypeRefEquals(view.sourceCarrier, program.projectTypes.openCarrier(definition)), true);
      for (const [name, parameterIndex] of [["readFirst", 1], ["readSecond", 0]]) {
        const field = shape.fields.find(field => field.sourceName === name);
        const index = shape.fields.indexOf(field);
        const callable = view.fields.find(member => member.storageIndex === index)?.callable;
        assert.equal(callable !== undefined, true, name);
        assert.equal(callable.resultAdapter.sourceCarrier.kind === "type-parameter" &&
          callable.resultAdapter.sourceCarrier.identity === definition.typeParameterIdentities[parameterIndex], true, name);
        assert.equal(rustTargetTypeRefEquals(callable.resultAdapter.targetCarrier, rustCallableProtocol(field.type)?.result), true, name);
        assert.equal(rustTargetTypeRefEquals(callable.ownerCarrier,
          program.projectTypes.relationship(view.sourceCarrier, base).targetType), true, name);
      }
    });
  }
  for (const order of ["closed-only", "closed-first", "open-first"]) {
    test(`polymorphic constant method and optional member selection is ${order} in ${surfaces[0] ?? "native"}`, () => {
      const closed = "export function closed(): Tagged { return new Box<string>('value'); }";
      const open = "export function open<T>(owner: Box<T>): Tagged { return owner; }";
      const { program } = analyzeRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": `type Tagged = { tag(): string; readonly label?: string };
class Base {}
class Box<T> extends Base {
  label: string = 'tag';
  constructor(public value: T) { super(); }
  tag(): string { return this.label; }
}
${order === "open-first" ? `${open}\n${closed}` : order === "closed-first" ? `${closed}\n${open}` : closed}`,
      } });
      const definition = program.projectTypes.definitions.find(entry => entry.sourceName === "Box");
      assert.equal(definition !== undefined, true);
      const views = program.classValues.instanceViewImplementations.filter(view => view.declaration === definition.declaration);
      assert.equal(views.length, 1);
      const view = views[0];
      assert.equal(rustTargetTypeRefEquals(view.sourceCarrier, program.projectTypes.openCarrier(definition)), true);
      assert.equal(rustTargetGenericReferences(view.targetCarrier).typeIdentities.length, 0);
      const physical = program.structuralShapes.definitionForCarrier(view.targetCarrier);
      assert.equal(physical !== undefined, true, "the non-generic native view has its canonical physical layout");
      for (const field of physical.fields) assert.equal(field.method === true
        ? field.methodPlan?.kind === "native-dispatch" : field.storage === "property", true,
      `${field.sourceName}: native method and optional getter selections have no stored callable environment`);
      const method = view.fields.find(field => field.callable !== undefined);
      const optional = view.fields.find(field => field.readAdapter !== undefined);
      assert.equal(method !== undefined && optional !== undefined, true);
      assert.equal(method.callable.resultAdapter.kind, "identity");
      assert.equal(optional.readAdapter.kind, "option-some");
      assert.equal(optional.readAdapter.element.kind, "identity");
    });
  }
  for (const order of ["closed-first", "open-first"]) {
    test(`polymorphic dependent methods and callable fields retain exact binder selection ${order} in ${surfaces[0] ?? "native"}`, () => {
      const closed = "export function closed(): Values<string> { return new Box<string>('value'); }";
      const open = "export function open<T>(owner: Box<T>): Values<T> { return owner; }";
      const { program } = analyzeRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": `type Values<T> = { readonly value?: T; read(): T | undefined; write(value: T): void; readonly identity: (value: T) => T; readonly adapted: (value: T, ignored: number) => T };
class Base<T> {
  constructor(public value: T) {}
  read(): T { return this.value; }
  write(value: T): void { this.value = value; }
}
class Box<T> extends Base<T> {
  constructor(value: T) { super(value); }
  identity = (value: T): T => value;
  adapted = (value: T): T => value;
}
${order === "open-first" ? `${open}\n${closed}` : `${closed}\n${open}`}`,
      } });
      const definition = program.projectTypes.definitions.find(entry => entry.sourceName === "Box");
      assert.equal(definition !== undefined, true);
      const views = program.classValues.instanceViewImplementations.filter(view => view.declaration === definition.declaration);
      assert.equal(views.length, 1);
      const view = views[0];
      assert.equal(rustTargetTypeRefEquals(view.sourceCarrier, program.projectTypes.openCarrier(definition)), true);
      assert.deepEqual(rustTargetGenericReferences(view.targetCarrier).typeIdentities, definition.typeParameterIdentities);
      const shape = rustStructuralObjectCarrierValue(view.targetCarrier);
      assert.equal(shape !== undefined, true);
      for (const [index, field] of shape.fields.entries()) {
        const member = view.fields.find(member => member.storageIndex === index);
        assert.equal(member !== undefined, true, field.sourceName);
        const adapter = member.callable?.resultAdapter ?? member.readAdapter;
        const protocol = member.callable === undefined ? undefined : rustCallableProtocol(field.type);
        assert.equal(adapter !== undefined && rustTargetTypeRefEquals(adapter.targetCarrier,
          member.callable === undefined ? field.type : protocol?.result), true, field.sourceName);
        if (member.callable !== undefined) {
          assert.equal(protocol !== undefined, true, field.sourceName);
          assert.equal(member.callable.parameters.length, protocol.parameters.length, field.sourceName);
          for (const [parameterIndex, selectedParameter] of member.callable.parameters.entries()) {
            assert.equal(rustTargetTypeRefEquals(selectedParameter.parameterCarrier, protocol.parameters[parameterIndex]), true, field.sourceName);
          }
        }
      }
      assert.equal(view.fields.filter(field => field.readAdapter?.kind === "option-some").length, 1);
      assert.equal(view.fields.some(field => field.callable?.resultAdapter.kind === "option-some"), true);
      assert.equal(view.fields.some(field => field.readAdapter?.kind === "conversion" && field.readAdapter.conversion.kind === "callable-adapter"), true);
      const dispatch = program.records.projectDispatchEmission.get(definition);
      assert.equal(dispatch !== undefined, true, "the complete structural supertrait contract is published before the seal");
      assert.equal(dispatch.structuralSupers.length, 1, "the original structural supertrait remains in the native class contract");
      const physical = program.structuralShapes.definitionForCarrier(view.targetCarrier);
      assert.equal(physical !== undefined, true, "the logical view retains its canonical physical structural owner");
      for (const supertrait of dispatch.structuralSupers) {
        assert.equal(rustTargetTypeRefEquals(supertrait.carrier, physical.carrier), true,
          "the exact physical structural carrier includes its selected error owner and unchanged binder");
        assert.equal(supertrait.genericArguments.every(argument => argument.kind !== "lifetime" ||
          argument.lifetime.kind !== "placeholder" && argument.lifetime.kind !== "call-scoped-elision"), true,
          "supertrait headers contain no unnameable expression lifetimes");
        assert.equal(Object.isFrozen(supertrait.genericArguments), true, "the renderer consumes sealed header arguments");
        assert.equal(supertrait.genericArguments.length > 0, true, "the exact generic class binder remains present");
      }
    });
  }
}

for (const surfaces of [[], ["js"]]) {
  test(`native view getters publish actual stored callable environments before structural close in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
type View<T> = { readonly identity: (value: T) => T; readonly adapted: (value: T, extra: number) => T; read(): T };
class Box<T> {
  constructor(public value: T) {}
  identity = (value: T): T => value;
  adapted = (value: T): T => value;
  read(): T { return this.value; }
}
export function view<T>(owner: Box<T>): View<T> { return owner; }
export function main(): string { return view(new Box<string>("value")).identity("checked"); }
` } });
    const owner = program.projectTypes.definitions.find(definition => definition.sourceName === "Box");
    assert.equal(owner !== undefined, true, "the checked class owns the physical stored fields");
    const logical = program.classValues.instanceViewImplementations.find(view => view.declaration === owner.declaration);
    assert.equal(logical !== undefined, true, "the original source view remains available");
    const file = program.source.ast.getFileName(program.source.ast.getSourceFile(owner.declaration));
    const emitted = program.records.structuralViewImplementations.get(owner.declaration, file);
    assert.equal(emitted?.length, 1, "the complete native implementation has one publication");
    const selected = emitted[0];
    assert.equal(selected.targetCarrier === logical.targetCarrier, true, "native completion does not overwrite the logical view key");
    const shape = program.structuralShapes.definitionForCarrier(selected.nativeTargetCarrier);
    assert.equal(shape !== undefined, true, "the exact completed native getter carrier is admitted before close");
    for (const name of ["identity", "adapted"]) {
      const original = rustStructuralObjectCarrierValue(logical.targetCarrier).fields.find(field => field.sourceName === name);
      const native = shape.fields.find(field => field.sourceName === name);
      const member = selected.fields.find(field => field.storageIndex === shape.fields.indexOf(native));
      const originalProtocol = rustCallableProtocol(original.type);
      const nativeProtocol = rustCallableProtocol(native.carrier);
      const adapterProtocol = rustCallableProtocol(member.readAdapter.targetCarrier);
      const errorOwner = rustProgramErrorOwner(adapterProtocol.error);
      assert.equal(errorOwner?.kind, "physical", `${name}: the fixed getter uses its actual native error owner`);
      assert.equal(member.readAdapter.kind === "conversion" && member.readAdapter.conversion.kind === "callable-adapter", true,
        `${name}: infallible stored callables are admitted through the exact fixed getter adapter`);
      const contract = program.records.callableContract.get(member.declaration, member.readAdapter.conversion);
      assert.equal(contract?.physical.eliminatedInvokeError, true, `${name}: the existing adapter eliminates the impossible stored error`);
      assert.equal(originalProtocol.lifetime.kind, "parameter", `${name}: exported view has an actual retained environment parameter`);
      assert.deepEqual(nativeProtocol.lifetime, originalProtocol.lifetime, `${name}: native getters preserve the selected retained lifetime identity`);
      assert.equal(rustTargetTypeRefEquals(native.carrier, rustCallableTargetType(adapterProtocol.parameters,
        adapterProtocol.result, nativeProtocol.lifetime, adapterProtocol.error)), true,
        `${name}: native getter preserves the complete selected error, parameter and result contract`);
      assert.equal(selected.nativeOutlives.some(requirement =>
        rustTargetTypeRefEquals(requirement.carrier, member.readAdapter.sourceCarrier) &&
        requirement.lifetime.identity === nativeProtocol.lifetime.identity), true,
        `${name}: the actual physical storage outlives the published native getter environment`);
      assert.equal(selected.nativeLifetimes.some(lifetime => lifetime.identity === nativeProtocol.lifetime.identity), true,
        `${name}: the implementation declares its actual additional native lifetime`);
    }
    const template = program.structuralShapes.templateForCarrier(selected.nativeTargetCarrier);
    const dispatch = program.records.structuralShapeEmission.get(template).dispatch;
    assert.equal(dispatch.lifetime.kind, "parameter", "the canonical template retains its independent receiver lifetime");
    assert.equal(template.genericParameters.filter(parameter => parameter.kind === "lifetime").length, 3,
      "the canonical template preserves its receiver and two independent callable-data lifetimes");
    assert.equal(Object.isFrozen(selected), true, "the native renderer consumes the completed immutable publication");
  });

  test(`generic live structural views use the class binder instead of a selected String supertrait in ${surfaces[0] ?? "native"}`, () => {
    const example = receiverFieldStorageCases.find(entry => entry.name === "generic-deferred-non-copy-view");
    assert.equal(example !== undefined, true);
    const { program } = analyzeRust({ surfaces, files: { "index.ts": example.source } });
    const definition = program.projectTypes.definitions.find(entry => entry.sourceName === "Box");
    assert.equal(definition !== undefined, true, "the exact Box source owner exists");
    const views = program.classValues.instanceViews.filter(view => view.declaration === definition.declaration);
    assert.equal(views.length > 0, true, "the requested native live view exists");
    for (const view of views) {
      assert.equal(rustTargetTypeRefEquals(view.sourceCarrier, program.projectTypes.openCarrier(definition)), true,
        "the native view implementation uses the open class owner");
      assert.deepEqual(rustTargetGenericReferences(view.targetCarrier).typeIdentities, definition.typeParameterIdentities);
      const shape = rustStructuralObjectCarrierValue(view.targetCarrier);
      assert.equal(shape !== undefined, true);
      assert.equal(shape.fields.length, 1);
      assert.equal(view.fields[0].readAdapter.kind, "identity");
      assert.equal(view.fields[0].field !== undefined, true, "the exact selected source field remains available");
      assert.equal(rustTargetTypeRefEquals(view.fields[0].field.resultCarrier, shape.fields[0].type), true,
        "the native selected member and destination storage share the same exact binder");
      assert.equal(view.fields[0].field.dispatch !== undefined, true, "live nominal dispatch remains intact");
    }
    assert.equal(program.classValues.instanceViewImplementations.filter(view => view.declaration === definition.declaration).length, 1,
      "closed requests share one native generic implementation");
  });
}

for (const [form, body] of [
  ["stored-field", "identity = (value: string): string => value;"],
  ["accessor", "get identity(): (value: string) => string { return (value: string): string => value; }"],
  ["throwing-accessor", "reject = false; get identity(): (value: string) => string { if (this.reject) throw new RootFailure(\"getter\"); return (value: string): string => value; }"],
]) test(form === "stored-field" ? "fixed structural callable getters retain the destination component's physical error owner"
  : `callable ${form} getters retain independent source access and destination invocation errors`, () => {
  const dependencyFile = "node_modules/@acme/views/index.ts";
  const { program } = analyzeRust({ sourcePackages: sourcePackageGraphFixture(["index.ts"], {
    "@acme/views": { files: ["index.ts"], dependencies: [] },
  }), files: {
    "node_modules/@acme/views/package.json": JSON.stringify({ name: "@acme/views", version: "1.0.0", type: "module",
      exports: { ".": "./index.ts" } }),
    [dependencyFile]: `
      export type View = { readonly identity: (value: string) => string };
      export class ViewFailure extends Error {}
      export function rejectView(): void { throw new ViewFailure("view"); }
    `,
    "index.ts": `
      import type { View } from "@acme/views";
      export class RootFailure extends Error {}
      export function rejectRoot(): void { throw new RootFailure("root"); }
      export class Box { ${body} }
      export function view(owner: Box): View { return owner; }
    `,
  } });
  const definition = program.projectTypes.definitions.find(definition => definition.sourceName === "Box");
  assert.equal(definition !== undefined, true, "the implementing class belongs to the root component");
  const logical = program.classValues.instanceViewImplementations.find(view => view.declaration === definition.declaration);
  assert.equal(logical !== undefined, true, "the checked imported structural destination is retained");
  const selected = program.records.structuralViewImplementations.get(definition.declaration, logical.ownerFileName);
  assert.equal(selected?.length, 1, "one complete physical implementation is published");
  const shape = program.structuralShapes.definitionForCarrier(selected[0].nativeTargetCarrier);
  assert.equal(shape !== undefined && shape.componentId !== program.sourcePackageComponents.rootComponentId, true,
    "the getter contract is owned by the dependency, not by its implementing class");
  const ownerFile = program.sourceFiles.find(file => program.source.ast.getFileName(file) === shape.ownerFileName);
  assert.equal(ownerFile !== undefined, true, "the exact authored destination owner is present");
  const owner = selectRustPhysicalProgramErrorOwner(ownerFile, { ast: program.source.ast, components: program.sourcePackageComponents });
  assert.equal(owner?.kind === "physical" && owner.domain === "project" && owner.componentId === shape.componentId, true,
    "the dependency retains its independent native error domain");
  const member = selected[0].fields.find(field => field.readAdapter !== undefined);
  assert.equal(member !== undefined, true, "the stored callable has one selected getter adapter");
  const error = rustProgramErrorOwner(rustCallableProtocol(member.readAdapter.targetCarrier)?.error);
  assert.equal(error?.kind === "physical" && error.domain === "project" && error.componentId === owner.componentId, true,
    "the adapter uses the destination's physical owner without forwarding to the root");
  const physical = rustProgramErrorOwner(rustCallableProtocol(shape.fields[member.storageIndex].carrier)?.error);
  assert.equal(physical?.kind === "physical" && physical.domain === "project" && physical.componentId === error.componentId, true,
    "the physical trait getter and its adapter publish the identical error owner");
  if (form !== "stored-field") {
    const getter = member.accessor?.read?.declaration;
    assert.equal(getter !== undefined && program.source.ast.is.IsGetAccessorDeclaration(getter), true,
      `${form}: this proof reaches the real accessor route rather than the stored-field control`);
    const result = program.callableValues.nativeProducers.invocationResultFor(getter);
    assert.equal(result !== undefined, true, `${form}: the actual native getter publishes its sealed result ABI`);
    const instantiated = program.projectTypes.instantiateMemberCarrier(getter, logical.sourceCarrier, result);
    assert.equal(instantiated !== undefined, true, `${form}: the actual checked class instantiates its getter result`);
    const expected = normalizeRustErrorType(instantiated, { ast: program.source.ast, records: program.records,
      components: program.sourcePackageComponents, producers: program.callableValues.nativeProducers,
      definitions: program.typeDefinitions }, getter);
    assert.equal(expected !== undefined && rustTargetTypeRefEquals(member.readAdapter.sourceCarrier, expected), true,
      `${form}: adaptation starts from the identical actual physical getter result, not its logical annotation`);
    const accessError = program.records.errorMemberOwner.get(getter);
    assert.equal(accessError?.kind === "physical" && accessError.domain === "project" &&
      accessError.componentId === program.sourcePackageComponents.rootComponentId, true,
      `${form}: the outer access channel retains the implementing getter's root component`);
    assert.equal(accessError.componentId !== error.componentId, true,
      `${form}: access and stored callable invocation never borrow each other's component`);
    assert.equal(program.records.fallible.get(getter) !== undefined, form === "throwing-accessor",
      `${form}: the actual outer getter fallibility remains independent of the returned callback`);
  }
});
