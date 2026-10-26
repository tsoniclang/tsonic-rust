import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram, Node_Expression } from "@tsonic/target-api/source";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { analyzeRust, compileRust, acmePlatformPackage } from "../../helpers/rust-session.mjs";
import { analyzeRustReadUses, rustNativeArgumentBorrowsRead } from "../../../dist/analysis/ownership/uses.js";
import { selectRustOperationReadUses } from "../../../dist/policy/ownership/read-use.js";
import { finalizeRustProviderOperationAbi } from "../../../dist/policy/operations/members/abi/finalize.js";
import { rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { getRustTypeofRuntimeKind } from "../../../dist/policy/operations/syntax/runtime-kind.js";
import { rustNativeIndexStorageProjection, rustNativeStoragePathsDisjoint, rustNativeStorageProjections,
  rustNativeStorageRoot } from "../../../dist/analysis/storage/native-paths.js";
import { interfaceRepresentationAliasNativeValueFiles, interfaceRepresentationAliasJsProofSource, interfaceRepresentationAliasSource } from "../../../../tsonic/test/fixtures/interface-representation-aliases.mjs";

test("borrowed converted comparisons retain the actual owning source demand", () => {
  for (const [expected, options] of [
    [3, { files: interfaceRepresentationAliasNativeValueFiles }],
    [1, { surfaces: ["js"], files: { "index.ts": interfaceRepresentationAliasSource + interfaceRepresentationAliasJsProofSource } }],
  ]) {
    const { program } = analyzeRust(options);
    const { ast } = program.source;
    let observations = 0;
    const visit = node => {
      if (ast.is.IsIdentifier(node) && ["token", "replacement"].includes(ast.text(node)) &&
        ["KindEqualsEqualsEqualsToken", "KindExclamationEqualsEqualsToken"].includes(ast.operatorKindName(ast.parent(node))) &&
        program.records.valueProjection.get(node)?.contextualConsumesSource === true) {
        observations++;
        const use = program.ownership.uses.get(node);
        const read = program.records.readOwnership.get(node);
        assert.equal(use?.mode, "value", "borrowing the converted target does not borrow the consumed original source");
        assert.equal(read?.source.kind === "clone" || read?.source.kind === "move", true,
          "the existing native ownership owner selects the exact retained snapshot or final transfer");
        assert.equal(read?.source.kind, read?.value.kind, "a native by-value conversion has one source acquisition contract");
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(observations, expected, "the actual checked original fixtures retain every converted comparison occurrence");
  }
});

test("project accessor uses retain their selected native self contract and complete operand interval", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export class Counter {
  stored: int32 = 0;
  get count(): int32 { return this.stored; }
  set count(value: int32) { this.stored = value; }
}
function next(): int32 { return 2; }
export function inspect(value: Counter): int32 {
  const first = value.count;
  value.count = 2;
  (((value["count"]))) += next();
  value.count++;
  return first + value.count;
}
` } });
  const { ast } = program.source;
  const accesses = [];
  const visit = node => {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "source-accessor") accesses.push([node, operation]);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(accesses.length, 5, "read, plain write, wrapped compound, unary and final read retain their actual selected accessors");
  for (const [node, operation] of accesses) {
    const receiver = Node_Expression(ast, node);
    const declarations = operation.accessMode === "read" ? [operation.read]
      : operation.accessMode === "write" ? [operation.write] : [operation.read, operation.write];
    assert.equal(declarations.every(accessor => accessor !== undefined &&
      program.records.selfMode.get(accessor.declaration)?.mode === "ref"), true,
    "the actual selected getter and setter already borrow native self");
    const use = program.ownership.uses.get(receiver);
    assert.equal(use?.mode, "shared", "all invoked shared native accessor halves retain their actual nonconsuming receiver");
    const key = ast.is.IsElementAccessExpression(node) ? ast.as.AsElementAccessExpression(node).ArgumentExpression : undefined;
    let source = node;
    while (ast.is.IsParenthesizedExpression(ast.parent(source))) source = ast.parent(source);
    const parent = ast.parent(source);
    const right = operation.accessMode !== "read" && ast.is.IsBinaryExpression(parent) &&
      ast.as.AsBinaryExpression(parent).Left === source ? ast.as.AsBinaryExpression(parent).Right : undefined;
    const expected = [...(key === undefined ? [] : [key]), ...(right === undefined ? [] : [right])];
    const read = program.ownership.reads.get(receiver);
    if (right === undefined || ast.is.IsNumericLiteral(right))
      assert.equal(read?.source.kind, "borrow", "a receiver with no later replacement/effect needs no native owner snapshot");
    else assert.equal(read?.source.kind === "borrow", expected.every(operand => read.borrowedAcross.has(operand)),
      "borrowing through a later call requires its actual completed relationship; missing proof retains the native snapshot");
    assert.equal(use.later.length, expected.length, "computed key and complete plain/compound RHS participate exactly once");
    for (const [index, operand] of expected.entries())
      assert.equal(use.later[index] === operand, true, "native receiver borrowing preserves original source operand identity and order");
    assert.equal(Object.isFrozen(use.later), true, "the final receiver interval is immutable");
    for (const mode of [undefined, "mut-ref"]) {
      const records = createRustRecordFixture({ targetOperation: program.records.targetOperation,
        selfMode: { get: () => mode === undefined ? undefined : { mode } } });
      const inverse = analyzeRustReadUses(ast, [node], records, program.typeDefinitions,
        () => false, program.structuralShapes, () => false);
      assert.equal(inverse.has(receiver), false, "missing and mutable native self contracts never become shared by default");
    }
    if (operation.accessMode === "read-write") {
      const records = createRustRecordFixture({ targetOperation: program.records.targetOperation,
        selfMode: { get: declaration => ({ mode: declaration === operation.read.declaration ? "ref" : "mut-ref" }) } });
      const inverse = analyzeRustReadUses(ast, [node], records, program.typeDefinitions,
        () => false, program.structuralShapes, () => false);
      assert.equal(inverse.has(receiver), false, "a borrowed getter cannot override a mutable setter in one read-modify-write");
    }
  }
});

test("project accessor assignment snapshots a replaced receiver before its RHS exactly once", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin", crateName: "accessor_receiver_order" } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export class Counter {
  stored: int32;
  constructor(value: int32) { this.stored = value; }
  get count(): int32 { return this.stored; }
  set count(value: int32) { this.stored = value; }
}
export function update(): int32 {
  let selected = new Counter(1);
  const original = selected;
  let calls: int32 = 0;
  function replace(): int32 {
    calls++;
    selected = new Counter(9);
    return 7;
  }
  selected.count = replace();
  return original.count * 100 + selected.count * 10 + calls;
}
export function main(): void {
  if (update() !== 791) throw new Error("accessor receiver/RHS order changed");
}
main();
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.code).join(","));
  validateGeneratedProject("accessor-receiver-rhs-order", result.artifacts, { run: true });
});

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
  const uses = analyzeRustReadUses(ast, nodes, records, {}, () => false, { field: () => undefined }, () => false);
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

test("selected mutable native setters acquire projected places without retaining an earlier receiver read", () => {
  const { program } = analyzeRust({ surfaces: [], packages: [acmePlatformPackage({ includeSetters: true })], files: { "index.ts": `
import { Store } from "@acme/platform";
function index(): 1 { return 1; }
export function update(): void {
  const stores: [Store, Store] = [new Store("first"), new Store("second")];
  stores[index()].count += stores[1].count;
  ++stores[index()].count;
}
` } });
  const { ast } = program.source;
  let setters = 0;
  const visit = node => {
    const operation = program.records.compoundWrite.get(node);
    if (operation?.kind === "runtime-set") {
      setters += 1;
      assert.equal(operation.abi.targetReceiver.input.mode, "mut-ref", "the provider records its real &mut self contract");
      const receiver = program.records.runtimeSetter.get(node).receiver;
      assert.equal(ast.is.IsElementAccessExpression(receiver), true, "the original indexed place is retained");
      for (const source of [receiver, Node_Expression(ast, receiver)]) {
        const use = program.ownership.uses.get(source);
        assert.equal(use?.mode, "shared", "address selection never consumes its non-Copy native owner");
        assert.equal(use.later.length, 0, "the actual setter acquires storage only after its source operands");
        assert.equal(use.stableAcrossEffects, false, "no cross-effect stability is invented");
        assert.equal(program.ownership.reads.get(source)?.value.kind, "borrow", "the canonical native read needs no copy");
      }
      assert.equal(program.records.updateProjection.get(receiver)?.arguments.length, 1,
        "the actual source index remains in its once-only native acquisition recipe");
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(setters, 2, "both compound and unary native acquisitions use the same owner");
});

for (const surfaces of [[], ["js"]]) {
  test(`native operator inputs publish their selected value and shared demands on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
export function divide(left: bigint, right: bigint): bigint { return left / right; }
export function remainder(left: bigint, right: bigint): bigint { return left % right; }
export function equal(left: bigint, right: bigint): boolean { return left === right; }
` } });
    const { ast } = program.source;
    let values = 0;
    let shared = 0;
    const visit = node => {
      const operation = program.records.targetOperation.get(node);
      if (ast.is.IsBinaryExpression(node) && (operation?.kind === "operator-call" || operation?.kind === "operator-token")) {
        const binary = ast.as.AsBinaryExpression(node);
        const selected = select(ast, node, operation);
        for (const [index, operand] of [binary.Left, binary.Right].entries()) {
          const mode = operation.operandModes[index];
          const use = selected.get(operand);
          assert.equal(use !== undefined, true, "every exact selected native operand has one read demand");
          assert.equal(use.mode, mode === "ref" ? "shared" : mode === "mut-ref" ? "mutable" : "value",
            "native consumption is taken from the selected operand contract, not source syntax");
          assert.equal(use.mode === "move", false, "a native value demand does not itself authorize a final-use move");
          assert.equal(Object.isFrozen(use), true, "the native input demand is immutable");
          if (use.mode === "value") values += 1;
          if (use.mode === "shared") shared += 1;
        }
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(values, 4, "both owned division and remainder inputs retain their native consumption");
    assert.equal(shared, 2, "native equality still observes both operands through its original shared ABI");
  });
  test(`selected native projection observations retain their non-Copy receiver demand on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
import type { FixedArray } from "@tsonic/core/types.js";
export function tuple(values: [string, string]): boolean { return ((values))[0] === ""; }
export function fixed(values: FixedArray<string, 2>): boolean { return ((values))[0] === ""; }
` } });
    const { ast } = program.source;
    let receivers = 0;
    const visit = node => {
      const operation = program.records.targetOperation.get(node);
      if (operation?.kind === "tuple-index" || operation?.kind === "fixed-index") {
        const receiver = Node_Expression(ast, node);
        const read = program.records.readOwnership.get(receiver);
        assert.equal(read?.source.kind, "borrow", "a selected projection observer never clones its tuple or fixed-array owner");
        assert.equal(read.source.mutable, false, "a read-only native projection remains a shared native place");
        assert.equal(read.value.kind, "borrow", "the same admitted native demand reaches the value read without a transfer override");
        const result = program.records.readOwnership.get(node);
        assert.equal(result?.source.kind, "borrow", "the selected native field keeps its exact storage lease across the pure later operand");
        assert.equal(result.value.kind, "borrow", "a tuple or fixed-array field observation does not copy its String result");
        const input = { ast, records: program.records, navigation: program.sourceNavigation };
        const root = rustNativeStorageRoot(node, input);
        assert.equal(root !== undefined, true, "the actual checked formal supplies its physical native storage root");
        const path = rustNativeStorageProjections(node, root, input);
        assert.deepEqual(path, [operation.kind === "tuple-index" ? operation.index : rustNativeIndexStorageProjection],
          "tuple fields use their exact native ordinal while array indices remain conservative");
        receivers += 1;
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(receivers, 2, "both actual tuple and fixed-array projection receivers remain covered");
  });
  test(`owned native projections retain exact final receiver transfer on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
import type { FixedArray } from "@tsonic/core/types.js";
export function tuple(values: [string, string]): string { return ((values))[0]; }
export function fixed(values: FixedArray<string, 2>): string { return ((values))[0]; }
` } });
    const { ast } = program.source;
    let receivers = 0;
    const visit = node => {
      const operation = program.records.targetOperation.get(node);
      if (operation?.kind === "tuple-index" || operation?.kind === "fixed-index") {
        const receiver = Node_Expression(ast, node);
        const read = program.records.readOwnership.get(receiver);
        assert.equal(read?.source.kind, "move", "an owned final projection transfers its owner without cloning it");
        assert.equal(read.value.kind, "move", "the selected owned field does not acquire a shared-observer override");
        receivers += 1;
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(receivers, 2, "both actual tuple and fixed-array owned projections remain covered");
  });
}

test("exact native tuple fields retain disjointness without inventing dynamic-index or prefix independence", () => {
  assert.equal(rustNativeStoragePathsDisjoint([0], [1]), true, "distinct admitted native tuple fields are distinct physical storage");
  assert.equal(rustNativeStoragePathsDisjoint([0], [0]), false, "the same native field always aliases itself");
  assert.equal(rustNativeStoragePathsDisjoint([0], [0, 1]), false, "an owner path overlaps its nested field");
  assert.equal(rustNativeStoragePathsDisjoint([rustNativeIndexStorageProjection], [0]), false,
    "a dynamic index never acquires guessed field independence");
});

test("native runtime and static typeof categories share their actual storage operand without copying union payloads", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
type Body = boolean | unknown[];
export function inspect(body: Body): string {
  if (typeof body === "boolean") return typeof ((body));
  return typeof body;
}
export function booleanCategory(value: boolean): string { return typeof ((value)); }
export function arrayCategory(value: unknown[]): string { return typeof value; }
` } });
  assert.equal(program !== undefined, true, "a native category probe is not an aliased array entry");
  const { ast } = program.source;
  const probes = [];
  const visit = node => {
    if (ast.is.IsTypeOfExpression(node)) probes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(probes.length, 5, "all three original guarded probes and both genuine static-carrier probes remain admitted");
  let runtime = 0;
  let staticResult = 0;
  const staticCategories = [];
  for (const probe of probes) {
    const fact = program.records.targetOperation.get(probe);
    assert.equal(fact?.kind, "typeof", "the actual category producer owns the selected operation");
    if (typeof fact.result === "string") {
      staticResult += 1;
      staticCategories.push(fact.result);
    } else {
      runtime += 1;
      assert.equal(fact.result.kind, "source-union", "the category plan observes the actual physical union");
      assert.deepEqual(fact.result.variants.map(variant => variant.result).sort(), ["boolean", "object"],
        "the complete physical union preserves both exact native categories");
    }
    const operand = Node_Expression(ast, probe);
    const use = select(ast, probe, fact).get(operand);
    assert.equal(use?.mode, "shared", "category selection never consumes or clones its payload storage");
    assert.equal(use.later.length, 0, "the probe does not extend a borrow into a later operand");
    let subject = operand;
    while (ast.is.IsParenthesizedExpression(subject)) subject = Node_Expression(ast, subject);
    const physicalCarrier = program.records.runtimeCarrier.get(subject)?.carrier;
    assert.equal(physicalCarrier !== undefined, true, "the real native source carrier is published");
    assert.deepEqual(fact.result, getRustTypeofRuntimeKind(physicalCarrier, program.typeDefinitions),
      "guarded logical refinements never replace the physical category input");
    const ownership = program.records.readOwnership.get(subject);
    assert.equal(ownership?.source.kind, "borrow", "the complete ownership producer publishes the native source borrow");
    assert.equal(ownership.source.mutable, false, "a category probe never needs a mutable native borrow");
    assert.equal(select(ast, subject, undefined).has(subject), false, "ordinary non-probe reads do not acquire a blanket borrow policy");
  }
  assert.equal(runtime, 3, "all three original observations retain the real native union storage");
  assert.equal(staticResult, 2, "the actual boolean and array carriers retain their native static outcomes");
  assert.deepEqual(staticCategories.sort(), ["boolean", "object"]);
});

test("a checked shared field probe remains borrowed across its actual effect-free later operand", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
interface Options { extensions?: string[] | false; }
export function enabled(options?: Options): boolean {
  return options?.extensions !== false && options?.extensions !== undefined;
}
` } });
  assert.equal(program !== undefined, true, "a readonly field guard is not an aliased array entry");
  const { ast } = program.source;
  const comparisons = [];
  const visit = node => {
    if (program.records.targetOperation.get(node)?.kind === "union-equality") comparisons.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(comparisons.length, 1, "the real field-versus-false guard is the only native union comparison");
  const comparison = ast.as.AsBinaryExpression(comparisons[0]);
  assert.equal(ast.kindName(comparison.Right), "KindFalseKeyword", "the later operand is the checked effect-free literal, not an unknown call");
  const selected = select(ast, comparisons[0], program.records.targetOperation.get(comparisons[0]));
  assert.equal(selected.get(comparison.Left)?.mode, "shared", "the native comparison requires a real shared field input");
  const read = program.records.readOwnership.get(comparison.Left);
  assert.equal(read?.source.kind, "borrow", "the preseal producer retains the actual field storage view");
  assert.equal(read.source.mutable, false, "a readonly native comparison does not need an exclusive borrow");
  assert.equal(read.value.kind, "borrow", "no hidden union or Vec clone is selected for the comparison");
  assert.equal(read.borrowedAcross.has(comparison.Right), true, "the published interval includes this exact later operand");
});

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
  const uses = analyzeRustReadUses(ast, nodes, records, {}, () => false, { field: () => undefined }, () => false);
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

for (const surfaces of [[], ["js"]]) {
  test(`immutable native String loads keep their pointee lease across later reads on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
import type { Mut, Ref } from "@tsonic/rust/types.js";
import { load, store } from "@tsonic/rust/lang.js";
export function equal(left: Ref<string>, right: Ref<string>): boolean { return load(left) === load(right); }
export function changing(target: Mut<string>, replacement: string): boolean {
  return load(target) === (store(target, replacement), "changed");
}
` } });
    const { ast } = program.source;
    const comparisons = [];
    const visit = node => {
      if (ast.is.IsBinaryExpression(node) && program.records.targetOperation.get(node)?.kind === "operator-token" &&
        ast.is.IsCallExpression(ast.as.AsBinaryExpression(node).Left)) comparisons.push(ast.as.AsBinaryExpression(node));
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(comparisons.length, 2, "both immutable and genuinely mutable native source intervals are selected");
    for (const comparison of comparisons) {
      const load = program.records.targetOperation.get(comparison.Left);
      assert.equal(load?.kind, "reference-operation", "the selected left operand is its real native reference load");
      const immutable = !load.operandCarrier.mutable;
      const read = program.records.readOwnership.get(comparison.Left);
      assert.equal(read?.borrowedAcross.has(comparison.Right), immutable,
        "only the immutable native String pointee lease can span this later operand");
      if (immutable) {
        assert.equal(read.value.kind, "borrow", "a shared observation does not materialize an owning String copy");
        assert.equal(read.source.kind, "borrow", "the native source view remains the original immutable pointee");
        assert.equal(program.records.referenceOperation.get(comparison.Left)?.recipe.form, "reference",
          "the sole late load recipe consumes that already-selected native borrow");
      } else {
        assert.equal(program.records.referenceOperation.get(comparison.Left)?.recipe.form === "reference", false,
          "a later store into the mutable pointee cannot retain the old shared view");
      }
    }
  });
}

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
  const stores = [];
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
        const selected = program.records.referenceOperation.get(node);
        stores.push(selected);
        assert.equal(selected?.recipe.kind, "store", "each native store publishes its required final recipe exactly once");
        assert.equal(Object.isFrozen(selected.recipe), true, "the selected native store recipe is immutable");
        assert.equal(Object.isFrozen(selected.recipe.evaluation), true, "the owned scalar evaluation recipe is frozen before publication");
        const evaluationKind = selected.recipe.evaluation.kind;
        assert.throws(() => { selected.recipe.evaluation.kind = "target-first"; }, TypeError,
          "the published native evaluation order cannot be changed after sealing");
        assert.equal(selected.recipe.evaluation.kind, evaluationKind, "a refused mutation preserves the original selected evaluation order");
        assert.equal(Object.hasOwn(fact, "writeStrategy"), false, "source facts no longer contain a premature optional store recipe");
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
  assert.equal(stores.filter(selected => selected.recipe.evaluation.kind === "compound").length, 2,
    "both exact direct and transparently wrapped operands use the same proven pure native update");
  assert.equal(stores.filter(selected => selected.recipe.evaluation.kind === "direct").length, 2,
    "disjoint loads and owned String replacements keep their original native value semantics");
});

test("checked optional native handles retain their stable projected reference through a repeated load and store", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Mut } from "@tsonic/rust/types.js";
import { load, store } from "@tsonic/rust/lang.js";
export function update(target: Mut<int32> | undefined): void {
  if (target === undefined) return;
  store(target, load(target) + 1);
}
` } });
  const { ast } = program.source;
  const stores = [];
  const visit = node => {
    const selected = program.records.referenceOperation.get(node);
    if (selected?.operation.operation === "store") stores.push(selected);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(stores.length, 1, "the checked optional native handle has one real source store");
  const selected = stores[0];
  assert.equal(selected.recipe.evaluation.kind, "compound", "the admitted stable projection does not hold a second mutable borrow across its own load");
  assert.equal(selected.recipe.evaluation.operator, "+=", "the pure integer update retains its exact selected native operator");
  assert.equal(Object.isFrozen(selected.recipe.evaluation), true, "the projected native store publishes the same immutable evaluation contract");
});

test("a shared native reference still cannot be passed to the mutable store contract", () => {
  const { result, source } = compileRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Ref } from "@tsonic/rust/types.js";
import { store } from "@tsonic/rust/lang.js";
export function invalid(value: Ref<int32>): void { store(value, 1); }
` } });
  const { ast, sourceFiles } = createTargetSourceProgram(source);
  const calls = [];
  const visit = node => {
    if (ast.is.IsCallExpression(node)) {
      const callee = Node_Expression(ast, node);
      if (callee !== undefined && ast.is.IsIdentifier(callee) && ast.text(callee) === "store") calls.push(node);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  sourceFiles.forEach(visit);
  assert.equal(calls.length, 1, "the inverse retains the actual checked immutable-reference store occurrence");
  assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ["RUST_REFERENCE_STORE_REQUIRES_MUTABLE"],
    "only the exact preseal mutable-reference admission refuses the immutable input");
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.source, "tsonic-rust", "the native target owns the refusal");
  assert.equal(diagnostic.message, "Rust reference store requires an exact mutable reference operand.",
    "the immutable-reference inverse retains the complete existing reason");
  assert.equal(diagnostic.sourceNode === calls[0], true, "the refusal names the exact original store call");
  assert.equal(result.artifacts.length, 0, "the rejected immutable-reference store emits no native artifact");
  assert.equal(result.program === undefined, true, "the rejected source is not published as a sealed program");
  assert.equal(result.plan === undefined, true, "the rejected source is never planned");
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
    [["value", "value"], ["value", "value"]],
    [["ref", "value"], ["shared", "value"]],
    [["value", "ref"], ["value", "shared"]],
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
      assert.equal(uses.get(binary.Right)?.mode, operation.operator === "+=" ? "shared" : "value");
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
      const originalLater = receiverBefore?.later.slice(receiverBefore.laterStart);
      const addedKey = !literal && originalLater !== undefined && !originalLater.includes(element.ArgumentExpression);
      const expectedLater = addedKey ? [element.ArgumentExpression, ...originalLater] : receiverBefore?.later;
      assert.equal(receiverAfter?.later.length, expectedLater?.length, "the original receiver interval includes the actual computed key exactly once");
      for (const [index, later] of (expectedLater ?? []).entries())
        assert.equal(receiverAfter.later[index] === later, true, `receiver evaluation ${index}: the exact key and remaining native inputs retain source order`);
      assert.equal(receiverAfter?.laterStart, addedKey ? 0 : receiverBefore?.laterStart, "previously completed native inputs are not re-evaluated");
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
    targetOperation: { get: () => undefined } }, program.typeDefinitions, () => false, program.structuralShapes, () => false);
  assert.equal(computedOnly.get(fact.key)?.mode, "shared", "computed-only evidence reaches the same policy with no operation fallback");
  const read = program.ownership.reads.get(fact.key);
  assert.equal(read?.source.kind, "borrow", "the producer selects a nonconsuming source read before rendering");
  assert.equal(read?.value.kind, "borrow", "the final value read has the same terminal borrow");
  assert.equal(read?.borrowedAcross.size, 0, "no later-effect lifetime is fabricated for the ignored key");
});
