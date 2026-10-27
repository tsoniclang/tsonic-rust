import { assertRustRecordRequirement } from "../../../helpers/required-records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { recordRustInlineModuleCallableUses } from "../../../../dist/analysis/callables/values/module-values.js";
import { rustLifetimeKey } from "../../../../dist/target-model/lifetimes/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

function fixture(text, surfaces) {
  const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": text } });
  const nodes = [];
  const visit = node => { nodes.push(node); source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  return { source, program, ast: source.ast, nodes, records: program.records, requiredRecords };
}

function assertCallable(context, family, reference, declaration) {
  const { records, ast } = context;
  const fact = records[family].get(reference);
  assert.equal(fact !== undefined, true, family);
  assert.equal(fact.form, "function");
  assert.equal(fact.sourceDeclaration === declaration, true, "the exact checked function declaration is retained");
  assert.equal(fact.fileName, ast.getFileName(ast.getSourceFile(declaration)));
  assert.equal(fact.name, ast.text(ast.name(declaration)), "authored spelling stays unchanged");
  assert.equal(fact.parameterCarriers.length, ast.parameters(declaration).length);
  for (const [index, parameter] of ast.parameters(declaration).entries()) {
    assert.equal(rustTargetTypeRefEquals(fact.parameterCarriers[index], records.sourceParameterAbi.get(parameter)?.parameterCarrier), true);
  }
  assert.equal(rustTargetTypeRefEquals(fact.resultCarrier, records.sourceCallableReturn.get(declaration)?.returnCarrier), true);
  assert.equal(rustTargetTypeRefEquals(fact.carrier, records.runtimeCarrier.get(reference)?.carrier), true);
  assert.equal(Object.isFrozen(fact) && Object.isFrozen(fact.parameterCarriers), true);
  assert.equal(records[family].get(declaration) === undefined && records[family].get({}) === undefined, true);
  assert.equal(records[family].set === undefined, true);
  for (const field of ["lifetime", "captures", "storage"]) assert.equal(Object.hasOwn(fact, field), false, field);
  return fact;
}

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  test(`checked stored module references retain the selected native callable and exact declaration in ${surface}`, () => {
    const context = fixture(`
      import type { int32 } from "@tsonic/core/types.js";
      function keepMyCase(value: int32): int32 { return value; }
      export const callback: (value: int32) => int32 = keepMyCase;
    `, surfaces);
    const declaration = context.nodes.find(node => context.ast.is.IsFunctionDeclaration(node));
    const callback = context.nodes.find(node => context.ast.is.IsVariableDeclaration(node));
    assertRustRecordRequirement(context.requiredRecords, "directCallableReference", context.ast.as.AsVariableDeclaration(callback).Initializer);
    const selected = context.nodes.filter(node => context.records.directCallableReference.get(node) !== undefined);
    assert.equal(selected.length, 1);
    assert.equal(context.ast.is.IsIdentifier(selected[0]), true);
    const fact = assertCallable(context, "directCallableReference", selected[0], declaration);
    assert.equal(fact.parameterCarriers[0].name, "int32");
    assert.equal(fact.resultCarrier.name, "int32");
    assert.equal(context.records.sourceCallableValue.get(selected[0]) === undefined, true, "stored native callable is not a declaration-value shortcut");
  });

  test(`checked lexical aliases retain their own function declaration and exact native signature in ${surface}`, () => {
    const context = fixture(`
      import type { int32 } from "@tsonic/core/types.js";
      export function run(value: int32): int32 {
        function keepMyCase(input: int32): int32 { return input; }
        const callback: (input: int32) => int32 = keepMyCase;
        const alias = callback;
        return alias(value);
      }
    `, surfaces);
    const declaration = context.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) && context.ast.text(context.ast.name(node)) === "keepMyCase");
    const callback = context.nodes.find(node => context.ast.is.IsVariableDeclaration(node) && context.ast.text(context.ast.name(node)) === "callback");
    assertRustRecordRequirement(context.requiredRecords, "sourceCallableValue", context.ast.as.AsVariableDeclaration(callback).Initializer);
    const selected = context.nodes.filter(node => context.records.sourceCallableValue.get(node) !== undefined);
    assert.equal(selected.length, 1);
    assertCallable(context, "sourceCallableValue", selected[0], declaration);
    assert.equal(context.records.directCallableReference.get(selected[0]) === undefined, true, "lexical declaration is not a module binding");
    const aliases = context.nodes.filter(node => context.ast.is.IsVariableDeclaration(node));
    assert.equal(aliases.length, 2);
    assert.equal(aliases.every(node => context.records.sourceCallableValue.get(node) === undefined), true);
  });

  test(`checked generic module alias transport preserves declaration and reference identities in ${surface}`, () => {
    const context = fixture(`
      function keepMyCase<T>(value: T): T { return value; }
      export function run(): number { const callback = keepMyCase; const alias = callback; return alias(2); }
    `, surfaces);
    const declaration = context.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) && context.ast.text(context.ast.name(node)) === "keepMyCase");
    const selected = context.nodes.filter(node => context.records.sourceCallableValue.get(node) !== undefined);
    assert.equal(selected.length, 1);
    const fact = assertCallable(context, "sourceCallableValue", selected[0], declaration);
    assert.equal(fact.parameterCarriers[0].kind, "type-parameter");
    assert.equal(rustTargetTypeRefEquals(fact.parameterCarriers[0], fact.resultCarrier), true);
    assertCallable(context, "directCallableReference", selected[0], declaration);
    const aliases = context.nodes.filter(node => context.ast.is.IsVariableDeclaration(node));
    const references = context.nodes.filter(node => context.ast.is.IsIdentifier(node) && aliases.some(alias =>
      node !== context.ast.name(alias) && context.program.sourceNavigation.sourceReferenceFor(node)?.declaration === alias));
    assert.equal(aliases.length, 2);
    assert.equal(references.length, 2);
    const callback = aliases.find(node => context.ast.text(context.ast.name(node)) === "callback");
    const initializer = context.ast.as.AsVariableDeclaration(callback).Initializer;
    assertRustRecordRequirement(context.requiredRecords, "sourceCallableValue", initializer);
    assertRustRecordRequirement(context.requiredRecords, "directCallableReference", initializer);
    const builder = createRustProgramRecordBuilder(undefined, context.records);
    const replayRequirements = [];
    recordRustInlineModuleCallableUses({ context: { records: builder, requiredRecords: replayRequirements } }, {
      stored: false, declarationValue: true, uses: [{ kind: "first-class", reference: selected[0] }],
      aliases: [{ declarations: aliases, references, producer: fact }],
    });
    assert.equal(builder.sourceCallableValue.get(selected[0]) === fact, true, "equal admission reuses inherited record identity");
    assertRustRecordRequirement(replayRequirements, "sourceCallableValue", initializer);
    for (const reference of references) {
      assertRustRecordRequirement(replayRequirements, "directCallableReference", reference);
      const direct = builder.directCallableReference.get(reference);
      assert.equal(direct.sourceDeclaration === declaration, true);
      assert.equal(direct.carrier === fact.carrier && direct.resultCarrier === fact.resultCarrier, true);
      assert.equal(direct.parameterCarriers[0] === fact.parameterCarriers[0], true);
      assert.equal(Object.isFrozen(direct), true);
      assert.equal(context.records.directCallableReference.get(reference) === undefined, true);
    }
    assert.equal(aliases.every(alias => builder.compileTimeSource.get(alias) === true), true);
    for (const alias of aliases) assertRustRecordRequirement(replayRequirements, "compileTimeSource", alias);
  });

  test(`returned native environments keep only the checked escaping input and exact call lifetime in ${surface}`, () => {
    const context = fixture(`
      import type { int32 } from "@tsonic/core/types.js";
      function retain(callback: () => int32): () => int32 { return callback; }
      export function run(callback: () => int32, unused: () => int32): () => int32 { return retain(callback); }
    `, surfaces);
    const declarations = context.nodes.filter(node => context.records.retainedEnvironment.get(node) !== undefined);
    const expectedDeclarations = context.nodes.filter(node => context.ast.is.IsFunctionDeclaration(node));
    assert.equal(expectedDeclarations.length, 2);
    for (const declaration of expectedDeclarations) assertRustRecordRequirement(context.requiredRecords, "retainedEnvironment", declaration);
    assert.equal(declarations.length, 2);
    for (const declaration of declarations) {
      const environment = context.records.retainedEnvironment.get(declaration);
      assert.equal(environment.inputs.length, 1);
      assert.equal(environment.inputs[0].declaration === context.ast.parameters(declaration)[0], true);
      assert.equal(environment.lifetime.kind, "parameter");
      assert.equal(Object.isFrozen(environment) && Object.isFrozen(environment.inputs), true);
      assert.equal(environment.inputs.some(input => input.kind === "parameter" && input.declaration === context.ast.parameters(declaration)[1]), false);
    }
    const callee = declarations.find(node => context.ast.text(context.ast.name(node)) === "retain");
    const caller = declarations.find(node => context.ast.text(context.ast.name(node)) === "run");
    const call = context.nodes.find(node => context.ast.is.IsCallExpression(node));
    assertRustRecordRequirement(context.requiredRecords, "retainedCallLifetimes", call);
    const entries = context.records.retainedCallLifetimes.get(call);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].identity, rustLifetimeKey(context.records.retainedEnvironment.get(callee).lifetime));
    assert.equal(rustLifetimeKey(entries[0].lifetime), rustLifetimeKey(context.records.retainedEnvironment.get(caller).lifetime));
    assert.equal(context.records.retainedEnvironment.get({}) === undefined && context.records.retainedEnvironment.set === undefined, true);
  });

  for (const kind of ["async", "generator"]) {
    test(`selected ${kind} storage retains the exact checked owned environment only where required in ${surface}`, () => {
      const context = fixture(`
        import type { int32 } from "@tsonic/core/types.js";
        export ${kind === "async" ? "async function" : "function*"} run(callback: () => int32, unused: () => int32):
          ${kind === "async" ? "Promise<int32> { return callback(); }" : "Generator<int32, int32, int32> { const next: int32 = yield callback(); return next; }"}
      `, surfaces);
      const declaration = context.nodes.find(node => context.ast.is.IsFunctionDeclaration(node));
      const environment = context.records.retainedEnvironment.get(declaration);
      const selected = context.records[kind === "async" ? "asyncFunction" : "generator"].get(declaration);
      assert.equal(selected !== undefined, true);
      if (kind === "async" && surfaces.length === 0) {
        assert.equal(context.requiredRecords.some(row => row.family === "retainedEnvironment" && row.subject === declaration), false);
        assert.equal(selected.kind, "native-future");
        assert.equal(environment === undefined, true, "native async syntax does not invent a boxed owned environment");
        return;
      }
      assert.equal(environment !== undefined, true);
      assertRustRecordRequirement(context.requiredRecords, "retainedEnvironment", declaration);
      assert.equal(environment.inputs.length, 1);
      assert.equal(environment.inputs[0].declaration === context.ast.parameters(declaration)[0], true);
      assert.equal(Object.isFrozen(environment) && Object.isFrozen(environment.inputs), true);
      assert.equal(selected.storage.kind, "lifetime");
      assert.equal(rustLifetimeKey(selected.storage.lifetime), rustLifetimeKey(environment.lifetime));
      assert.equal(selected.capturedParameters.length, 1);
      assert.equal(selected.capturedParameters[0] === environment.inputs[0].declaration, true);
    });
  }

  test(`ordinary scalar functions do not manufacture callable-value or environment records in ${surface}`, () => {
    const context = fixture(`
      import type { int32 } from "@tsonic/core/types.js";
      export function run(value: int32): int32 { return value; }
    `, surfaces);
    for (const family of ["sourceCallableValue", "directCallableReference", "retainedEnvironment"]) {
      assert.equal(context.requiredRecords.some(row => row.family === family), false, family);
      assert.equal(context.nodes.every(node => context.records[family].get(node) === undefined), true, family);
    }
  });
}
