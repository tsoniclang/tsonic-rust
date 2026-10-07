import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { selectRustInlineModuleCallableAliases } from "../../../dist/analysis/callables/module-aliases.js";
import { rustContextualValueConversionFactKey, rustDirectCallableReferenceFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustRuntimeCarrierKey } from "../../../dist/target-model/facts/selections.js";
import { rustCallableInputTargetType, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";

function fixture() {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: { "/src/index.ts": `
    function normalize(value: number): number { return value; }
    declare function observe(transform: typeof normalize): void;
    function run(): void { const first = normalize; const alias = first; observe(alias); }
  ` }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, "exact checked immutable callable aliases");
  const source = createTargetSourceProgram(checked);
  const declarations = [];
  let expression;
  let owner;
  const visit = node => {
    if (source.ast.is.IsFunctionDeclaration(node) && source.ast.text(source.ast.name(node)) === "normalize") owner = node;
    if (source.ast.is.IsVariableDeclaration(node)) {
      declarations.push(node);
      if (source.ast.text(source.ast.name(node)) === "first") expression = source.ast.as.AsVariableDeclaration(node).Initializer;
    }
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(checked.getSourceFile("/src/index.ts"));
  const flow = source.navigation.expressionValueFlow(expression);
  const integer = { kind: "source-primitive", name: "int32" };
  const carrier = rustCallableTargetType([integer], integer);
  const target = rustCallableInputTargetType([integer], integer);
  const producer = { form: "function", sourceDeclaration: owner, carrier };
  const values = new Map();
  for (const node of [...declarations, ...flow.uses.map(use => use.reference)]) {
    values.set(node, new Map([[rustRuntimeCarrierKey, { carrier }]]));
  }
  for (const use of flow.uses) if (use.role === "argument") {
    values.get(use.reference).set(rustContextualValueConversionFactKey,
      { targetCarrier: target, conversion: { kind: "callable-input", source: carrier, target } });
  }
  return { source, expression, producer, flow, declarations, values,
    walk: { context: { ast: source.ast, source, facts: { get: (node, key) => values.get(node)?.get(key) } } } };
}

test("unobserved immutable callable aliases select one exact stack producer through all aliases", () => {
  const current = fixture();
  const selected = selectRustInlineModuleCallableAliases(current.walk, current.expression, current.producer);
  assert.equal(selected !== undefined, true, "the complete checked alias flow has a canonical producer");
  assert.equal(selected.declarations.length, 2);
  assert.equal(selected.references.length, 1);
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.declarations) && Object.isFrozen(selected.references), true);
});

test("escaping, observed and mutable callable aliases cannot erase identity storage", () => {
  for (const flag of ["memberWritten", "receiverUsed", "identityCompared", "captured", "returned", "yielded",
    "storedOutsideBinding", "exported", "hasUnclassifiedUse"]) {
    const current = fixture();
    current.walk.context.source = { ...current.source, navigation: { ...current.source.navigation,
      expressionValueFlow: () => ({ ...current.flow, [flag]: true }) } };
    assert.equal(selectRustInlineModuleCallableAliases(current.walk, current.expression, current.producer) === undefined, true, flag);
  }
  const current = fixture();
  current.walk.context.source = { ...current.source, navigation: { ...current.source.navigation,
    declarationUseSummary: declaration => ({ ...current.source.navigation.declarationUseSummary(declaration), bindingWritten: true }) } };
  assert.equal(selectRustInlineModuleCallableAliases(current.walk, current.expression, current.producer) === undefined, true,
    "a changed binding never gets an immutable producer fact");
});

test("callable alias erasure requires exact carrier, input conversion and declaration identity", () => {
  for (const mutation of ["carrier", "conversion", "declaration"]) {
    const current = fixture();
    const use = current.flow.uses.find(value => value.role === "argument");
    const values = current.values.get(use.reference);
    if (mutation === "carrier") values.delete(rustRuntimeCarrierKey);
    if (mutation === "conversion") values.delete(rustContextualValueConversionFactKey);
    if (mutation === "declaration") values.set(rustDirectCallableReferenceFactKey, { ...current.producer, sourceDeclaration: {} });
    assert.equal(selectRustInlineModuleCallableAliases(current.walk, current.expression, current.producer) === undefined, true, mutation);
  }
});

test("callable alias erasure rejects a non-binding declaration before reading binding syntax", () => {
  const current = fixture();
  current.walk.context.source = { ...current.source, navigation: { ...current.source.navigation,
    expressionValueFlow: () => ({ ...current.flow, aliasDeclarations: [current.producer.sourceDeclaration] }) } };
  assert.equal(selectRustInlineModuleCallableAliases(current.walk, current.expression, current.producer) === undefined, true,
    "a source function cannot be reinterpreted as a variable binding");
});
