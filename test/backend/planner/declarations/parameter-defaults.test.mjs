import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, rustSourceText } from "../../../helpers/rust-session.mjs";
import { rustProgramPlanContext, rustProgramWithTypeEmissions, rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";

import { planRustCallableParameters, planRustCallableParameterPrelude } from "../../../../dist/backend/planner/declarations/callables/parameters.js";
import { analyzeRustCallableParameterEmission } from "../../../../dist/analysis/callables/parameters.js";
import { createRustCallableParameterProducer } from "../../../../dist/analysis/program/records/parameter-emission.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustOptionTargetType } from "../../../../dist/target-model/types/carriers/optional.js";
import { selectRustOptionalDefaultStorage } from "../../../../dist/policy/conversions/optional-storage.js";

test("destructured defaults consume the sealed initialized value and reject conflicting input evidence", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function read([value]: [number] = [11], required: number): number { return value + required; }
  ` } });
  const { ast } = program.source;
  const sourceFile = program.sourceFiles[0];
  const callable = ast.statements(sourceFile).find(node => node !== undefined && ast.is.IsFunctionDeclaration(node));
  assert.equal(callable !== undefined, true, "exact authored callable");
  const parameter = ast.parameters(callable)[0];
  const abi = program.records.sourceParameterAbi.get(parameter);
  assert.equal(abi.form, "default");
  assert.equal(abi.valueCarrier.kind, "tuple");
  assert.equal(abi.parameterCarrier.kind, "target-named");
  const plan = (selectedAbi, sourceCarrier = abi.valueCarrier) => {
    const records = createRustRecordFixture({
sourceParameterAbi: { get: (subject) => subject === parameter
    ? selectedAbi : program.records.sourceParameterAbi.get(subject) },
runtimeCarrier: { get: (subject) => subject === parameter
    ? sourceCarrier === undefined ? undefined : { carrier: sourceCarrier }
    : program.records.runtimeCarrier.get(subject) }}, program.records);
    const names = createRustSyntheticNameState(ast, callable, []);
    const context = { input: { program: { ...program, records } }, sourceFile,
      diagnostics: [], usedAliases: new Set(), syntheticNames: names,
      moduleName: "index", structuralShapesModuleName: "shapes",
      moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(),
      externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map() };
    return { selected: planRustCallableParameters(program.records.callableDeclaration.get(callable).contract, context, names), diagnostics: context.diagnostics };
  };
  const valid = plan(abi);
  assert.equal(valid.selected !== undefined, true, "initialized tuple accepts optional transport");
  assert.equal(valid.diagnostics.length, 0);
  assert.deepEqual(valid.selected.prelude.map(entry => entry.kind), ["default", "binding"]);
  // Conflicting binding input is refused where the parameter emission record is sealed (analysis), so the planner
  // never receives it.
  for (const selectedAbi of [{ ...abi, mode: "ref" }, { ...abi, mode: "mut-ref" },
    { ...abi, valueCarrier: { kind: "source-primitive", name: "float64" } }]) {
    const records = createRustRecordFixture({ sourceParameterAbi: { get: (subject) => subject === parameter
      ? selectedAbi : program.records.sourceParameterAbi.get(subject) } }, program.records);
    assert.throws(() => analyzeRustCallableParameterEmission({ program: { ...program, records }, nodes: [parameter],
      producer: createRustCallableParameterProducer(() => {}), required: [] }),
    error => error.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT" &&
      error.message === "Binding-pattern parameters require one exact by-value Rust source and initialized value carrier.",
    "conflicting exact binding input rejects");
  }
});

test("an absent default preserves the native parameter and independently required mutability", () => {
  const carrier = rustOptionTargetType({ kind: "source-primitive", name: "int64" });
  const initializer = {};
  for (const mutable of [false, true]) {
    let evaluations = 0;
    const context = rustProgramPlanContext(rustProgramWithTypeEmissions([carrier]),
      { syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() } });
    const selected = planRustCallableParameterPrelude({ params: [], prelude: [{
      kind: "default", initializer, name: "value", mutable, carrier, valueCarrier: carrier,
      retainStorage: selectRustOptionalDefaultStorage({ storage: carrier, result: carrier }),
    }] }, context, node => {
      evaluations++;
      assert.equal(node === initializer, true, "exact original initializer");
      return { kind: "none" };
    });
    assert.equal(evaluations, 1);
    assert.deepEqual(selected, mutable ? [{ kind: "let", name: "value", mutable: true,
      init: { kind: "path", path: "value" } }] : [],
    "no redundant native alias, while an actual mutability transition remains intact");
  }
});

test("a forwarding Promise adapter applies default and destructuring effects only in its canonical body", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
let calls: int32 = 0;
function next(): [int32] { calls += 1; return [calls]; }
export async function read([value]: [int32] = next(), pending: Promise<void>): Promise<int32> {
  await pending;
  return value;
}` } });
  assert.deepEqual(result.diagnostics.map(issue => `${issue.code}: ${issue.message}`), []);
  const rust = rustSourceText(result);
  assert.equal((rust.match(/\bnext\(\)/gu) ?? []).length, 2, "one declaration and one actual default evaluation");
  const adapter = rust.match(/pub fn read\([\s\S]*?(?=\npub|\nfn|\nasync fn|$)/u)?.[0];
  assert.equal(adapter !== undefined, true, "a real demanded Promise adapter is emitted");
  assert.equal(adapter.includes("next()"), false, "the adapter does not repeat default effects");
  assert.equal(adapter.includes("let value"), false, "the adapter does not destructure again");
  assert.match(adapter, /read_native\(binding_parameter, pending\)/u);
});

test("one formal renderer consumes checked value vectors for functions, methods, accessors and constructors", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function increment(this: void, value: number): number { return value + 1; }
    export class Counter {
      constructor(public value: number = 1) {}
      add(this: Counter, amount: number): number { return this.value + amount; }
      get current(): number { return this.value; }
      set current(value: number) { this.value = value; }
    }
  ` } });
  const ast = program.source.ast;
  const callables = [];
  let selectedClass;
  const visit = node => {
    if (ast.is.IsClassDeclaration(node)) selectedClass = program.records.nativeClass.get(node);
    if (ast.is.IsFunctionDeclaration(node) || ast.is.IsMethodDeclaration(node) || ast.is.IsGetAccessorDeclaration(node) ||
      ast.is.IsSetAccessorDeclaration(node) || ast.is.IsConstructorDeclaration(node)) callables.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(callables.length, 5, "all actual authored formal-owner kinds are represented");
  for (const callable of callables) {
    const contract = callable === selectedClass.constructor ? selectedClass.constructorContract
      : program.records.callableDeclaration.get(callable).contract;
    const parameters = contract.parameters;
    const context = rustSourceFilePlanContext(program, callable);
    const plan = planRustCallableParameters(contract, context, context.syntheticNames);
    assert.equal(plan.params.length, parameters.length, "only selected value formals enter the common renderer");
    assert.equal(plan.params.every(parameter => parameter.name !== "this"), true, "the checked this annotation is not a runtime argument");
    assert.equal(plan.params.every(parameter => parameter.type !== undefined), true, "each actual native parameter has sealed storage syntax");
  }
});

test("the removed raw callable parameter API and missing selected native formals are refused", () => {
  const { program } = analyzeRust({ files: { "index.ts": "export function read(value: number): number { return value; }" } });
  const ast = program.source.ast;
  const callable = ast.statements(program.sourceFiles[0]).find(ast.is.IsFunctionDeclaration);
  const contract = program.records.callableDeclaration.get(callable).contract;
  const parameters = contract.parameters;
  assert.equal(parameters.length, 1, "the refusal control starts from a real selected formal");
  const context = rustSourceFilePlanContext(program, callable);
  assert.throws(() => planRustCallableParameters(callable, context, context.syntheticNames), TypeError,
    "a raw callable is not accepted through a compatibility overload");
  const records = createRustRecordFixture({ callableParameter: { get: () => undefined } }, program.records);
  const invalid = rustSourceFilePlanContext({ ...program, records }, callable);
  assert.throws(() => planRustCallableParameters(contract, invalid, invalid.syntheticNames),
    error => error.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      error.message === "An admitted callable parameter requires its sealed native emission record.",
    "the renderer never reconstructs missing parameter storage from the AST");
});
