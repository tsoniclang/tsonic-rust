import { createRustRecordFixture } from "../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

import { selectRustCallableParameterAdapters } from "../../../dist/policy/conversions/callable-adapters.js";
import { planRootCallableForwarder } from "../../../dist/backend/planner/objects/polymorphism/callable-adapters.js";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/syntax/nodes.js";
import { rustParameterTypeFromCarrierInContext, rustReturnTypeFromCarrierInContext } from "../../../dist/backend/planner/types/render.js";
import { planRustCallableArguments } from "../../../dist/backend/planner/declarations/callables/parameter-adapters.js";
import { closedMetadataKey } from "../../../dist/target-model/metadata/closed-data.js";
import { rustSourcePrimitiveTargetType, rustVecTargetType } from "../../../dist/target-model/types/index.js";

const files = {
  "base.ts": `
export class Slice<T> {
  value: T;
  constructor(value: T) { this.value = value; }
  set(index: number, value: T): T { this.value = value; return value; }
  resize(length: number): number { return length; }
  result(): number | bigint { return 0n; }
}
`,
  "derived.ts": `
import { Slice } from "./base.js";
export class PointerSlice<T> extends Slice<T> {
  last: number | bigint = 0;
  set(index: number | bigint, value: T): T { this.last = index; this.value = value; return value; }
  resize(length?: number): number { return length ?? 12; }
  result(): number { return 9; }
}
`,
  "index.ts": `
import { check } from "@acme/testing";
import { Slice } from "./base.js";
import { PointerSlice } from "./derived.js";
export function main(): void {
  const direct = new PointerSlice<number>(0);
  const base: Slice<number> = direct;
  check(base.set(3, 7) === 7 && direct.last === 3 && base.value === 7);
  check(direct.set(9007199254740993n, 8) === 8 && direct.last === 9007199254740993n);
  check(base.resize(4) === 4 && direct.resize() === 12);
  check(base.result() === 9 && direct.result() === 9);
}
`,
};

test("checked overrides adapt widened inputs and narrowed outputs without changing native domains", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()], files: { ...files, "index.ts": files["index.ts"] + "\nmain();\n" },
    target: { id: "rust", options: { outputType: "bin", crateName: "override_adapter_proof" } },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /SourceNumeric::strict_equal\([^\n]*&\*/u);
  validateGeneratedProject("override-adapter-proof", result.artifacts, { run: true });
});

test("override adapters retain exact cross-file owners and immutable parameter correspondence", () => {
  const { program } = analyzeRust({ surfaces: ["js"], packages: [acmeTestingPackage()], files });
  const { ast } = program.source;
  const derived = program.projectTypes.definitions.find(definition => definition.sourceName === "PointerSlice");
  assert.ok(derived);
  const adapters = program.records.projectCallableAdapters.get(derived.declaration);
  assert.ok(Object.isFrozen(adapters));
  const setAdapter = adapters.find(adapter => ast.text(ast.name(adapter.contract)) === "set" &&
    program.projectTypes.definitionContainingDeclaration(adapter.contract).sourceName === "Slice" &&
    adapter.contract !== adapter.implementation);
  assert.ok(setAdapter);
  assert.equal(program.projectTypes.definitionContainingDeclaration(setAdapter.implementation), derived);
  assert.ok(Object.isFrozen(setAdapter));
  assert.ok(Object.isFrozen(setAdapter.parameterAdapters));
  assert.deepEqual(setAdapter.parameterAdapters.map(adapter => adapter.contractParameterIndex), [0, 1]);
  assert.equal(setAdapter.parameterAdapters[0].adapter.kind, "conversion");
  assert.equal(setAdapter.parameterAdapters[1].adapter.kind, "identity");
  assert.throws(() => { setAdapter.parameters[0].mode = "mut-ref"; }, TypeError);
});

test("callable adapters cannot infer conversions from incompatible native slots", () => {
  const projectTypes = {
    definitionForCarrier: () => undefined,
    relationship: () => ({ kind: "unrelated" }),
  };
  const source = { kind: "type-parameter", identity: "Source", name: "Source" };
  const target = { kind: "type-parameter", identity: "Target", name: "Target" };
  const parameter = carrier => ({ form: "required", mode: "value", valueCarrier: carrier, parameterCarrier: carrier });
  assert.equal(selectRustCallableParameterAdapters([parameter(source)], [parameter(target)], projectTypes), undefined);
  assert.equal(selectRustCallableParameterAdapters([], [parameter(target)], projectTypes), undefined);
});

test("native dispatch rejects missing, duplicated and corrupted adapter facts before printing", () => {
  const { program } = analyzeRust({
    surfaces: ["js"],
    files: { "index.ts": `
class Base { value(input: number): number { return input; } }
class Derived extends Base { value(input: number | bigint): number { return Number(input); } }
export function main(): void { const value: Base = new Derived(); value.value(3); }
` },
  });
  const definition = program.projectTypes.definitions.find(entry => entry.sourceName === "Derived");
  const carrier = program.projectTypes.openCarrier(definition);
  const adapters = program.records.projectCallableAdapters.get(definition.declaration);
  const adapter = adapters.find(entry => entry.contract !== entry.implementation);
  assert.ok(adapter);
  const context = {
    input: { program }, sourceFile: definition.sourceFile, nativeHeaderPlacement: definition.sourceFile, nativeHeaderParent: undefined, diagnostics: [], usedAliases: new Set(),
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  };
  const parameters = abis => abis.map((abi, index) => ({
    name: `argument_${index}`, type: rustParameterTypeFromCarrierInContext(abi.parameterCarrier, context),
  }));
  const helper = {
    name: "exact_value", visibility: "private", generics: emptyRustGenerics,
    selfParam: { kind: "rc" }, params: parameters(adapter.implementationParameters),
    returnType: rustReturnTypeFromCarrierInContext(adapter.implementationReturnCarrier, context),
    body: { statements: [] },
  };
  const shape = {
    params: parameters(adapter.parameters), isUnsafe: false,
    returnType: rustReturnTypeFromCarrierInContext(adapter.returnCarrier, context),
  };
  const plan = selectedContext => planRootCallableForwarder(carrier, adapter.contract, adapter.implementation,
    adapter.slot, { kind: "named", path: "DerivedRoot" }, helper, shape, undefined, selectedContext);
  assert.ok(plan(context));
  for (const replacement of [
    [],
    [adapter, adapter],
    [{ ...adapter, implementation: adapter.contract }],
    [{ ...adapter, parameterAdapters: [{ ...adapter.parameterAdapters[0], contractParameterIndex: 1 }] }],
    [{ ...adapter, implementationParameters: [] }],
  ]) {
    const diagnostics = [];
    const records = createRustRecordFixture({
projectCallableAdapters: { get: (subject) => subject === definition.declaration
    ? replacement : program.records.projectCallableAdapters.get(subject) }}, program.records);
    assert.equal(plan({ ...context, diagnostics, input: { program: { ...program, records } } }), undefined);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
  }
});

test("rest dispatch rejects reordered logical heads and forged tail offsets", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
class Base { read(...values: number[]): number { return values[0]; } }
class Derived extends Base { read(first: number, ...rest: number[]): number { return first; } }
export function main(): void { const value: Base = new Derived(); value.read(1, 2); }
` } });
  const definition = program.projectTypes.definitions.find(entry => entry.sourceName === "Derived");
  const adapters = program.records.projectCallableAdapters.get(definition.declaration);
  const adapter = adapters.find(entry => entry.contract !== entry.implementation);
  assert.ok(adapter);
  const context = {
    input: { program }, sourceFile: definition.sourceFile, nativeHeaderPlacement: definition.sourceFile, nativeHeaderParent: undefined, diagnostics: [], usedAliases: new Set(),
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  };
  const selection = {
    declaration: adapter.implementation, parameterAbis: adapter.parameters,
    parameters: adapter.parameters.map((abi, index) => ({ name: `argument_${index}`,
      type: rustParameterTypeFromCarrierInContext(abi.parameterCarrier, context) })),
    parameterAdapters: adapter.parameterAdapters,
  };
  assert.deepEqual(adapter.parameterAdapters.map(parameter => parameter.kind), ["rest-element", "rest"]);
  const head = adapter.parameterAdapters[0];
  const tail = adapter.parameterAdapters[1];
  const number = rustSourcePrimitiveTargetType("float64");
  const targetShape = target => ({ form: target.form, mode: target.mode,
    value: closedMetadataKey(target.valueCarrier), parameter: closedMetadataKey(target.parameterCarrier) });
  assert.deepEqual(adapter.parameterAdapters.map(parameter => ({
    kind: parameter.kind,
    contractParameterIndex: parameter.contractParameterIndex,
    offset: parameter.kind === "rest-element" ? parameter.offset : undefined,
    target: targetShape(parameter.target),
    segments: parameter.kind === "rest" ? parameter.segments.map(segment => ({
      kind: segment.kind, contractParameterIndex: segment.contractParameterIndex,
      offset: segment.kind === "sequence" ? segment.offset : undefined,
    })) : undefined,
  })), [{
    kind: "rest-element", contractParameterIndex: 0, offset: 0,
    target: { form: "required", mode: "value", value: closedMetadataKey(number), parameter: closedMetadataKey(number) },
    segments: undefined,
  }, {
    kind: "rest", contractParameterIndex: undefined, offset: undefined,
    target: { form: "rest", mode: "value", value: closedMetadataKey(rustVecTargetType(number)),
      parameter: closedMetadataKey(rustVecTargetType(number)) },
    segments: [{ kind: "sequence", contractParameterIndex: 0, offset: 1 }],
  }], "the native producer owns the complete original head, tail, target, index and offset correspondence");
  const frozen = value => {
    if (value === null || typeof value !== "object") return;
    assert.equal(Object.isFrozen(value), true, "every admitted vector, segment, target and carrier object is frozen");
    for (const child of Object.values(value)) frozen(child);
  };
  frozen(adapter.parameterAdapters);
  for (const replacement of [
    [null, tail],
    [{ ...head, target: undefined }, tail],
    [{ ...head, target: { ...head.target, parameterCarrier: undefined } }, tail],
    [{ ...head, target: { ...head.target, mode: "unknown" } }, tail],
    [tail, head],
    [{ ...head, offset: 1 }, tail],
    [head, { ...tail, segments: [{ ...tail.segments[0], offset: 0 }] }],
    [head, { ...tail, segments: [{ ...tail.segments[0], contractParameterIndex: 1 }] }],
    [head, { ...tail, segments: [tail.segments[0], tail.segments[0]] }],
  ]) assert.throws(() => {
    adapter.parameterAdapters.splice(0, adapter.parameterAdapters.length, ...replacement);
  }, TypeError, "a forged vector cannot replace the canonical native producer result");
  assert.ok(planRustCallableArguments(selection, context));
});
