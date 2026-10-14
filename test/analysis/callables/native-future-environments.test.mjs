import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { createTargetSourceProgram, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { createSourceStorageQuery, defaultSourceStorageLimits } from "@tsonic/target-api/analysis";
import { createRustNativeFutureInputPlan } from "../../../dist/analysis/callables/native-future-inputs.js";



const sourceText = `import type { int32 } from "@tsonic/core/types.js";
  import type { Ref, Life } from "@tsonic/rust/types.js";
  export function outer<Region extends Life>(value: Ref<Promise<int32>, Region>): void {
    const read = () => value; read();
  }`;

function fixture() {
  const { program, source: checked } = analyzeRust({ surfaces: [], files: { "index.ts": sourceText } });
  const source = createTargetSourceProgram(checked);
  const storage = createSourceStorageQuery(source, program.sourceFiles);
  const ast = source.ast;
  const bindings = new Map();
  const bindingsFor = declaration => {
    if (bindings.has(declaration)) return bindings.get(declaration);
    const parent = sourceEnclosingCallable(ast.parent(declaration), ast);
    const selected = storage.bindingsForDeclaration(declaration, parent === undefined ? undefined : bindingsFor(parent));
    const result = selected.kind === "resolved" ? selected.bindings : undefined;
    bindings.set(declaration, result);
    return result;
  };
  const input = { ast, storage, records: program.records, definitions: program.typeDefinitions,
    lexicalFunctions: program.lexicalFunctions, bindingsFor };
  const outer = storage.nodes.find(node => ast.is.IsFunctionDeclaration(node));
  const closure = storage.nodes.find(node => ast.is.IsArrowFunction(node));
  assert.equal(outer !== undefined && closure !== undefined, true, "source declarations exist");
  return { program, source, input, outer, closure };
}

function rejected(selection, pattern) {
  assert.equal(selection.kind, "unresolved", "failed capture proof is not an empty environment");
  assert.match(selection.reason, pattern);
  assert.equal(Object.isFrozen(selection), true);
}

test("direct lexical Future captures retain exact outer formals without a retained closure fact", () => {
  const current = fixture();
  for (const plan of [createRustNativeFutureInputPlan(current.input), {
    forDeclaration: current.program.callableValues.nativeStorage.futureEnvironmentFor,
  }]) {
    const outer = plan.forDeclaration(current.outer);
    const selected = plan.forDeclaration(current.closure);
    assert.equal(outer.kind, "resolved", outer.reason);
    assert.equal(selected.kind, "resolved", selected.reason);
    assert.equal(outer.inputs.length, 1);
    assert.equal(selected.inputs.length, 0);
    assert.equal(selected.captures.length, 1);
    assert.equal(selected.captures[0] === outer.inputs[0], true, "the exact outer F is carried into lexical emission");
    assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.captures), true);
    assert.equal(plan.forDeclaration(current.closure) === selected, true, "sealed selection reused");
  }
});

test("Future capture environments reject missing and foreign source activation bindings", () => {
  const current = fixture();
  const missing = createRustNativeFutureInputPlan({ ...current.input, bindingsFor: () => undefined });
  rejected(missing.forDeclaration(current.closure), /exact declaration-local bindings/u);
  assert.equal(missing.forDeclaration(current.outer).kind, "resolved", "independent formal owner remains exact");
  const foreignStorage = createSourceStorageQuery(current.source, current.program.sourceFiles);
  const foreign = createRustNativeFutureInputPlan({ ...current.input, bindingsFor: () => foreignStorage.emptyBindings });
  rejected(foreign.forDeclaration(current.closure), /Invocation substitutions belong to a different source storage query/u);
  rejected(missing.forDeclaration(fixture().closure), /owned callable declaration/u);
});

test("Future capture discovery preserves unresolved checked provenance instead of omitting captures", () => {
  const current = fixture();
  const reason = "Checked capture activation exceeded its exact source budget.";
  const plan = createRustNativeFutureInputPlan({ ...current.input, storage: {
    ...current.input.storage, boundOriginsFor: () => ({ kind: "unresolved", reason }),
  } });
  const selected = plan.forDeclaration(current.closure);
  rejected(selected, /Checked capture activation/u);
  assert.equal(selected.reason, reason);
  const forged = createRustNativeFutureInputPlan({ ...current.input, storage: {
    ...current.input.storage,
    boundOriginsFor(subject, bindings) {
      const selected = current.input.storage.boundOriginsFor(subject, bindings);
      assert.equal(selected.kind, "resolved", selected.reason);
      return { kind: "resolved", subjects: selected.subjects.map(origin => ({ ...origin })) };
    },
  } });
  rejected(forged.forDeclaration(current.closure), /different transport graph/u);
});

test("Future capture environments reject malformed carrier facts and foreign capture references", () => {
  const current = fixture();
  const capture = current.program.lexicalFunctions.forDeclaration(current.closure).captures[0];
  const malformed = createRustNativeFutureInputPlan({ ...current.input, records: createRustRecordFixture({
runtimeCarrier: { get: (node) => {
    return (node === capture.declaration || node === capture.reference)
        ? { carrier: { kind: "invalid" } } : current.input.records.runtimeCarrier.get(node);
} }}, current.input.records) });
  rejected(malformed.forDeclaration(current.closure), /valid finalized carrier/u);
  const other = fixture();
  const foreignCapture = other.program.lexicalFunctions.forDeclaration(other.closure).captures[0];
  const foreign = createRustNativeFutureInputPlan({ ...current.input, lexicalFunctions: {
    ...current.input.lexicalFunctions,
    forDeclaration(node) {
      const original = current.input.lexicalFunctions.forDeclaration(node);
      return node === current.closure ? { ...original, captures: [foreignCapture] } : original;
    },
  } });
  rejected(foreign.forDeclaration(current.closure), /owned reference/u);
});

test("exhausted shared capture accounting cannot produce a successful empty Future environment", () => {
  const current = fixture();
  const storage = createSourceStorageQuery(current.source, current.program.sourceFiles,
    { ...defaultSourceStorageLimits, maximumSteps: 100_000 });
  for (let index = 0; index < 100_001 && storage.failureReason() === undefined; index += 1)
    storage.subject(current.closure, "return");
  assert.equal(storage.failureReason() !== undefined, true, "bounded shared query has exhausted its actual budget");
  const plan = createRustNativeFutureInputPlan({ ...current.input, storage });
  rejected(plan.forDeclaration(current.closure), /budget|exceeds|limit/iu);
});

test("owned bodyless callable contracts retain environments without requiring an implementation body", () => {
  const { program, source: checked } = analyzeRust({ surfaces: [], files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    export interface Reader { read(value: int32): int32; empty(): void; future(value: Promise<int32>): void; }
    export abstract class Base { abstract get(value: int32): int32; }
    export declare function provided(value: int32): int32;
    export declare function future(value: Promise<int32>): void;
    export function declared(value: int32): int32;
    export function declared(value: int32): int32 { return value; }
  ` } });
  const ast = program.source.ast;
  const storage = createSourceStorageQuery(createTargetSourceProgram(checked), program.sourceFiles);
  const declarations = storage.nodes.filter(node => ast.body(node) === undefined &&
    (ast.is.IsFunctionDeclaration(node) || ast.is.IsMethodDeclaration(node) || ast.is.IsMethodSignatureDeclaration(node)));
  assert.equal(declarations.length, 7);
  for (const declaration of declarations) {
    const name = ast.text(ast.name(declaration));
    const environment = program.callableValues.nativeStorage.futureEnvironmentFor(declaration);
    assert.equal(environment.kind, "resolved", `${name}: ${environment.reason ?? "owned declaration"}`);
    assert.equal(environment.captures.length, 0);
    assert.equal(environment.inputs.length, name === "future" ? 1 : 0, name);
    if (!ast.is.IsMethodSignatureDeclaration(declaration) && name !== "future") {
      for (const parameter of ast.parameters(declaration)) {
        const abi = program.records.sourceParameterAbi.get(parameter);
        assert.equal(abi !== undefined, true, name);
        const physical = program.callableValues.nativeStorage.parameterFor(parameter, abi.parameterCarrier);
        assert.equal(physical.kind, "identity", `${name}: ${physical.reason ?? "ordinary native parameter"}`);
      }
    }
  }
  rejected(program.callableValues.nativeStorage.futureEnvironmentFor(program.sourceFiles[0]), /owned callable declaration/u);
  let reads = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { reads++; throw Error("foreign node inspected"); } });
  rejected(program.callableValues.nativeStorage.futureEnvironmentFor(foreign), /owned callable declaration/u);
  assert.equal(reads, 0);
});
