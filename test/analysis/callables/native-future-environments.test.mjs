import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { createTargetSourceProgram, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { createSourceStorageQuery, defaultSourceStorageLimits } from "@tsonic/target-api/analysis";
import { createRustNativeFutureInputPlan } from "../../../dist/analysis/callables/native/native-future-inputs.js";
import { createRustLexicalFunctionEnvironmentPlan } from "../../../dist/analysis/callables/values/lexical-functions.js";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";



const sourceText = `import type { int32 } from "@tsonic/core/types.js";
  import type { Ref, Life } from "@tsonic/rust/types.js";
  export function outer<Region extends Life>(value: Ref<Promise<int32>, Region>): void {
    const read = () => value; read();
  }`;

function fixture(text = sourceText) {
  const program = analyzeRustErrorEffects(text, { surfaces: [] });
  const source = program.source;
  const storage = program.sourceStorage;
  const ast = source.ast;
  const lexicalFunctions = createRustLexicalFunctionEnvironmentPlan(source, program.nativeNodes, program.records,
    program.runtimeValueUses, program.sourceCallables);
  const bindings = new Map();
  const bindingsFor = declaration => {
    if (bindings.has(declaration)) return bindings.get(declaration);
    const parent = sourceEnclosingCallable(ast.parent(declaration), ast);
    const selected = storage.bindingsForDeclaration(declaration, parent === undefined ? undefined : bindingsFor(parent));
    const result = selected.kind === "resolved" ? selected.bindings : undefined;
    bindings.set(declaration, result);
    return result;
  };
  const input = { ast, storage, nativeNodes: program.nativeNodes, records: program.records, definitions: program.typeDefinitions,
    lexicalFunctions, bindingsFor };
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
  const capture = current.input.lexicalFunctions.forDeclaration(current.closure).captures[0];
  const malformed = createRustNativeFutureInputPlan({ ...current.input, records: createRustRecordFixture({
runtimeCarrier: { get: (node) => {
    return (node === capture.declaration || node === capture.reference)
        ? { carrier: { kind: "invalid" } } : current.input.records.runtimeCarrier.get(node);
} }}, current.input.records) });
  rejected(malformed.forDeclaration(current.closure), /valid finalized carrier/u);
  const other = fixture();
  const foreignCapture = other.input.lexicalFunctions.forDeclaration(other.closure).captures[0];
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
  const source = createTargetSourceProgram(checked);
  const storage = createSourceStorageQuery(source, program.sourceFiles);
  const declarations = storage.nodes.filter(node => ast.body(node) === undefined &&
    (ast.is.IsFunctionDeclaration(node) || ast.is.IsMethodDeclaration(node) || ast.is.IsMethodSignatureDeclaration(node)));
  assert.equal(declarations.length, 7);
  for (const declaration of declarations) {
    const name = ast.text(ast.name(declaration));
    let nativeDeclaration = declaration;
    if (program.records.nativeParticipation.get(declaration) === "erased") {
      const implementation = source.navigation.callableImplementation(declaration);
      assert.equal(implementation.kind, "resolved", `${name}: an erased overload has its actual checked implementation`);
      nativeDeclaration = implementation.implementation.declaration;
      assert.equal(nativeDeclaration !== declaration && ast.body(nativeDeclaration) !== undefined, true,
        `${name}: the native contract belongs to the concrete implementation, not its erased overload`);
      assert.equal(program.records.nativeParticipation.get(nativeDeclaration) === "erased", false,
        `${name}: the checked implementation is actually admitted`);
    }
    const environment = program.callableValues.nativeStorage.futureEnvironmentFor(nativeDeclaration);
    assert.equal(environment.kind, "resolved", `${name}: ${environment.reason ?? "owned declaration"}`);
    assert.equal(environment.captures.length, 0);
    assert.equal(environment.inputs.length, name === "future" ? 1 : 0, name);
    if (!ast.is.IsMethodSignatureDeclaration(declaration) && name !== "future") {
      for (const parameter of ast.parameters(nativeDeclaration)) {
        const abi = program.records.sourceParameterAbi.get(parameter);
        assert.equal(abi !== undefined, true, name);
        const physical = program.callableValues.nativeStorage.parameterFor(parameter);
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

const finiteFutureInputs = `import type { int32 } from "@tsonic/core/types.js";
  export function outer(left: Promise<int32>, right: Promise<int32>): Promise<int32> {
    const empty = () => 1; empty(); return left;
  }`;

test("published Future environments read only completed owned data after source access is revoked", () => {
  const current = fixture(finiteFutureInputs);
  const source = Proxy.revocable(current.input.ast, {});
  const plan = createRustNativeFutureInputPlan({ ...current.input, ast: source.proxy });
  source.revoke();
  const selected = plan.forDeclaration(current.outer);
  assert.equal(selected.kind, "resolved", selected.reason);
  assert.equal(selected.inputs.length, 2);
  assert.equal(selected.inputs[0] !== selected.inputs[1], true, "equal Future signatures retain distinct owned formals");
  assert.equal(selected.captures.length, 0);
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.inputs) && Object.isFrozen(selected.captures), true);
  assert.equal(plan.forDeclaration(current.outer) === selected, true, "the immutable selection is reused");
  for (const entry of selected.inputs) {
    const subject = plan.forSubject(entry.subject);
    assert.equal(subject.length, 1);
    assert.equal(subject[0] === entry, true, "the subject lookup retains the original exact input");
    assert.equal(plan.forSubject(entry.subject) === subject, true, "subject lookup is already materialized");
  }
  const closure = plan.forDeclaration(current.closure);
  assert.equal(closure.kind, "resolved", closure.reason);
  assert.equal(closure.inputs.length + closure.captures.length, 0, "an exact empty environment stays successful");
  assert.equal(plan.forDeclaration(current.closure) === closure, true);
  const absent = plan.forDeclaration(current.program.sourceFiles[0]);
  rejected(absent, /owned callable declaration/u);
  let reads = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { reads += 1; throw Error("foreign node inspected"); } });
  assert.equal(plan.forDeclaration(foreign) === absent, true, "unowned and noncallable queries share the immutable refusal");
  assert.equal(reads, 0);
});

test("completed Future environment failures remain exact data without later source or lexical queries", () => {
  const current = fixture(finiteFutureInputs);
  const reason = "The selected lexical environment has an exact checked refusal.";
  let queries = 0;
  let published = false;
  const source = Proxy.revocable(current.input.ast, {});
  const plan = createRustNativeFutureInputPlan({ ...current.input, ast: source.proxy, lexicalFunctions: {
    ...current.input.lexicalFunctions,
    forDeclaration(node) {
      assert.equal(published, false, "lexical queries finish before publication");
      queries += 1;
      return node === current.closure ? { kind: "unresolved", reason }
        : current.input.lexicalFunctions.forDeclaration(node);
    },
  } });
  const completedQueries = queries;
  published = true;
  source.revoke();
  const selected = plan.forDeclaration(current.closure);
  rejected(selected, /exact checked refusal/u);
  assert.equal(selected.reason, reason);
  assert.equal(plan.forDeclaration(current.closure) === selected, true, "the final refusal is not recomputed");
  assert.equal(queries, completedQueries);
  const independent = plan.forDeclaration(current.outer);
  assert.equal(independent.kind, "resolved", independent.reason);
  assert.equal(independent.inputs.length, 2, "one failed lexical environment never erases its formal owner");
});
