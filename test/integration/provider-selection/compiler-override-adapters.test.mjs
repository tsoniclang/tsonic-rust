import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustProjectCallableAdaptersKey } from "../../../dist/analysis/facts/project-callable-adapters.js";
import { selectRustCallableParameterAdapters } from "../../../dist/analysis/callables/adapters.js";
import { planRootCallableForwarder } from "../../../dist/backend/planner/objects/polymorphism/callable-adapters.js";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { rustParameterTypeFromCarrierInContext, rustReturnTypeFromCarrierInContext } from "../../../dist/backend/planner/types/render.js";

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
    surfaces: ["js"], packages: [acmeTestingPackage()], files,
    target: { id: "rust", options: { outputType: "bin", crateName: "override_adapter_proof" } },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("override-adapter-proof", result.artifacts, { run: true });
});

test("override adapters retain exact cross-file owners and immutable parameter correspondence", () => {
  const { program } = analyzeRust({ surfaces: ["js"], packages: [acmeTestingPackage()], files });
  const { ast } = program.source;
  const derived = program.projectTypes.definitions.find(definition => definition.sourceName === "PointerSlice");
  assert.ok(derived);
  const adapters = program.facts.getFact(derived.declaration, rustProjectCallableAdaptersKey);
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
  const source = { kind: "type-parameter", name: "Source" };
  const target = { kind: "type-parameter", name: "Target" };
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
  const adapters = program.facts.getFact(definition.declaration, rustProjectCallableAdaptersKey);
  const adapter = adapters.find(entry => entry.contract !== entry.implementation);
  assert.ok(adapter);
  const context = {
    input: { program }, sourceFile: definition.sourceFile, diagnostics: [], usedAliases: new Set(),
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
    const facts = { ...program.facts, getFact: (subject, key) =>
      subject === definition.declaration && key === rustProjectCallableAdaptersKey
        ? replacement : program.facts.getFact(subject, key) };
    assert.equal(plan({ ...context, diagnostics, input: { program: { ...program, facts } } }), undefined);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
  }
});
