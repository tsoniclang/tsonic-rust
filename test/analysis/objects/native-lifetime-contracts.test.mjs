import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram, sourceProjectFiles, Node_Initializer } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { checkRustSession, createRustSession } from "../../helpers/rust-session.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { createRustObjectRepresentationPlanRegistry, prepareRustObjectNativeLifetimes } from "../../../dist/analysis/project-types/object-representation.js";
import { rustRetainedValueLifetime } from "../../../dist/analysis/callables/retained-values.js";
import { emptyRustLifetimeIndex } from "../../../dist/target-model/lifetimes/index.js";
import { rustSourceTypeCarrier } from "../../../dist/target-model/types/carriers/source-types.js";

test("native object lifetime facts prepare once without inventing named type outlives guarantees", () => {
  const parameter = Object.freeze({ kind: "type", identity: "source:Value", outlives: [] });
  const lifetime = Object.freeze({ kind: "parameter", identity: "source:Life", name: "Life" });
  const owned = Object.freeze({ declaration: {}, genericParameters: [parameter] });
  const named = Object.freeze({ declaration: {}, genericParameters: [parameter,
    { kind: "lifetime", lifetime, outlives: [] }] });
  const plain = Object.freeze({ declaration: {}, genericParameters: [parameter] });
  const projectTypes = { definitions: [owned, named, plain], isPolymorphic: definition => definition !== plain };
  const registry = createRustObjectRepresentationPlanRegistry();
  assert.throws(() => registry.nativeLifetimeFor(owned), /before construction lifetime selection/u,
    "construction cannot silently replace an unfinished native contract with authored evidence");
  registry.prepareNativeLifetimes(projectTypes);
  const selected = registry.nativeLifetimeFor(owned);
  assert.equal(selected.dispatchObjectLifetime.kind, "static", "the native open object has its exact static dispatch contract");
  assert.equal(selected.typeOutlives.length, 1, "only the actual original type binder receives the native guarantee");
  assert.equal(selected.typeOutlives[0].identity, parameter.identity, "native bounds preserve the original binder identity");
  assert.equal(selected.typeOutlives[0].lifetime.kind, "static", "the guaranteed bound is exactly static");
  assert.equal(registry.nativeLifetimeFor(named).dispatchObjectLifetime === lifetime, true, "named dispatch retains its actual source lifetime");
  assert.equal(registry.nativeLifetimeFor(named).typeOutlives.length, 0, "named dispatch does not manufacture a T outlives Life guarantee");
  assert.equal(registry.nativeLifetimeFor(named).ownedCallableFieldLifetime === undefined, true, "named class storage is not retagged static");
  assert.equal(registry.nativeLifetimeFor(plain).typeOutlives.length, 0, "ordinary class arguments are not universally static");
  assert.equal(registry.nativeLifetimeFor(plain).ownedCallableFieldLifetime.kind, "static", "an owned field has a separate destination requirement");
  assert.equal(registry.nativeLifetimeFor(owned) === selected, true, "the prepared native decision has one immutable identity");
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.typeOutlives) && Object.isFrozen(selected.typeOutlives[0]), true,
    "all published native lifetime evidence is immutable");
  assert.throws(() => registry.prepareNativeLifetimes(projectTypes), /prepare once/u, "the native policy is not recomputed by later construction");
  const inventory = prepareRustObjectNativeLifetimes(projectTypes);
  assert.equal(typeof inventory.set, "undefined", "the prepared inventory publishes no mutator");
  assert.equal(inventory.get({ ...owned }) === undefined, true, "a same-shaped foreign owner cannot borrow native evidence");
});

test("field construction separates required native storage from authored signature and borrowed capture evidence", () => {
  const checked = checkRustSession(createRustSession({ files: { "index.ts": `
    class Holder<Value> {
      value!: Value;
      read = () => this.value;
      values = [this.value];
      make() { return () => this.value; }
    }
  ` } }));
  const source = createTargetSourceProgram(checked);
  const storage = createSourceStorageQuery(source, sourceProjectFiles(checked));
  const ast = source.ast;
  const declaration = storage.nodes.find(node => ast.is.IsClassDeclaration(node));
  const field = storage.nodes.find(node => ast.is.IsPropertyDeclaration(node) && ast.text(ast.name(node)) === "read");
  const valuesField = storage.nodes.find(node => ast.is.IsPropertyDeclaration(node) && ast.text(ast.name(node)) === "values");
  const arrow = Node_Initializer(ast, field);
  const nested = storage.nodes.find(node => ast.is.IsArrowFunction(node) && node !== arrow);
  const values = storage.nodes.find(node => ast.is.IsArrayLiteralExpression(node));
  const parameterNode = ast.typeParameters(declaration)[0];
  assert.equal(field !== undefined && arrow !== undefined && nested !== undefined && parameterNode !== undefined, true,
    "the inverse controls retain their actual checked class, field, callable and binder occurrences");
  const parameter = Object.freeze({ kind: "type", declaration: parameterNode, identity: "source:Value", sourceName: "Value",
    targetName: "Value", outlives: [], maybeSized: false });
  const definition = Object.freeze({ declaration, genericParameters: [parameter] });
  const value = Object.freeze({ kind: "type-parameter", identity: parameter.identity, name: "Value" });
  const carrier = rustSourceTypeCarrier(ast.getFileName(ast.getSourceFile(declaration)), "Holder", "object", [{ kind: "type", type: value }]);
  const contract = Object.freeze({ declaration, parameters: [parameter] });
  const context = { ast, source, records: createRustRecordFixture(),
    sourceLifetimes: { ...emptyRustLifetimeIndex, contractFor: node => node === declaration ? contract : undefined },
    retainedEnvironments: { environmentFor: () => ({ kind: "none" }) } };
  const projectTypes = { definitions: [definition], isPolymorphic: () => false,
    definitionForCarrier: selected => selected === carrier ? definition : undefined,
    definitionContainingDeclaration: selected => selected === field || selected === valuesField ? definition : undefined,
    objectLayoutForDefinition: selected => selected === definition ? { fields: [{ declaration: field }, { declaration: valuesField }] } : undefined };
  const objectRepresentations = createRustObjectRepresentationPlanRegistry();
  assert.equal(rustRetainedValueLifetime(arrow, [carrier], { context }, { kind: "signature" }).kind, "call-scoped-elision",
    "signature resolution never reads an unfinished native representation or invents an authored outlives bound");
  const native = { kind: "construction", projectTypes, objectRepresentations };
  assert.throws(() => rustRetainedValueLifetime(arrow, [carrier], { context }, native), /before construction lifetime selection/u,
    "actual construction requires the prepared owning native fact");
  objectRepresentations.prepareNativeLifetimes(projectTypes);
  assert.equal(rustRetainedValueLifetime(arrow, [carrier], { context }, native).kind, "static",
    "the actual owned field selects its required native destination and leaves bounds to capture admission");
  assert.equal(rustRetainedValueLifetime(nested, [carrier], { context }, native).kind, "call-scoped-elision",
    "a nested local callable cannot borrow the field initializer's destination requirement");
  assert.equal(values !== undefined, true, "the non-callable field has its own actual stored expression");
  assert.equal(rustRetainedValueLifetime(values, [carrier], { context }, native).kind, "call-scoped-elision",
    "an ordinary array field does not acquire a callable-field-only native requirement");
  const lifetime = Object.freeze({ kind: "parameter", identity: "actual:borrow", name: "borrow" });
  const borrowed = { kind: "reference", referent: { kind: "source-primitive", name: "int32" }, mutable: false, lifetime };
  assert.equal(rustRetainedValueLifetime(arrow, [carrier, borrowed], { context }, native)?.kind === "static", false,
    "a concrete borrowed capture is never turned into a proven static field environment");
  assert.equal(parameter.outlives.length, 0, "native storage selection never mutates the authored generic contract");
});

test("native captured object guarantees follow exact actual generic arguments and retain concrete borrows", () => {
  const checked = checkRustSession(createRustSession({ files: { "index.ts": "function make() { return () => 1; }" } }));
  const source = createTargetSourceProgram(checked);
  const storage = createSourceStorageQuery(source, sourceProjectFiles(checked));
  const declaration = storage.nodes.find(node => source.ast.is.IsArrowFunction(node));
  assert.equal(declaration !== undefined, true, "the source owns the actual returned callable occurrence");
  const parameter = { kind: "type", identity: "native:Value", sourceName: "Value", targetName: "Value", outlives: [] };
  const definition = { declaration: {}, genericParameters: [parameter] };
  const argument = { kind: "type-parameter", identity: "actual:Value", name: "Value" };
  const other = { kind: "type-parameter", identity: parameter.identity, name: "Value" };
  const carrier = rustSourceTypeCarrier("/native.ts", "Owner", "object", [{ kind: "type", type: argument }]);
  const projectTypes = { definitions: [definition], isPolymorphic: () => true,
    definitionForCarrier: selected => selected === carrier ? definition : undefined,
    definitionContainingDeclaration: () => undefined, objectLayoutForDefinition: () => undefined };
  const objectRepresentations = createRustObjectRepresentationPlanRegistry();
  objectRepresentations.prepareNativeLifetimes(projectTypes);
  const native = { kind: "construction", projectTypes, objectRepresentations };
  const context = { ast: source.ast, source, records: createRustRecordFixture(), sourceLifetimes: emptyRustLifetimeIndex,
    retainedEnvironments: { environmentFor: () => ({ kind: "none" }) } };
  assert.equal(rustRetainedValueLifetime(declaration, [carrier], { context }, native).kind, "static",
    "the exact actual argument inherits only its original native object's guaranteed bound");
  assert.equal(rustRetainedValueLifetime(declaration, [carrier, other], { context }, native).kind, "call-scoped-elision",
    "an unrelated same-spelled type does not borrow the original binder's bound");
  const lifetime = { kind: "parameter", identity: "actual:borrow", name: "borrow" };
  const borrowed = { kind: "reference", referent: { kind: "source-primitive", name: "int32" }, mutable: false, lifetime };
  assert.equal(rustRetainedValueLifetime(declaration, [carrier, borrowed], { context }, native) === lifetime, true,
    "native generic guarantees do not erase the exact concrete captured lifetime");
  assert.equal(rustRetainedValueLifetime(declaration, [carrier], { context }, { kind: "signature" }).kind, "call-scoped-elision",
    "signature classification remains authored-only rather than importing physical native guarantees");
});
