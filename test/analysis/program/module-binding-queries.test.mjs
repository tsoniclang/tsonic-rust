import assert from "node:assert/strict";
import { assertRustRecordRequirement } from "../../helpers/required-records.mjs";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { createRustModuleBindingAnalysis } from "../../../dist/analysis/program/module-bindings.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustTypeOnlyDeclarationProducer } from "../../../dist/analysis/program/records/types/type-only-declaration.js";

const integer = { kind: "source-primitive", name: "int32" };

test("module value classification computes one native decision and does not replace it on a changed request", () => {
  const context = analyzeRustErrorEffects(`
    import type { int32 } from "@tsonic/core/types.js";
    const answer: int32 = 7;
    export function step(): int32 { return answer; }
  `, { surfaces: [] });
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsVariableDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "answer");
  assert.equal(declaration !== undefined, true);
  let classifications = 0;
  const builder = createRustProgramRecordBuilder();
  const policy = createRustModuleBindingAnalysis({ ...context, records: builder, ast: { ...context.ast, kindName(node) {
    classifications++;
    return context.ast.kindName(node);
  } } }, new Set());
  const walk = { moduleBindings: policy, context: { requiredRecords: [] } };
  builder.moduleBindings.value(walk, declaration, "const", integer);
  const original = builder.moduleBinding.get(declaration);
  const selectedWork = classifications;
  assert.equal(original.storage, "native-const");
  builder.moduleBindings.value(walk, declaration, "const", { ...integer });
  assert.equal(builder.moduleBinding.get(declaration) === original, true);
  assert.equal(classifications, selectedWork, "repeated annotation/initializer requests do not read the initializer again");
  assert.throws(() => builder.moduleBindings.value(walk, declaration, "let", integer),
    /Conflicting Rust semantic plan 'tsonic\.rust\.moduleBinding'/u);
  assert.throws(() => builder.moduleBindings.value(walk, declaration, "const", { kind: "source-primitive", name: "int64" }),
    /Conflicting Rust semantic plan 'tsonic\.rust\.moduleBinding'/u);
  const beforeRetry = classifications;
  builder.moduleBindings.value(walk, declaration, "const", integer);
  assert.equal(builder.moduleBinding.get(declaration) === original, true,
    "a conflicting request does not poison the completed native decision");
  assert.equal(classifications, beforeRetry);
  builder.seal(walk.context.requiredRecords);
  const beforeClosed = classifications;
  assert.throws(() => builder.moduleBindings.value(walk, declaration, "const", integer), /after analysis is sealed/u);
  assert.equal(classifications, beforeClosed, "closed analysis refuses even a completed classification request");
});

test("address-taken module declarations keep their complete cell classification from the first demand", () => {
  const context = analyzeRustErrorEffects("const answer: number = 7; export function step(): number { return answer; }", { surfaces: [] });
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsVariableDeclaration(node));
  assert.equal(declaration !== undefined, true);
  const builder = createRustProgramRecordBuilder();
  const policy = createRustModuleBindingAnalysis({ ...context, records: builder }, new Set([declaration]));
  const carrier = { kind: "source-primitive", name: "float64" };
  const walk = { moduleBindings: policy, context: { requiredRecords: [] } };
  builder.moduleBindings.value(walk, declaration, "const", carrier);
  const first = builder.moduleBinding.get(declaration);
  assert.equal(first.storage, "module-cell");
  assert.equal(first.initialization, "value");
  builder.moduleBindings.value(walk, declaration, "const", { ...carrier });
  assert.equal(builder.moduleBinding.get(declaration) === first, true);
});

test("module query completion belongs to its actual record builder, not the shared native selector", () => {
  const parent = createRustProgramRecordBuilder();
  const declaration = {};
  let selections = 0;
  const policy = Object.freeze({ classifyValue(subject, kind, carrier) {
    selections++;
    return { declarationKind: kind, storage: "native-const", valueCarrier: carrier };
  } });
  const parentWalk = { moduleBindings: policy, context: { requiredRecords: [] } };
  parent.moduleBindings.value(parentWalk, declaration, "const", integer);
  parent.moduleBindings.value(parentWalk, declaration, "const", integer);
  assert.equal(selections, 1);
  const child = createRustProgramRecordBuilder(undefined, parent);
  const childWalk = { moduleBindings: policy, context: { requiredRecords: [] } };
  child.moduleBindings.value(childWalk, declaration, "const", integer);
  child.moduleBindings.value(childWalk, declaration, "const", integer);
  assert.equal(selections, 2, "a different transaction validates its own request once");
  assert.equal(child.moduleBinding.get(declaration) === parent.moduleBinding.get(declaration), true);
  const local = {};
  child.moduleBindings.value(childWalk, local, "const", integer);
  assert.equal(child.moduleBinding.get(local) !== undefined, true);
  assert.equal(parent.moduleBinding.get(local) === undefined, true, "a probe never publishes to its parent");
});

test("an unavailable native module classification is not cached as successful", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  let selections = 0;
  const walk = { moduleBindings: { classifyValue() { selections++; return undefined; } } };
  builder.moduleBindings.value(walk, declaration, "const", integer);
  builder.moduleBindings.value(walk, declaration, "const", integer);
  assert.equal(builder.moduleBinding.get(declaration) === undefined, true);
  assert.equal(selections, 2);
});

test("merged interface representation groups are selected once and every exact declaration is admitted", () => {
  let walk;
  const context = analyzeRustErrorEffects(`
    import type { int32 } from "@tsonic/core/types.js";
    interface Callable {}
    interface Callable { (value: int32): int32; }
    export function step(invoke: Callable): int32 { return invoke(2); }
  `, { surfaces: [] }, original => ({ ...original, records: { ...original.records,
    typeOnlyDeclarations: { ...original.records.typeOnlyDeclarations, representationAliases(current, files) {
      walk = current;
      return original.records.typeOnlyDeclarations.representationAliases(current, files);
    } },
  } }));
  assert.equal(walk !== undefined, true);
  const declarations = context.sourceStorage.nodes.filter(node => context.ast.is.IsInterfaceDeclaration(node));
  assert.equal(declarations.length, 2);
  for (const declaration of declarations) assertRustRecordRequirement(context.requiredRecords, "typeOnlyDeclaration", declaration);
  let selected = 0;
  const observed = { ...walk, context: { ...walk.context, semanticsFor(node) {
    if (declarations.includes(node)) selected++;
    return walk.context.semanticsFor(node);
  } } };
  let closed = false;
  const producer = createRustTypeOnlyDeclarationProducer(() => { if (closed) throw new Error("alias query is sealed"); });
  producer.representationAliases(observed, context.sourceFiles);
  assert.equal(selected, 1, "select the complete merged group, not each repeated declaration");
  const canonical = declarations.map(node => producer.records.get(node));
  assert.equal(canonical.every(fact => fact?.reason === "representation-alias"), true);
  producer.representationAliases(observed, context.sourceFiles);
  assert.equal(selected, 1, "a repeated successful group query has no selection replay");
  assert.equal(declarations.every((node, index) => producer.records.get(node) === canonical[index]), true);
  closed = true;
  assert.throws(() => producer.representationAliases(observed, context.sourceFiles), /alias query is sealed/u);
});
