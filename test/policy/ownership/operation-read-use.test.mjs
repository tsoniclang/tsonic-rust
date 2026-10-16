import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { selectRustOperationReadUses } from "../../../dist/policy/ownership/read-use.js";
import { finalizeRustProviderOperationAbi } from "../../../dist/analysis/operations/finalized-operation/finalize.js";

function select(ast, node, operation) {
  return selectRustOperationReadUses(ast, node, { operation, nativeInputs: [], argumentModes: [],
    arguments: undefined, address: undefined, location: undefined, guard: undefined, callableMode: undefined });
}

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
    const uses = selectRustOperationReadUses(source.ast, node, { operation, arguments: argumentsList,
      nativeInputs: [], argumentModes: [], address: undefined, location: undefined, guard: undefined, callableMode: undefined });
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
  for (const file of program.sourceFiles) visit(file);
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
  for (const file of program.sourceFiles) visit(file);
  assert.equal(selected.length, 1);
});
