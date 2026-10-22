import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, rustSourceText } from "../../../helpers/rust-session.mjs";
import { rustProgramPlanContext, rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";

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
    return { selected: planRustCallableParameters(callable, context, names), diagnostics: context.diagnostics };
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
