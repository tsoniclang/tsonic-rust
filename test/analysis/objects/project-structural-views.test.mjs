import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { receiverFieldStorageCases } from "../../../../tsonic/test/fixtures/receiver-field-storage-cases.mjs";
import { generalizeRustProjectStructuralView } from "../../../dist/analysis/objects/project-structural-views-generics.js";
import { selectRustProjectStructuralViewFields, selectRustProjectStructuralViewSources } from "../../../dist/analysis/objects/project-structural-views.js";
import { rustProjectViewMatches } from "../../../dist/analysis/objects/view-implementations.js";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue, rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";
import { rustStringTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { selectRustCallableValueAdapter } from "../../../dist/analysis/callables/adapters.js";

const parameter = { kind: "type-parameter", identity: "source:Value", name: "Value" };
const otherParameter = { kind: "type-parameter", identity: "destination:Value", name: "Value" };
const text = { kind: "target-named", id: "rust.std.String" };
const number = { kind: "source-primitive", name: "float64" };
const source = (type, name = "Box") => rustSourceTypeCarrier("/model.ts", name, "object", [{ kind: "type", type }]);
const target = (type, options = {}) => rustStructuralObjectTargetType(options.file ?? "/view.ts", [
  { sourceName: "value", type, presence: options.presence ?? "required", readonly: options.readonly ?? true },
]);

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

function structuralFieldSelection({ callable = false, sourceParameter = type => type,
  destinationParameter = type => type, result = type => type } = {}) {
  const declaration = { kind: "KindClassDeclaration" };
  const name = { kind: "KindIdentifier", text: "value" };
  const member = { kind: "KindPropertyDeclaration", name, parent: declaration };
  const destination = { kind: "KindPropertySignature", name };
  const symbol = {};
  const sourceType = {};
  const destinationType = {};
  const nativeText = rustStringTargetType();
  const sourceCarrier = callable ? rustCallableTargetType([sourceParameter(parameter)], result(parameter)) : parameter;
  const destinationCarrier = type => callable ? rustCallableTargetType([destinationParameter(type), number], result(type)) : rustSourceOptionalTargetType(type);
  const presence = callable ? "required" : "optional";
  const template = target(destinationCarrier(otherParameter), { presence });
  const carrier = target(destinationCarrier(nativeText), { presence });
  const shape = { sourceType: destinationType, carrier, fields: [{ symbols: [symbol], declarations: [destination],
    storageIndex: 0, resultCarrier: destinationCarrier(nativeText), readonly: true, presence }] };
  const definition = { declaration };
  const ast = { kindName: node => node.kind, name: node => node.name, text: node => node.text,
    parent: node => node.parent, members: node => node === declaration ? [member] : [],
    parameters: () => [], hasModifierKind: () => false, questionToken: () => undefined };
  const projectTypes = {
    definitionForCarrier: carrier => {
      const selected = rustSourceTypeCarrierValue(carrier);
      return selected?.fileName === "/model.ts" && selected.typeName === "Box" && selected.shape === "object" ? definition : undefined;
    },
    definitionForDeclaration: node => node === declaration ? definition : undefined,
    definitionContainingDeclaration: node => node === member ? definition : undefined,
    isPolymorphic: () => true, openCarrier: () => source(parameter), externalBaseForDefinition: () => undefined,
    relationship: receiver => ({ kind: "related", targetType: receiver }), memberSlotName: (_, access) => `slot_${access}`,
    instantiateMemberCarrier: (_, receiver, declared) => substituteRustTargetTypeParameters(declared,
      new Map([[parameter.identity, receiver.value.genericArguments[0].type]])),
  };
  const semantics = { declarations: { declaredType: node => node === declaration ? sourceType : undefined },
    types: { typeArgumentBindings: () => [], structuralMembers: () => ({ kind: "available", destination: { calls: [], constructs: [], indexes: [] },
      members: [{ kind: "present", destination: { declarations: [destination], property: { symbol } },
        source: { read: "field", declarations: [member], getters: [], setters: [], property: { readonly: false } } }] }) } };
  const sourceTypes = { structuralInstantiations: () => [{ template, instance: carrier }], typeFamilies: { get: () => undefined } };
  const walk = { sourceTypes, operationOptions: { projectTypes, sourceTypes, receiverFieldAliases: { aliasFor: () => undefined } },
    context: { ast, projectTypes, typeDefinitions: emptyRustTypeDefinitions, semanticsFor: () => semantics,
      facts: { getRuntimeCarrierFact: () => ({ carrier: sourceCarrier }) },
      classValues: { instanceViewRequests() { assert.fail("selection must not depend on earlier requests"); } } } };
  const selectedSource = source(nativeText);
  const sources = selectRustProjectStructuralViewSources(walk, selectedSource, shape, semantics, sourceType);
  assert.equal(sources !== undefined, true, "the exact selected source field exists");
  const fields = selectRustProjectStructuralViewFields(sources, shape, walk);
  assert.equal(fields !== undefined, true, "the canonical selected optional adapter exists");
  return { view: { declaration, sourceCarrier: selectedSource, targetCarrier: carrier, fields }, shape, walk, sources, member, nativeText };
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
    { template: target(parameter), instance: shape.carrier }, { template: target(otherParameter), instance: shape.carrier }];
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
    });
  }
}

for (const surfaces of [[], ["js"]]) {
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
