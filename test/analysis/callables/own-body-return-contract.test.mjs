import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createRustSourceCallableQueries } from "../../../dist/analysis/callables/ownership/borrowed-returns.js";
import { createRustSourceCallableAbiResolver } from "../../../dist/analysis/callables/calls/source-callable-abi.js";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { rustResolutionContext } from "../../../dist/analysis/program/walk.js";
import { finalizeRustCallableParameterAbis } from "../../../dist/analysis/callables/calls/signature-query.js";
import { rustSourceCallBorrowedReturn } from "../../../dist/analysis/callables/ownership/source-input-lifetimes.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustSourceFilePlanContext } from "../../helpers/plan-context.mjs";
import { planExpression } from "../../../dist/backend/planner/expressions/entry.js";

function fixture(text) {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/project",
    files: { "/project/index.ts": text },
    compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics.slice(0, 4)).slice(0, 1024));
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/project/index.ts");
  assert.equal(file !== undefined, true, "checked source file exists");
  const nodes = [];
  const collect = node => {
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) collect(child); });
  };
  collect(file);
  const declaration = nodes.find(node => source.ast.is.IsFunctionDeclaration(node) &&
    source.ast.text(source.ast.name(node)) === "read");
  assert.equal(declaration !== undefined, true, "exact checked read declaration exists");
  let historyReads = 0;
  const observed = Object.freeze({ ...source, navigation: Object.freeze({ ...source.navigation,
    expressionValueFlow() { historyReads++; throw new Error("return selection must not inspect caller value flow"); },
    declarationUses(node) {
      if (node === declaration) {
        historyReads++;
        throw new Error("return selection must not enumerate its callers");
      }
      return source.navigation.declarationUses(node);
    },
  }) });
  const queries = createRustSourceCallableQueries(observed, nodes, new Set(), () => undefined);
  const selected = queries.borrowedReturn(declaration);
  return { source, declaration, selected, historyReads, queries };
}

for (const surfaces of [[], ["js"]]) {
  test(`the first return publication consumes the completed ${surfaces[0] ?? "native"} index operation`, () => {
    let first;
    let publications = 0;
    const operations = new Map();
    const context = analyzeRustErrorEffects(`export type Children = readonly Children[] | undefined;
      export function first(children: Children): Children { return children?.[0]; }`, { surfaces }, original => ({
      ...original, records: { ...original.records,
        targetOperations: { ...original.records.targetOperations, checked(node, selected) {
          operations.set(node, (operations.get(node) ?? 0) + 1);
          return original.records.targetOperations.checked(node, selected);
        } },
        sourceCallableReturns: { ...original.records.sourceCallableReturns, resolve(walk, declaration, selected) {
          const initial = original.records.sourceCallableReturn.get(declaration) === undefined;
          const result = original.records.sourceCallableReturns.resolve(walk, declaration, selected);
          if (initial && result && original.ast.text(original.ast.name(declaration)) === "first") {
            publications++;
            const expression = original.sourceCallables.borrowedReturn(declaration)?.returns[0];
            assert.equal(expression !== undefined, true, "the source candidate retains its own exact return expression");
            first = { expression, operation: original.records.targetOperation.get(expression),
              returned: original.records.sourceCallableReturn.get(declaration) };
            assert.equal(first.operation?.kind, "provider-operation", "the native operation is selected at the first return publication");
            assert.equal(first.returned?.borrowedReturn !== undefined, surfaces.length === 0,
              "only the actual direct native slot returns a loan; the owned provider result remains owned");
          }
          return result;
        } },
      },
    }));
    assert.equal(publications, 1, "one original declaration return publication completes");
    assert.equal(first !== undefined, true, "the first completed return was observed through its real producer port");
    assert.equal(context.records.targetOperation.get(first.expression) === first.operation, true,
      "the later body visit consumes the same canonical operation");
    assert.equal(operations.get(first.expression), 1, "the operation is not republished by a second body visit");
  });
}

test("closed native generic calls preserve the declared loan and their actual values", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `export function read<Value>(value: Value): Value { return value; }
      export function main(): void {
        if (read(7) !== 7 || read("value") !== "value") throw new Error("generic loan value");
      }
      main();`,
  } });
  assert.equal(result.diagnostics.length, 0, "both exact closed generic result contracts are admitted");
  assert.equal(validateGeneratedProject("own-body-generic-loan-values", result.artifacts, { run: true }).status, 0,
    "the generated native generic String and scalar calls execute with the original values");
});

test("late source-call result forms distinguish shared places, materialized values and actual typed overrides", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function read<Value>(value: Value): Value { return value; }
export function compare(): boolean { return ((read(7))) === 7; }
export function add(): number { return read(7) + 1; }
export function text(): string { return read("value"); }
` } });
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  const calls = nodes.filter(node => ast.is.IsCallExpression(node) && program.records.targetOperation.get(node)?.kind === "source-call");
  assert.equal(calls.length, 3, "all three actual physical result boundaries are selected");
  let shared;
  for (const call of calls) {
    const materialization = program.records.sourceCall.get(call).resultMaterialization;
    const form = program.records.valueProjection.get(call).resultForm;
    assert.equal(form, materialization === "direct" ? "shared-reference" : "value",
      "the final record describes the actual result after the selected materialization");
    if (materialization === "direct") shared = call;
  }
  assert.equal(shared !== undefined, true, "the actual ref/ref comparison retains its declaration loan");
  const context = rustSourceFilePlanContext(program, shared);
  const selected = planExpression(shared, context, "value", "shared-place");
  assert.equal(selected?.kind, "dereference", "one shared-place boundary obtains the actual native referent");
  assert.equal(selected.pointer.kind === "dereference", false, "the final boundary does not dereference twice");
  const wrapper = ast.parent(ast.parent(shared));
  const wrapped = planExpression(wrapper, context, "value", "shared-place");
  assert.equal(wrapped?.kind, "dereference", "transparent forwarding preserves the same physical form");
  assert.equal(wrapped.pointer.kind === "dereference", false, "the transparent inner consumer does not add another dereference");
  const carrier = program.records.runtimeCarrier.get(shared).carrier;
  const expression = { kind: "path", path: "selected_value" };
  for (const form of ["value", "storage", "shared-reference"]) {
    const override = { ...context, expressionOverrides: new Map([[shared, { expression, carrier, valueForm: form }]]) };
    const place = planExpression(shared, override, "value", "shared-place");
    assert.equal(form === "shared-reference" ? place?.kind === "dereference" && place.pointer === expression : place === expression,
      true, `${form}: actual typed override form wins over the original call metadata`);
    const reference = planExpression(shared, override, "value", "shared-reference");
    assert.equal(form === "shared-reference" ? reference === expression : reference?.kind === "reference" && reference.expr === expression,
      true, `${form}: the selected native reference is supplied exactly once`);
  }
});

test("native identity assertions and transparent loans execute without changing genuine conversions", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export function read<Value>(value: Value): Value { return value; }
export function main(): void {
  if (((read(7))) !== 7 || (read(8) as number)! !== 8) throw new Error("loan forwarding");
  const converted = read(9) as int32;
  if (converted !== (9 as int32)) throw new Error("native conversion");
}
main();
` } });
  assert.equal(result.diagnostics.length, 0, "real identity and consuming native forms stay admitted");
  assert.equal(validateGeneratedProject("own-body-physical-forwarding", result.artifacts, { run: true }).status, 0,
    "the generated native forms retain original scalar values and exactly one physical boundary");
});

for (const [name, body] of [
  ["direct input", "return input;"],
  ["local member", "return input.value;"],
  ["one local alias", "const alias = input; return alias.value;"],
  ["optional element", "return input?.[0];"],
]) {
  test(`own-body return relation selects ${name} without caller history`, () => {
    const parameter = name === "direct input" ? "string"
      : name === "optional element" ? "readonly string[] | undefined" : "{ value: string }";
    const { source, declaration, selected, historyReads, queries } = fixture(
      `export function read(input: ${parameter}): string | undefined { ${body} }`);
    assert.equal(selected !== undefined, true, "the own-body relation is proved");
    assert.equal(selected.parameter === source.ast.parameters(declaration)[0], true, "exact input declaration");
    assert.equal(selected.returns.length, 1, "one direct return expression is retained");
    assert.equal(Object.isFrozen(selected), true, "the relation is immutable");
    assert.equal(Object.isFrozen(selected.returns), true, "the return-expression vector is immutable");
    assert.equal(queries.borrowedReturn(declaration) === selected, true, "lookup reuses the completed local relation");
    assert.equal(historyReads, 0, "no actual-caller or runtime-value-flow query");
  });
}

function parameterFixture(text, maximumParameterContractSteps) {
  const { context, walk } = analyzeRustOperations(text, { surfaces: [] });
  const parameters = context.nativeNodes.filter(node => context.ast.is.IsParameterDeclaration(node));
  const ownParameters = new Set(parameters);
  const inherited = createRustRecordFixture({ sourceParameterAbi: {
    get: parameter => ownParameters.has(parameter) ? undefined : context.records.sourceParameterAbi.get(parameter),
  } }, context.records);
  const probe = createRustCarrierProbe({ ...walk, context: { ...context,
    records: createRustProgramRecordBuilder(context.typeDefinitions, inherited) } });
  const sourceCallableAbi = createRustSourceCallableAbiResolver({
    isNativeCallableExpression: probe.moduleBindings.isNativeCallableExpression,
    parameterAbiFor: parameter => probe.context.records.sourceParameterAbi.get(parameter),
    ...(maximumParameterContractSteps === undefined ? {} : { maximumParameterContractSteps }),
  });
  const current = { ...probe, sourceCallableAbi, operationOptions: { ...probe.operationOptions, sourceCallableAbi } };
  const parameterFor = name => parameters.find(parameter =>
    context.ast.text(context.ast.name(context.ast.parent(parameter))) === name);
  const select = parameter => sourceCallableAbi.resolveParameterAbi(parameter,
    rustResolutionContext(current, parameter), current.operationOptions);
  return { current, parameterFor, parameters, select, original: context.records };
}

test("finite parameter components report one typed resource error without partial ABI publication", () => {
  const input = parameterFixture(`export function read(value: string): string { return value; }
    export function independent(value: number): number { return value + 1; }`, 1);
  const parameter = input.parameterFor("read");
  assert.equal(parameter !== undefined, true, "the original parameter is checked");
  const selected = input.select(parameter);
  assert.equal(selected?.kind, "resource-error", "finite work exhaustion is an expected result");
  assert.equal(selected.parameter === parameter, true, "resource failure retains its actual parameter");
  assert.equal(selected.declaration === input.current.context.ast.parent(parameter), true, "exact owning declaration");
  assert.equal(selected.dimension, "parameter-contract-steps", "the exhausted work dimension is named");
  assert.equal(selected.limit, 1, "the actual numeric budget is retained");
  assert.equal(input.select(parameter) === selected, true, "a failed query is not replayed as a guessed ABI");
  assert.equal(input.parameters.every(node => input.current.context.records.sourceParameterAbi.get(node) === undefined), true,
    "no partial component ABI enters the record store");
  const declaration = input.current.context.ast.parent(parameter);
  assert.equal(finalizeRustCallableParameterAbis(input.current, declaration) === undefined, true, "the failed input stage stops");
  assert.equal(finalizeRustCallableParameterAbis(input.current, declaration) === undefined, true, "re-reading the failure stays failed");
  assert.equal(input.current.context.diagnostics.length, 1, "one parameter-admission diagnostic is recorded");
  const issue = input.current.context.diagnostics[0];
  assert.equal(issue.code, "TSONIC_COMPILER_RESOURCE_LIMIT", "not an unsupported language or invariant error");
  assert.equal(issue.sourceNode === parameter, true, "the diagnostic belongs to the actual parameter");
  assert.equal(issue.message.includes("limit: 1"), true, "the diagnostic reports the actual limit");
  assert.equal(input.original.sourceParameterAbi.get(input.parameterFor("independent")) !== undefined, true,
    "valid independent parent records are not erased");
});

for (const [name, source] of [
  ["Copy", `export function read(value: number | readonly number[]): number {
    if (typeof value === "number") return value;
    let total = 0; for (const part of value) total += part; return total;
  }`],
  ["String", `export function read(value: string | readonly string[]): string {
    if (typeof value === "string") return value;
    let total = ""; for (const part of value) total += part; return total;
  }`],
]) test(`a checked ${name} payload return does not retain its entire native union`, () => {
  const input = parameterFixture(source);
  const parameter = input.parameterFor("read");
  assert.equal(parameter !== undefined, true, "the declaration owns the original union input");
  const selected = input.select(parameter);
  assert.equal(selected?.kind, "resolved", "the same finite declaration component completes");
  assert.equal(selected.abi.mode, "ref", "the checked payload and typeof observation do not consume the whole union");
  assert.equal(selected.abi.inputLifetime === undefined, true, "an owned Copy/String result is not a dangling union loan");
  const records = createRustRecordFixture({ sourceParameterAbi: {
    get: node => node === parameter ? undefined : input.current.context.records.sourceParameterAbi.get(node),
  } }, input.current.context.records);
  const sourceProgram = input.current.context.source;
  const observedSource = Object.freeze({ ...sourceProgram, semantics: Object.freeze({ ...sourceProgram.semantics,
    selectValueTypeRefinement(node) {
      const original = sourceProgram.semantics.selectValueTypeRefinement(node);
      return original.kind === "resolved" && original.reference.declaration === parameter
        ? { kind: "unresolved", reference: original.reference, missing: "selected-type" } : original;
    },
  }) });
  const resolver = createRustSourceCallableAbiResolver({
    isNativeCallableExpression: input.current.moduleBindings.isNativeCallableExpression,
    parameterAbiFor: node => records.sourceParameterAbi.get(node),
  });
  const current = { ...input.current, context: { ...input.current.context, source: observedSource, records } };
  const unavailable = resolver.resolveParameterAbi(parameter, rustResolutionContext(current, parameter),
    { ...current.operationOptions, sourceCallableAbi: resolver });
  assert.equal(unavailable === undefined, true, "unavailable checked payload evidence is not a successful owned or borrowed fallback");
});

test("a generic declaration loan uses each completed call's native instantiation", () => {
  const { context } = analyzeRustOperations(`
export function read<Value>(value: Value): Value { return value; }
export function text(): string { return read("value"); }
export function number(): number { return read(7); }
`, { surfaces: [] });
  const calls = context.nativeNodes.filter(node => context.ast.is.IsCallExpression(node) &&
    context.records.targetOperation.get(node)?.kind === "source-call");
  assert.equal(calls.length, 2, "both exact checked native instantiations are retained");
  for (const call of calls) {
    const selected = context.records.targetOperation.get(call);
    const loan = rustSourceCallBorrowedReturn(call, context.ast, context.records);
    assert.equal(loan !== undefined, true, "the published generic loan has a complete selected native parameter binding");
    assert.equal(loan.carrier.kind, "reference", "the call retains the declaration's native borrowed result");
    assert.equal(rustTargetTypeRefEquals(loan.carrier.referent, selected.resultCarrier), true,
      "the reference lends the actual instantiated result, never the declaration's open type parameter");
    assert.equal(loan.argument === context.ast.arguments(call)[0], true, "the loan names its exact original actual argument");
    assert.equal(context.records.sourceCallableReturn.get(loan.declaration)?.borrowedReturn?.parameter === loan.parameter, true,
      "the caller does not change the callee's formal loan contract");
  }
});

for (const [name, source, borrowed] of [
  ["native Copy forwarding", `function leaf(value: number): number { return value + 1; }
    export function read(value: number): number { return leaf(value); }`, false],
  ["read-only helper chain", `function leaf(value: string): number { return value === "value" ? 1 : 0; }
    function middle(value: string): number { return leaf(value); }
    export function read(value: string): number { return middle(value); }`, true],
  ["read-only recursive pair", `function other(value: string, depth: number): number {
      return depth > 0 ? read(value, depth - 1) : value === "value" ? 1 : 0; }
    export function read(value: string, depth: number): number {
      return depth > 0 ? other(value, depth - 1) : value === "value" ? 1 : 0; }`, true],
  ["mutating recursive component", `function other(value: string, depth: number): number {
      value = "changed"; return depth > 0 ? read(value, depth - 1) : value === "value" ? 1 : 0; }
    export function read(value: string, depth: number): number {
      return depth > 0 ? other(value, depth - 1) : value === "value" ? 1 : 0; }`, false],
  ["captured input", `export function read(value: string): number {
      const retained = () => value; return retained() === "value" ? 1 : 0; }`, false],
]) {
  test(`completed native parameter ABI composes ${name} before publication`, () => {
    const input = parameterFixture(source);
    const parameter = input.parameterFor("read");
    assert.equal(parameter !== undefined, true, "the declaration owns its original value input");
    const selected = input.select(parameter);
    assert.equal(selected?.kind, "resolved", "the finite declaration component completes normally");
    assert.equal(selected.abi.mode, borrowed ? "ref" : "value", "the completed component respects every local requirement");
    assert.equal(selected.abi.inputLifetime === undefined, true, "a Copy result does not invent a borrowed output lifetime");
    assert.equal(input.current.context.records.sourceParameterAbi.get(parameter) === undefined, true,
      "the selection query does not create a second record publisher");
    assert.equal(input.current.context.diagnostics.length, 0, "ordinary component selection introduces no resource diagnostic");
  });
}

for (const [name, uses] of [
  ["unused declaration", ""],
  ["stored result", 'const stored = read("value");'],
  ["escaping function", "export const reader = read;"],
  ["different caller operands", 'read("first"); read("second");'],
]) {
  test(`own-body return relation is unchanged by ${name}`, () => {
    const { source, declaration, selected, historyReads } = fixture(
      `export function read(input: string): string { return input; } ${uses}`);
    assert.equal(selected?.parameter === source.ast.parameters(declaration)[0], true,
      "the declaration ABI is not retargeted by calls or first-class destinations");
    assert.equal(historyReads, 0, "return selection does not inspect runtime call history");
  });
}

for (const [name, source, borrowed] of [
  ["opaque native data", "export function read<Value>(value: Value): Value { return value; }", true],
  ["generic recursive data", `export type Tree<Value> = Value | readonly Tree<Value>[];
    export function read<Value>(value: Tree<Value>): Tree<Value> { return value; }`, true],
  ["actual callable storage", "export function read(value: (input: number) => number): (input: number) => number { return value; }", false],
]) test(`a declaration data loan distinguishes ${name} from callable provenance`, () => {
  const input = parameterFixture(source);
  const parameter = input.parameterFor("read");
  assert.equal(parameter !== undefined, true, "the original generic or callable formal is checked");
  const selected = input.select(parameter);
  assert.equal(selected?.kind, "resolved", "the exact native parameter contract is complete");
  assert.equal(selected.abi.mode, borrowed ? "ref" : "value", "actual native representation, not possible instantiations, governs data borrowing");
  assert.equal(selected.abi.inputLifetime !== undefined, borrowed, "only the completed data loan publishes this input lifetime");
  const returned = input.original.sourceCallableReturn.get(input.current.context.ast.parent(parameter));
  assert.equal(returned?.borrowedReturn !== undefined, borrowed, "the physical return agrees with the completed data-loan eligibility");
  if (borrowed) {
    assert.equal(returned.borrowedReturn.parameter === parameter, true, "the result is tied to that same declaration formal");
    assert.equal(returned.borrowedReturn.carrier.kind, "reference", "opaque data is lent without a Clone requirement");
  }
  assert.equal(input.current.context.records.sourceParameterAbi.get(parameter) === undefined, true,
    "the query still does not publish a second parameter record");
});

for (const [name, body] of [
  ["binding mutation", 'input = "changed"; return input;'],
  ["captured parameter", "const capture = () => input; capture(); return input;"],
  ["fresh result", 'return input + "suffix";'],
  ["different result root", 'return input.length > 0 ? input : "fallback";'],
]) {
  test(`own-body return relation does not invent a loan for ${name}`, () => {
    const { selected, historyReads } = fixture(`export function read(input: string): string { ${body} }`);
    assert.equal(selected === undefined, true, "a loan is not proved from this body");
    assert.equal(historyReads, 0, "negative selection is also independent of callers");
  });
}
