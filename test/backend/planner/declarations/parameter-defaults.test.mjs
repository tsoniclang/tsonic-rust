import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, rustSourceText } from "../../../helpers/rust-session.mjs";
import { analyzeRustOperations } from "../../../helpers/rust-operation-analysis.mjs";
import { rustProgramPlanContext, rustProgramWithTypeEmissions, rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";

import { planRustCallableParameters, planRustCallableParameterPrelude } from "../../../../dist/backend/planner/declarations/callables/parameters.js";
import { analyzeRustCallableParameterEmission } from "../../../../dist/analysis/callables/parameters.js";
import { recordRustParameterAbiSelection } from "../../../../dist/analysis/callables/parameter-facts.js";
import { createRustCallableParameterProducer } from "../../../../dist/analysis/program/records/parameter-emission.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustOptionTargetType } from "../../../../dist/target-model/types/carriers/optional.js";
import { selectRustOptionalDefaultStorage } from "../../../../dist/policy/conversions/optional-storage.js";
import { requireRustConstructorContract } from "../../../../dist/backend/planner/declarations/classes/constructor-contracts.js";

test("destructured defaults consume the sealed initialized value and reject conflicting input evidence", () => {
  const source = `
    export function read([value]: [number] = [11], required: number): number { return value + required; }
  `;
  const { program } = analyzeRust({ files: { "index.ts": source } });
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
    const context = { input: { program: { ...program, records } }, sourceFile, nativeHeaderPlacement: sourceFile, nativeHeaderParent: undefined,
      diagnostics: [], usedAliases: new Set(), syntheticNames: names,
      moduleName: "index", structuralShapesModuleName: "shapes",
      moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(),
      externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map() };
    return { selected: planRustCallableParameters(program.records.callableDeclaration.get(callable).contract, context, names, "source-body"), diagnostics: context.diagnostics };
  };
  const valid = plan(abi);
  assert.equal(valid.selected !== undefined, true, "initialized tuple accepts optional transport");
  assert.equal(valid.diagnostics.length, 0);
  assert.deepEqual(valid.selected.prelude.map(entry => entry.kind), ["default", "binding"]);
  const { context: sourceContext, walk } = analyzeRustOperations(source);
  const checkedCallable = sourceContext.sourceStorage.nodes.find(node => sourceContext.ast.is.IsFunctionDeclaration(node));
  assert.equal(checkedCallable !== undefined, true, "the original callable has a real preseal source owner");
  const checkedParameter = sourceContext.ast.parameters(checkedCallable)[0];
  const checkedAbi = sourceContext.records.sourceParameterAbi.get(checkedParameter);
  assert.equal(checkedAbi !== undefined, true, "the original source parameter has one admitted ABI");
  assert.equal(sourceContext.records.callableParameter.get(checkedParameter) === undefined, true,
    "the negative controls run before native parameter emission");
  let conflicts = 0;
  for (const mode of ["ref", "mut-ref"]) {
    const requirementCount = sourceContext.requiredRecords.length;
    assert.throws(() => recordRustParameterAbiSelection(walk, checkedParameter, { ...checkedAbi, mode }), error => {
      assert.equal(error.diagnostic?.code, "TSONIC_INTERNAL_ANALYSIS_INVARIANT", mode);
      assert.equal(error.message, "Conflicting Rust semantic plan 'tsonic.rust.sourceParameterAbi' for one exact source subject.", mode);
      assert.equal(error.diagnostic.source, "tsonic-rust", mode);
      assert.equal(error.diagnostic.category, "error", mode);
      assert.equal(error.diagnostic.sourceNode === checkedParameter, true, `${mode}: the exact checked parameter owns the conflict`);
      return true;
    }, `${mode}: a second ABI cannot replace the admitted default input`);
    assert.equal(sourceContext.records.sourceParameterAbi.get(checkedParameter) === checkedAbi, true,
      `${mode}: the canonical source ABI remains unchanged`);
    assert.equal(sourceContext.records.callableParameter.get(checkedParameter) === undefined, true,
      `${mode}: conflicting inputs never publish a native parameter`);
    assert.equal(sourceContext.requiredRecords.length, requirementCount, `${mode}: no conflicting admission is recorded`);
    conflicts += 1;
  }
  const records = createRustRecordFixture({ sourceParameterAbi: { get: subject => subject === parameter
    ? { ...abi, valueCarrier: { kind: "source-primitive", name: "float64" } }
    : program.records.sourceParameterAbi.get(subject) } }, program.records);
  const producer = createRustCallableParameterProducer(() => {});
  const required = [];
  assert.throws(() => analyzeRustCallableParameterEmission({ program: { ...program, records }, nodes: [parameter],
    callableEntries: program.records.callableLeading, producer, required }), error => {
    assert.equal(error.diagnostic?.code, "TSONIC_INTERNAL_ANALYSIS_INVARIANT");
    assert.equal(error.message, "Binding-pattern parameters require their exact Rust source value and selected native entry carrier.");
    assert.equal(error.diagnostic.source, "tsonic-rust");
    assert.equal(error.diagnostic.category, "error");
    assert.equal(error.diagnostic.sourceNode === parameter, true, "the original checked binding owns the value-carrier refusal");
    return true;
  }, "conflicting exact binding value rejects before native publication");
  assert.equal(producer.records.get(parameter) === undefined, true, "no inconsistent native parameter is published");
  assert.equal(required.length, 0, "a refused native parameter does not register a publication");
  conflicts += 1;
  assert.equal(conflicts, 3, "both old mode conflicts and the exact value-carrier inverse remain covered");
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
      initialization: { kind: "binding" },
    }] }, context, node => {
      evaluations++;
      assert.equal(node === initializer, true, "exact original initializer");
      return { kind: "none" };
    });
    assert.equal(evaluations, 1);
    assert.deepEqual(selected.statements, mutable ? [{ kind: "let", name: "value", mutable: true,
      init: { kind: "path", path: "value" } }] : [],
    "no redundant native alias, while an actual mutability transition remains intact");
    assert.equal(selected.context === context, true, "binding initialization keeps the original body context");
  }
});

test("native initialized returns are selected once with exact binding, Drop and initialization-order inverses", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function direct(value: number): number { return value; }
export function defaulted(value: number = 11): number { return value; }
export function beforeRequired(value: number = 11, other: number): number { return value; }
export function beforeDefault(value: number, other: number = 11): number { return value; }
export function afterDefault(other: number = 11, value: number): number { return value; }
export function ownedOther(value: string = "value", other: string): string { return value; }
export function several(value: number): number { value += 1; return value; }
export function pattern([value]: [number] = [11]): number { return value; }
export function different(value: number): number { return value + 1; }
` } });
  const { ast } = program.source;
  const callables = new Map(ast.statements(program.sourceFiles[0]).filter(ast.is.IsFunctionDeclaration)
    .map(node => [ast.text(ast.name(node)), node]));
  for (const [name, index, kind] of [
    ["direct", 0, "return"], ["defaulted", 0, "return"], ["beforeRequired", 0, "return"],
    ["beforeDefault", 0, "binding"], ["afterDefault", 1, "return"], ["ownedOther", 0, "binding"],
    ["several", 0, "binding"], ["pattern", 0, "binding"], ["different", 0, "binding"],
  ]) {
    const callable = callables.get(name);
    assert.equal(callable !== undefined, true, name + ": original checked owner");
    const parameter = ast.parameters(callable)[index];
    const selected = program.records.callableParameter.get(parameter);
    assert.equal(selected !== undefined, true, name + ": the real parameter producer publishes once");
    assert.equal(selected.initialization.kind, kind, name + ": exact return disposition retains native lifetime and order inverses");
    assert.equal(Object.isFrozen(selected.initialization), true, name + ": the complete disposition is sealed");
    if (kind === "return") assert.equal(selected.initialization.expression ===
      ast.as.AsReturnStatement(ast.statements(ast.body(callable))[0]).Expression, true,
    name + ": only the actual checked return occurrence receives the selected initializer");
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
    const contract = callable === selectedClass.constructor ? requireRustConstructorContract(selectedClass)
      : program.records.callableDeclaration.get(callable).contract;
    const parameters = contract.parameters;
    const context = rustSourceFilePlanContext(program, callable);
    const plan = planRustCallableParameters(contract, context, context.syntheticNames, "source-body");
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
  assert.throws(() => planRustCallableParameters(callable, context, context.syntheticNames, "source-body"), TypeError,
    "a raw callable is not accepted through a compatibility overload");
  const records = createRustRecordFixture({ callableParameter: { get: () => undefined } }, program.records);
  const invalid = rustSourceFilePlanContext({ ...program, records }, callable);
  assert.throws(() => planRustCallableParameters(contract, invalid, invalid.syntheticNames, "source-body"),
    error => error.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      error.message === "An admitted callable parameter requires its sealed native emission record.",
    "the renderer never reconstructs missing parameter storage from the AST");
});
