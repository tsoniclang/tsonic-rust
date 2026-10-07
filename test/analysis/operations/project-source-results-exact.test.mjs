import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { acmeTestingPackage, analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { projectSourceResultContracts } from "../../fixtures/project-source-result-contracts.mjs";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustProjectCallableAdaptersKey } from "../../../dist/analysis/facts/project-callable-adapters.js";
import { rustSourceCallResultProjectionMatches } from "../../../dist/analysis/facts/source-call-results.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustOptionElementCarrier, rustStringTargetType } from "../../../dist/target-model/types/index.js";

function sourceCalls(program, name) {
  const ast = program.source.ast;
  const calls = [];
  const visit = node => {
    if (ast.is.IsCallExpression(node)) {
      const callee = Node_Expression(ast, node);
      if (ast.is.IsPropertyAccessExpression(callee) && ast.text(ast.name(callee)) === name) {
        calls.push(node);
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  return calls;
}

function exactProjectedCall(program, call) {
  const fact = program.facts.getFact(call, rustTargetOperationFactKey);
  const selected = program.facts.getSelectedTargetCall(call);
  assert.equal(fact.kind, "source-call");
  assert.ok(selected.sourceDeclaration);
  assert.ok(program.source.ast.body(selected.sourceDeclaration));
  assert.ok(fact.resultProjection);
  assert.equal(rustTargetTypeRefEquals(fact.resultCarrier, fact.resultProjection.selectedCarrier), true);
  assert.equal(rustSourceCallResultProjectionMatches(selected.sourceResultProjection, fact.resultProjection,
    carrier => carrier, program.projectTypes, program.typeDefinitions), true);
  return { fact, selected };
}

test("checked overload results keep one physical implementation and permit exact chained calls", () => {
  const options = { surfaces: ["js"], files: { "index.ts": `
import type { uint64 } from "@tsonic/core/types.js";
class Reader {
  read(name: string): string;
  read(name: string, value: uint64): this;
  read(name: string, value?: uint64): string | this {
    return value === undefined ? name : this;
  }
}
export function main(): void {
  const reader = new Reader();
  const result = reader.read("first", 7n);
  const text = reader.read("second");
  result.read(text, 9n).read("third", 11n);
}
` } };
  const { program } = analyzeRust(options);
  const calls = sourceCalls(program, "read");
  assert.equal(calls.length, 4);
  const projected = calls.map(call => exactProjectedCall(program, call));
  const implementation = projected[0].selected.sourceDeclaration;
  assert.ok(projected.every(({ selected }) => selected.sourceDeclaration === implementation));
  assert.equal(projected[0].fact.parameters[1].form, "optional");
  assert.equal(rustOptionElementCarrier(projected[0].fact.parameters[1].parameterCarrier).name, "uint64");
  assert.equal(projected[1].fact.parameters[1].inputs.length, 0);
  assert.equal(rustTargetTypeRefEquals(projected[1].fact.resultCarrier, rustStringTargetType()), true);
  assert.equal(projected[0].fact.resultProjection.variant, projected[2].fact.resultProjection.variant);
  const { result } = compileRust(options);
  assertNoTargetDiagnostics(result.diagnostics);
  assert.ok(result.artifacts.some(artifact => artifact.path === "src/index.rs"));
});

test("optional overload results project the exact payload without creating a second absence", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
class Reader {
  read(name: string): string | undefined;
  read(name: string, value: number): this;
  read(name: string, value?: number): string | undefined | this {
    return value === undefined ? undefined : this;
  }
}
export function main(): void {
  const reader = new Reader();
  const result = reader.read("first", 7);
  result.read("second", 9);
  const absent = reader.read("third");
}
` } });
  const calls = sourceCalls(program, "read");
  const results = calls.map(call => exactProjectedCall(program, call));
  assert.equal(results.length, 3);
  assert.ok(rustOptionElementCarrier(results[0].fact.resultProjection.sourceCarrier));
  assert.equal(rustOptionElementCarrier(results[0].fact.resultCarrier), undefined);
  assert.equal(rustTargetTypeRefEquals(rustOptionElementCarrier(results[2].fact.resultCarrier), rustStringTargetType()), true);
  assert.equal(results[2].fact.parameters[1].inputs.length, 0);
});

test("optional scalar implementations retain exact required and absent overload result contracts", () => {
  for (const surfaces of [[], ["js"]]) {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
import type { uint64 } from "@tsonic/core/types.js";
class Reader {
  read(): uint64 | undefined;
  read(set: boolean): uint64;
  read(set?: boolean): uint64 | undefined {
    return set === undefined ? undefined : 9007199254740993n;
  }
}
export function main(): void {
  const reader = new Reader();
  const value: uint64 = reader.read(true);
  const next: uint64 = value + 2n;
  const absent = reader.read();
}
` } });
    const calls = sourceCalls(program, "read");
    assert.equal(calls.length, 2);
    const value = exactProjectedCall(program, calls[0]);
    assert.equal(value.fact.resultProjection.kind, "option-value");
    assert.equal(value.fact.resultCarrier.name, "uint64");
    const absent = program.facts.getFact(calls[1], rustTargetOperationFactKey);
    assert.equal(absent.resultProjection, undefined);
    assert.equal(rustOptionElementCarrier(absent.resultCarrier).name, "uint64");
  }
});

test("rest overload binding retains the canonical native sequence and each selected argument", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
import type { uint64 } from "@tsonic/core/types.js";
class Reader {
  read(name: string): string;
  read(name: string, ...values: uint64[]): this;
  read(name: string, ...values: uint64[]): string | this {
    return values.length === 0 ? name : this;
  }
}
export function main(): void {
  const reader = new Reader();
  const result = reader.read("first", 7n, 9n);
  const text = reader.read("second");
  result.read(text, 11n);
}
` } });
  const results = sourceCalls(program, "read").map(call => exactProjectedCall(program, call));
  assert.equal(results.length, 3);
  const parameter = results[0].fact.parameters[1];
  assert.equal(parameter.form, "rest");
  assert.deepEqual(parameter.inputs.map(input => input.sourceArgumentIndex), [1, 2]);
  assert.ok(parameter.inputs.every(input => input.carrier.name === "uint64" && input.sourceParameterForm === "rest-element"));
  assert.deepEqual(results[1].fact.parameters[1].inputs, []);
});

test("nominal this projection preserves the implementation result and exact override adapters", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
class Base {
  count: number = 1;
  read(value: Base): this { return value as this; }
}
class Derived extends Base {
  count: number = 2;
  read(value: Base): this { return value as this; }
}
export function main(): void {
  const first = new Derived();
  const second = new Derived();
  const base: Base = first;
  const result = first.read(second);
  base.read(second);
  const count = result.count;
}
` } });
  const derived = program.projectTypes.definitions.find(definition => definition.sourceName === "Derived");
  const adapters = program.facts.getFact(derived.declaration, rustProjectCallableAdaptersKey);
  assert.ok(adapters.length > 0);
  assert.ok(adapters.every(adapter => adapter.adapterFallible === false));
  const override = adapters.find(adapter => adapter.contract !== adapter.implementation);
  assert.ok(override);
  assert.equal(override.resultAdapter.kind, "project-upcast");
  const calls = sourceCalls(program, "read");
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const fact = program.facts.getFact(call, rustTargetOperationFactKey);
    const selected = program.facts.getSelectedTargetCall(call);
    assert.equal(fact.target.form, "method");
    assert.equal(fact.target.dispatch.selected, "virtual");
    assert.equal(fact.parameters[0].inputs[0].sourceArgumentIndex, 0);
    assert.equal(rustTargetTypeRefEquals(fact.parameters[0].valueCarrier, selected.member.parameters[0].type), true);
  }
});

test("cross-file receiver generics instantiate exact selected parameter and return carriers", () => {
  const { program } = analyzeRust({ files: {
    "reader.ts": `export class Reader<Value> {
      read(value: Value): Value { return value; }
      identity<Item>(value: Item): Item { return value; }
    }`,
    "index.ts": `
import { Reader } from "./reader.js";
import type { uint64 } from "@tsonic/core/types.js";
export function main(): void {
  const numeric = new Reader<uint64>();
  const text = new Reader<string>();
  const value: uint64 = numeric.read(7n);
  const label = text.read("exact");
  const same = text.identity<string>(label);
}
`,
  } });
  const calls = sourceCalls(program, "read");
  assert.equal(calls.length, 2);
  const numeric = program.facts.getFact(calls[0], rustTargetOperationFactKey);
  const text = program.facts.getFact(calls[1], rustTargetOperationFactKey);
  assert.equal(numeric.parameters[0].parameterCarrier.name, "uint64");
  assert.equal(numeric.resultCarrier.name, "uint64");
  assert.equal(rustTargetTypeRefEquals(text.parameters[0].parameterCarrier, rustStringTargetType()), true);
  assert.equal(rustTargetTypeRefEquals(text.resultCarrier, rustStringTargetType()), true);
  const generic = program.facts.getFact(sourceCalls(program, "identity")[0], rustTargetOperationFactKey);
  assert.equal(rustTargetTypeRefEquals(generic.resultCarrier, rustStringTargetType()), true);
});

test("inherited generic method analysis transports specialization identities to the concrete receiver", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
class Base<T> {
  identity<Value>(value: Value): Value { return value; }
  retain(value: T): T { return this.identity(value); }
}
class Derived<Item> extends Base<Item> {
  identity<Value>(value: Value): Value { return value; }
}
export function main(): void { new Derived<number>().retain(3); }
` } });
  const base = program.projectTypes.definitions.find(definition => definition.sourceName === "Base");
  const derived = program.projectTypes.definitions.find(definition => definition.sourceName === "Derived");
  const method = definition => program.source.ast.members(definition.declaration)
    .find(member => program.source.ast.text(program.source.ast.name(member)) === "identity");
  const baseMethod = method(base);
  const derivedMethod = method(derived);
  const baseVariant = program.projectMethodDispatch.variantsForMember(baseMethod)[0];
  const derivedVariant = program.projectMethodDispatch.variantsForMember(derivedMethod)[0];
  assert.equal(baseVariant.targetTypeArguments[0].identity, base.typeParameterIdentities[0]);
  assert.equal(derivedVariant.targetTypeArguments[0].identity, derived.typeParameterIdentities[0]);
  assert.equal(program.projectMethodDispatch.variantForMember(baseMethod, derivedVariant.targetTypeArguments,
    program.projectTypes.openCarrier(derived)), baseVariant);
  const adapters = program.facts.getFact(derived.declaration, rustProjectCallableAdaptersKey);
  const override = adapters.find(adapter => adapter.contract === baseMethod && adapter.implementation === derivedMethod);
  assert.ok(override);
  assert.equal(override.returnCarrier.identity, derived.typeParameterIdentities[0]);
  assert.equal(override.implementationReturnCarrier.identity, derived.typeParameterIdentities[0]);
  assert.equal(override.resultAdapter.kind, "identity");
});

for (const fixture of projectSourceResultContracts) {
  test(`${fixture.name} completes source checking, analysis and target planning before native execution`, () => {
    const { result } = compileRust({
      surfaces: fixture.surfaces,
      packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: fixture.crateName } },
      files: { "index.ts": fixture.source },
    });
    assertNoTargetDiagnostics(result.diagnostics);
    assert.ok(result.artifacts.some(artifact => artifact.path === "src/main.rs"));
  });
}
