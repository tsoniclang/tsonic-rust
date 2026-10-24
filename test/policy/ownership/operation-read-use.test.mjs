import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram, Node_Expression } from "@tsonic/target-api/source";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustReadUses, rustNativeArgumentBorrowsRead } from "../../../dist/analysis/ownership/uses.js";
import { selectRustOperationReadUses } from "../../../dist/policy/ownership/read-use.js";
import { finalizeRustProviderOperationAbi } from "../../../dist/policy/operations/members/abi/finalize.js";
import { rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { createRustRecordFixture } from "../../helpers/records.mjs";

test("a native compound receiver keeps its complete getter-index and RHS interval through transparent wrappers", async () => {
  const source = createTargetSourceProgram(await checkedSource("ownership-compound-receiver-interval", {
    "src/index.ts": `
declare function index(): number;
declare function next(): number;
function run(values: number[]): void {
  values[index()] += next();
  (((values[index()]))) += next();
  values[index()] = next();
}
`,
  }));
  const { ast } = source;
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  source.sourceFiles.forEach(visit);
  const assignments = nodes.filter(node => ast.is.IsBinaryExpression(node));
  assert.equal(assignments.length, 3, "ordinary, wrapped compound and plain assignments retain all original occurrences");
  const integer = { kind: "source-primitive", name: "int32" };
  const receiverCarrier = { kind: "target-named", id: "fixture.NativeReceiver" };
  const getter = finalizeRustProviderOperationAbi({ operationKind: "indexer",
    form: { form: "method", name: "get" },
    sourceReceiver: { kind: "runtime", carrier: receiverCarrier }, sourceArgumentCarriers: [integer],
    resultCarrier: integer, isAsync: false, isFallible: false });
  assert.equal(getter !== undefined, true, "the selected getter supplies its actual shared native receiver ABI");
  const operations = new Map();
  for (const [index, assignment] of assignments.entries()) {
    let left = ast.as.AsBinaryExpression(assignment).Left;
    while (ast.is.IsParenthesizedExpression(left)) left = Node_Expression(ast, left);
    operations.set(left, { kind: "provider-operation", operationId: "fixture::get", abi: getter });
    operations.set(assignment, { kind: "operator-token", operationId: "fixture.assignment",
      operator: index === 2 ? "=" : "+=", resultCarrier: integer, operandModes: ["value", "value"] });
  }
  const records = createRustRecordFixture({ targetOperation: { get: node => operations.get(node) } });
  const uses = analyzeRustReadUses(ast, nodes, records, {}, () => false, { field: () => undefined });
  for (const [index, assignment] of assignments.entries()) {
    const binary = ast.as.AsBinaryExpression(assignment);
    let left = binary.Left;
    while (ast.is.IsParenthesizedExpression(left)) left = Node_Expression(ast, left);
    const element = ast.as.AsElementAccessExpression(left);
    const use = uses.get(element.Expression);
    assert.equal(use?.mode, "shared", `assignment ${index}: the existing native receiver read mode is unchanged`);
    assert.equal(use.later[0] === element.ArgumentExpression, true, `assignment ${index}: getter index executes first`);
    assert.equal(use.later.length, index === 2 ? 1 : 2, `assignment ${index}: only a read-modify-write holds its receiver through RHS`);
    if (index !== 2) assert.equal(use.later[1] === binary.Right, true, `assignment ${index}: the complete original RHS participates in alias/effect proof`);
    assert.equal(use.laterStart, 0, `assignment ${index}: no index/RHS effect is skipped`);
    assert.equal(use.stableAcrossEffects, true, `assignment ${index}: existing stability policy is transported, not invented`);
    assert.equal(Object.isFrozen(use.later), true, `assignment ${index}: the published interval is immutable`);
  }
});

function select(ast, node, operation) {
  return selectRustOperationReadUses(ast, node, { operation, computedMember: undefined, nativeInputs: [], argumentModes: [],
    arguments: undefined, address: undefined, location: undefined, guard: undefined, callableMode: undefined, structuralReceiverMode: "shared" });
}

test("native reference loads and stores select only their actual operand's nonconsuming place use", async () => {
  const source = createTargetSourceProgram(await checkedSource("ownership-native-reference-operands", {
    "src/index.ts": `
declare function load(value: number): number;
declare function store(target: number, value: number): void;
declare function ref(value: number): number;
declare function mut(value: number): number;
declare function target(): number;
declare function next(): number;
function run(value: number): void {
  load(value);
  load(((value)));
  store(value, load(value) + 1);
  store(((value)), next());
  store(target(), next());
  ref(value);
  mut(value);
}
`,
  }));
  const { ast } = source;
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  source.sourceFiles.forEach(visit);
  const integer = { kind: "source-primitive", name: "int32" };
  const shared = { kind: "reference", mutable: false, referent: integer };
  const mutable = { ...shared, mutable: true };
  const operations = new Map();
  for (const node of nodes.filter(node => ast.is.IsCallExpression(node))) {
    const name = ast.text(Node_Expression(ast, node));
    if (!["load", "store", "ref", "mut"].includes(name)) continue;
    const [operandExpression, valueExpression] = ast.arguments(node);
    const operation = name === "ref" ? "shared-reference" : name === "mut" ? "mutable-reference" : name;
    const operandCarrier = name === "ref" || name === "mut" ? integer : mutable;
    const fact = { kind: "reference-operation", operationId: `fixture.reference.${operation}`, operation,
      operandExpression, operandCarrier, referenceCarrier: name === "ref" ? shared : mutable,
      resultCarrier: name === "store" ? { kind: "tuple", elements: [] } : name === "load" ? integer : name === "ref" ? shared : mutable,
      ...(name === "store" ? { valueExpression, valueCarrier: integer } : {}) };
    operations.set(node, fact);
    const variants = name === "load" ? [fact, { ...fact, operandCarrier: shared, referenceCarrier: shared }] : [fact];
    for (const selected of variants) {
      const uses = select(ast, node, selected);
      const use = uses.get(operandExpression);
      const label = `${name} ${operations.size}: ${ast.kindName(operandExpression)} / ${selected.operandCarrier.mutable ?? "value"}`;
      assert.equal(uses.size, 1, `${label}: only the exact admitted reference operand acquires a use`);
      assert.equal(use?.mode, name === "store" || name === "mut" ? "mutable" : "shared", label);
      assert.equal(use.later.length, 0, `${label}: a place use does not invent a borrow held across RHS evaluation`);
      assert.equal(use.laterStart, 0, `${label}: no original effect is skipped`);
      assert.equal(use.stableAcrossEffects, false, `${label}: replacement or mutation is not presumed harmless`);
      assert.equal(Object.isFrozen(use), true, `${label}: the selected ownership input is immutable`);
      if (valueExpression !== undefined) assert.equal(uses.has(valueExpression), false,
        `${label}: the stored value retains its original ownership decision`);
    }
  }
  assert.equal(operations.size, 8, "all direct, wrapped, repeated, effectful-target and reference-creation occurrences are covered");
  const records = createRustRecordFixture({ targetOperation: { get: node => operations.get(node) } });
  const uses = analyzeRustReadUses(ast, nodes, records, {}, () => false, { field: () => undefined });
  for (const [node, operation] of operations) {
    let operand = operation.operandExpression;
    const mode = operation.operation === "store" || operation.operation === "mutable-reference" ? "mutable" : "shared";
    while (true) {
      assert.equal(uses.get(operand)?.mode, mode, `${operation.operation}: every original transparent operand keeps its selected role`);
      if (!ast.is.IsParenthesizedExpression(operand)) break;
      operand = Node_Expression(ast, operand);
    }
    if (operation.operation === "store") assert.equal(uses.has(operation.valueExpression), false,
      `${operation.operation}: independent nested loads do not borrow the complete stored value`);
  }
});

test("repeated native reference loads and stores reach their real sealed ownership and write plans", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Mut, Ref } from "@tsonic/rust/types.js";
import { load, store } from "@tsonic/rust/lang.js";
export function update(target: Mut<int32>, source: Ref<int32>): int32 {
  store(target, load(target) + 1);
  store(((target)), load(((target))) + 1);
  store(target, load(source));
  return load(target) + load(source);
}
export function replace(target: Mut<string>, value: string): void { store(target, value); }
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "reference-operation") {
      operations.push(fact);
      const use = program.records.readOwnership.get(fact.operandExpression);
      assert.equal(use?.source.kind, "borrow", `${fact.operation}: the real native handle is not transferred or cloned`);
      assert.equal(use.source.mutable, fact.operation === "store", `${fact.operation}: the exact native use mode is preserved`);
      assert.equal(program.records.referenceOperation.get(node)?.operation === fact, true,
        `${fact.operation}: rendering reads the same admitted operation, not a new selector`);
      if (fact.operation === "store") {
        assert.equal(program.records.readOwnership.get(fact.valueExpression)?.value.kind === "borrow", false,
          "the stored native value is not reclassified as a borrowed handle");
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(operations.filter(operation => operation.operation === "load").length, 5,
    "all repeated shared and mutable loads retain their real source occurrences");
  assert.equal(operations.filter(operation => operation.operation === "store").length, 4,
    "all direct, wrapped, disjoint and owned-value stores are admitted");
  assert.equal(operations.filter(operation => operation.operation === "store" && operation.writeStrategy !== undefined).length, 1,
    "only the existing exact-identifier compound recipe is selected; wrappers are not guessed equivalent");
});

test("a shared native reference still cannot be passed to the mutable store contract", () => {
  assert.throws(() => compileRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Ref } from "@tsonic/rust/types.js";
import { store } from "@tsonic/rust/lang.js";
export function invalid(value: Ref<int32>): void { store(value, 1); }
` } }), failure => typeof failure?.message === "string" && failure.message.includes("TypeScript diagnostics:") &&
    failure.message.includes("Ref") && failure.message.includes("Mut"),
  "the checked immutable-reference inverse fails at the existing native mutable-reference admission boundary");
});

test("nested native result lifetimes retain only their corresponding reference input", async () => {
  const source = createTargetSourceProgram(await checkedSource("ownership-native-result-borrow", {
    "src/index.ts": `
declare function ref(value: string): string;
declare function borrowed(value: string): string;
declare function combined(first: string, second: string): string;
function run(value: string): string { return combined(borrowed(ref(value)), value); }
`,
  }));
  const { ast } = source;
  const calls = new Map();
  const visit = node => {
    if (ast.is.IsCallExpression(node)) calls.set(ast.text(Node_Expression(ast, node)), node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  source.sourceFiles.forEach(visit);
  assert.equal(calls.size, 3, "the checked source has all three original calls");
  const nested = calls.get("borrowed");
  const referenceCall = calls.get("ref");
  const reference = ast.arguments(referenceCall)[0];
  const valueCarrier = rustStringTargetType();
  const lifetime = { kind: "parameter", identity: "native-region", name: "Region" };
  const nativeReference = { kind: "reference", mutable: false, referent: valueCarrier, lifetime };
  for (const [label, resultCarrier, parameterCarrier, expected] of [
    ["matching native region", nativeReference, nativeReference, true],
    ["same spelling but distinct native region", nativeReference,
      { ...nativeReference, lifetime: { ...lifetime, identity: "other-region" } }, false],
    ["owned result does not retain its input", valueCarrier, nativeReference, false],
    ["unknown native input lifetime is not invented", nativeReference,
      { kind: "reference", mutable: false, referent: valueCarrier }, false],
  ]) {
    const operations = new Map([
      [referenceCall, { kind: "reference-operation", operation: "shared-reference", operandExpression: reference }],
      [nested, { kind: "source-call", resultCarrier, parameters: [{ parameterCarrier,
        inputs: [{ sourceArgumentIndex: 0, sourceForm: "value", sourceParameterForm: "parameter", carrier: nativeReference }] }] }],
    ]);
    const records = { targetOperation: { get: node => operations.get(node) },
      runtimeCarrier: { get: node => node === nested ? { carrier: resultCarrier } : undefined },
      argumentPassing: { get: () => undefined } };
    assert.equal(rustNativeArgumentBorrowsRead(nested, reference, ast, records), expected, label);
    assert.equal(rustNativeArgumentBorrowsRead(referenceCall, reference, ast, records), true,
      `${label}: the direct explicit reference remains borrowed`);
  }
});

test("operator ownership consumes selected operand modes instead of rediscovering them from token or result type", async () => {
  const source = createTargetSourceProgram(await checkedSource("ownership-native-operand-modes", {
    "src/index.ts": "function add(left: number, right: number) { return left + right; }",
  }));
  let node;
  const visit = current => {
    if (source.ast.is.IsBinaryExpression(current)) node = current;
    source.ast.forEachChild(current, child => { if (child !== undefined) visit(child); });
  };
  for (const file of source.sourceFiles) visit(file);
  assert.equal(node !== undefined, true, "checked binary operands");
  const binary = source.ast.as.AsBinaryExpression(node);
  for (const [modes, expected] of [
    [["value", "value"], [undefined, undefined]],
    [["ref", "value"], ["shared", undefined]],
    [["value", "ref"], [undefined, "shared"]],
    [["mut-ref", "ref"], ["mutable", "shared"]],
  ]) {
    const operation = { kind: "operator-token", operationId: "fixture-selected-native-operands",
      operator: "+", resultCarrier: { kind: "source-primitive", name: "float64" }, operandModes: modes };
    for (const selected of [operation, { ...operation, kind: "operator-call", path: "fixture::add", fallible: false }]) {
      const uses = select(source.ast, node, selected);
      assert.deepEqual([uses.get(binary.Left)?.mode, uses.get(binary.Right)?.mode], expected);
      if (uses.has(binary.Left)) assert.equal(uses.get(binary.Left).later[0] === binary.Right, true);
    }
  }
});

test("evaluation-only native source inputs have terminal nonconsuming uses for reads, calls and setters", async () => {
  const source = createTargetSourceProgram(await checkedSource("ownership-evaluation-only-inputs", {
    "src/index.ts": `
interface Native { value: Native; call(value: Native): Native; [index: number]: Native; }
function observed(receiver: Native, value: Native, index: number): void {
  receiver.value;
  receiver.call(value);
  receiver.value = value;
  receiver[index] = value;
}
`,
  }));
  const carrier = { kind: "target-named", id: "fixture.Native" };
  const integer = { kind: "source-primitive", name: "int32" };
  const nodes = [];
  const visit = node => {
    if (source.ast.is.IsCallExpression(node) || source.ast.is.IsBinaryExpression(node) ||
      source.ast.is.IsPropertyAccessExpression(node) && source.ast.is.IsExpressionStatement(source.ast.parent(node))) nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of source.sourceFiles) visit(file);
  assert.equal(nodes.length, 4, "the source covers read, call, property set and indexed set");
  for (const node of nodes) {
    const binary = source.ast.is.IsBinaryExpression(node) ? source.ast.as.AsBinaryExpression(node) : undefined;
    const call = source.ast.is.IsCallExpression(node) ? source.ast.as.AsCallExpression(node) : undefined;
    const selected = binary?.Left ?? node;
    const property = call === undefined ? selected : call.Expression;
    const receiver = source.ast.is.IsPropertyAccessExpression(property)
      ? source.ast.as.AsPropertyAccessExpression(property).Expression
      : source.ast.as.AsElementAccessExpression(property).Expression;
    const indexed = source.ast.is.IsElementAccessExpression(selected) ? source.ast.as.AsElementAccessExpression(selected) : undefined;
    const argumentsList = binary === undefined ? call === undefined ? [] : source.ast.arguments(node)
      : indexed === undefined ? [binary.Right] : [indexed.ArgumentExpression, binary.Right];
    const operationKind = binary !== undefined ? indexed === undefined ? "property-set" : "index-set"
      : call === undefined ? "property" : "method";
    const abi = finalizeRustProviderOperationAbi({ operationKind,
      form: { form: "call", path: "fixture::observe", ...(indexed === undefined ? {} : { argOrder: [1] }) },
      sourceReceiver: { kind: "runtime", carrier },
      sourceArgumentCarriers: argumentsList.map((_, index) => indexed !== undefined && index === 0 ? integer : carrier),
      ...(indexed === undefined ? {} : { evaluationOnlySourceArgumentIndexes: [0] }),
      resultCarrier: { kind: "tuple", elements: [] }, isAsync: false, isFallible: false });
    assert.equal(abi !== undefined, true, `${operationKind} has a canonical source-evaluation ABI`);
    const operation = { kind: binary === undefined ? "provider-operation" : "runtime-set", operationId: "fixture::observe", abi };
    const uses = selectRustOperationReadUses(source.ast, node, { operation, computedMember: undefined, arguments: argumentsList,
      nativeInputs: [], argumentModes: [], address: undefined, location: undefined, guard: undefined, callableMode: undefined, structuralReceiverMode: "shared" });
    const use = uses.get(receiver);
    assert.equal(use?.mode, "shared", `${operationKind} does not consume its source-only receiver`);
    assert.equal(use.later.length, 0, `${operationKind} holds no receiver borrow across later arguments`);
    assert.equal(use.stableAcrossEffects, false, `${operationKind} invents no cross-effect stability proof`);
    if (indexed !== undefined) {
      assert.equal(uses.get(indexed.ArgumentExpression)?.mode, "shared", "an evaluation-only index is not consumed");
      assert.equal(uses.get(indexed.ArgumentExpression)?.later.length, 0, "the discarded index has a terminal use");
    }
    for (const argument of argumentsList.slice(indexed === undefined ? 0 : 1)) {
      assert.equal(uses.has(argument), false, "a value-consumed target argument is not changed to a borrow");
    }
  }
});

test("runtime setters add only evaluation-only terminal uses, not native receiver borrows", async () => {
  const source = createTargetSourceProgram(await checkedSource("ownership-runtime-set-native-aliases", {
    "src/index.ts": `
interface Fields { left: number; right: number; }
function index(values: number[]): number { values[0] = 1; return 0; }
function value(values: number[]): number { values[1] = 2; return 3; }
function assign(values: number[], fields: Fields, first: number, second: number): void {
  values[first] = values[second];
  fields.left = fields.right;
  values[index(values)] = value(values);
}
`,
  }));
  const number = { kind: "source-primitive", name: "float64" };
  const receiverCarrier = { kind: "target-named", id: "fixture.NativeReceiver" };
  const statements = [];
  const visit = node => {
    if (source.ast.is.IsBinaryExpression(node)) statements.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  source.sourceFiles.forEach(visit);
  assert.equal(statements.length, 5, "plain and aliasing field/index writes all participate");
  for (const node of statements) {
    const binary = source.ast.as.AsBinaryExpression(node);
    const indexed = source.ast.is.IsElementAccessExpression(binary.Left)
      ? source.ast.as.AsElementAccessExpression(binary.Left) : undefined;
    const receiver = Node_Expression(source.ast, binary.Left);
    const argumentsList = indexed === undefined ? [binary.Right] : [indexed.ArgumentExpression, binary.Right];
    const sourceArguments = argumentsList.map((_, sourceIndex) => ({ sourceIndex, carrier: number, disposition: "runtime" }));
    const nativeInputs = [
      { source: { kind: "receiver" }, mode: "mut-ref" },
      ...sourceArguments.map(argument => ({ source: { kind: "argument", sourceIndex: argument.sourceIndex }, mode: "ref" })),
    ];
    const operation = { kind: "runtime-set", abi: {
      sourceReceiver: { kind: "receiver", disposition: "runtime", carrier: receiverCarrier }, sourceArguments,
    } };
    const select = selected => selectRustOperationReadUses(source.ast, selected.kind === "runtime-set" ? node : binary.Left, { operation: selected, computedMember: undefined,
      arguments: argumentsList, nativeInputs, argumentModes: [], address: undefined, location: undefined,
      guard: undefined, callableMode: undefined, structuralReceiverMode: "shared" });
    assert.equal(select(operation).size, 0, "consumed runtime-set native inputs do not acquire new read uses");
    const evaluationOnly = select({ ...operation, abi: { ...operation.abi,
      sourceReceiver: { ...operation.abi.sourceReceiver, disposition: "evaluation-only" },
    } });
    assert.equal(evaluationOnly.size, 1, "only the admitted source-only receiver is selected");
    const use = evaluationOnly.get(receiver);
    assert.equal(use?.mode, "shared", "source-only receiver stays nonconsuming");
    assert.equal(use.later.length, 0, "no borrow is held across RHS mutation");
    assert.equal(use.stableAcrossEffects, false, "no alias stability is invented");
    const provider = select({ ...operation, kind: "provider-operation" });
    assert.equal(provider.get(receiver)?.mode, "mutable", "provider-operation native mode selection is unchanged");
    assert.equal(provider.get(receiver)?.later === argumentsList, false, "the immutable use owns its argument list");
    assert.equal(provider.get(receiver)?.later.length, argumentsList.length, "existing provider borrow scope is retained");
  }
});

test("native string append and arithmetic carry their exact operand contracts before ownership analysis", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function append(output: string, suffix: string): string { output += suffix; return output; }
    export function add(left: number, right: number): number { return left + right; }
  ` } });
  const operations = [];
  const visit = node => {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "operator-token" && program.source.ast.is.IsBinaryExpression(node)) {
      const binary = program.source.ast.as.AsBinaryExpression(node);
      operations.push(operation.operator);
      assert.deepEqual(operation.operandModes, operation.operator === "+=" ? ["mut-ref", "ref"] : ["value", "value"]);
      const uses = select(program.source.ast, node, operation);
      assert.equal(uses.get(binary.Right)?.mode, operation.operator === "+=" ? "shared" : undefined);
      if (operation.operator === "+=") assert.equal(program.ownership.reads.get(binary.Right)?.value.kind, "borrow");
    }
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(file);
  assert.deepEqual(operations, ["+=", "+"]);
});

test("generic indexed field reads borrow both the receiver and key without requiring a copied key", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function get<T, K extends keyof T>(value: T, key: K): T[K] { return value[key]; }
  ` } });
  const selected = [];
  const visit = node => {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "source-indexed-field") {
      const access = program.source.ast.as.AsElementAccessExpression(node);
      assert.equal(access !== undefined, true, "checked indexed field reference");
      const uses = select(program.source.ast, node, operation);
      assert.equal(uses.get(access.Expression)?.mode, "shared");
      assert.equal(uses.get(access.ArgumentExpression)?.mode, "shared");
      assert.equal(uses.get(access.Expression)?.later[0] === access.ArgumentExpression, true);
      for (const subject of [access.Expression, access.ArgumentExpression]) {
        assert.equal(program.ownership.reads.get(subject)?.value.kind, "borrow");
      }
      selected.push(node);
    }
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(file);
  assert.equal(selected.length, 1);
});

test("computed-member key uses are terminal nonconsuming reads without changing receiver or consumed inputs", async () => {
  const source = createTargetSourceProgram(await checkedSource("ownership-computed-key-evaluation", {
    "src/index.ts": `
class Value { value = 1; }
class Key { get value(): "value" { return "value"; } }
function key(): "value" { return "value"; }
function receiver(value: Value): Value { return value; }
function use(value: Value, selected: "value", holder: Key, argument: string): number {
  value[selected];
  receiver(value)[key()];
  value[holder.value];
  return value["value"];
}
`,
  }));
  const elements = [];
  const visit = node => {
    if (source.ast.is.IsElementAccessExpression(node)) elements.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  source.sourceFiles.forEach(visit);
  assert.equal(elements.length, 4, "identifier, effectful call, getter and literal key cases are actual checked accesses");
  const consumed = {};
  const operations = [undefined, { kind: "source-field" }, { kind: "source-accessor" },
    { kind: "source-call", target: { form: "method", mutatesSelf: false } },
    { kind: "source-call", target: { form: "method", mutatesSelf: true } }];
  for (const node of elements) {
    const element = source.ast.as.AsElementAccessExpression(node);
    const literal = source.ast.is.IsStringLiteral(element.ArgumentExpression);
    for (const operation of operations) for (const accessMode of ["read", "write", "read-write"]) {
      const input = { operation, arguments: [consumed], argumentModes: [undefined], nativeInputs: [],
        address: undefined, location: undefined, guard: undefined, callableMode: undefined, structuralReceiverMode: "shared" };
      const before = selectRustOperationReadUses(source.ast, node, { ...input, computedMember: undefined });
      const fact = Object.freeze({ receiver: element.Expression, key: element.ArgumentExpression,
        evaluateReceiver: true, evaluateKey: !literal, accessMode });
      const selected = selectRustOperationReadUses(source.ast, node, { ...input, computedMember: fact });
      const receiverBefore = before.get(element.Expression);
      const receiverAfter = selected.get(element.Expression);
      assert.equal(receiverAfter?.mode, receiverBefore?.mode, "native receiver mode is not reclassified by key evaluation");
      assert.equal(receiverAfter?.later.length, receiverBefore?.later.length, "held receiver evaluation order is unchanged");
      assert.equal(receiverAfter?.stableAcrossEffects, receiverBefore?.stableAcrossEffects, "no receiver/effect proof is invented");
      assert.equal(selected.has(consumed), false, "a value-consumed native argument does not become a borrowed argument");
      const keyUse = selected.get(element.ArgumentExpression);
      if (literal) assert.equal(keyUse === undefined, true, "the existing literal key path remains unevaluated");
      else {
        assert.equal(keyUse?.mode, "shared", "a key that is evaluated but not passed to native code is not copied");
        assert.equal(keyUse.later.length, 0, "the key borrow ends before any subsequent effect");
        assert.equal(keyUse.laterStart, 0, "the key has no hidden delayed borrow prefix");
        assert.equal(keyUse.stableAcrossEffects, false, "calls and getters are not reclassified as pure or stable");
        assert.equal(Object.isFrozen(keyUse), true, "the one ownership policy publishes immutable use data");
      }
      assert.equal(fact.receiver === element.Expression && fact.key === element.ArgumentExpression, true,
        "original receiver/key identity and evaluation obligation remain intact");
    }
  }
});

test("computed-only records reach the one ownership-use policy before the seal", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
interface Value { value: number; }
export function read(value: Value, key: "value"): number { return value[key]; }
` } });
  const { ast } = program.source;
  let computed;
  const visit = node => {
    if (ast.is.IsElementAccessExpression(node)) computed = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  assert.equal(computed !== undefined, true, "the actual checked computed read exists");
  const fact = program.records.computedMember.get(computed);
  assert.equal(fact !== undefined && fact.evaluateKey, true, "the original evaluated-key obligation is retained");
  // The published records omit the memory location families; this source has no raw addresses or typed locations.
  const computedOnly = analyzeRustReadUses(ast, [computed, fact.key], { ...program.records,
    rawAddressPlan: { get: () => undefined }, typedLocationPlan: { get: () => undefined },
    targetOperation: { get: () => undefined } }, program.typeDefinitions, () => false, program.structuralShapes);
  assert.equal(computedOnly.get(fact.key)?.mode, "shared", "computed-only evidence reaches the same policy with no operation fallback");
  const read = program.ownership.reads.get(fact.key);
  assert.equal(read?.source.kind, "borrow", "the producer selects a nonconsuming source read before rendering");
  assert.equal(read?.value.kind, "borrow", "the final value read has the same terminal borrow");
  assert.equal(read?.borrowedAcross.size, 0, "no later-effect lifetime is fabricated for the ignored key");
});
