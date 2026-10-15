import { assertRustRecordRequirement } from "../../../helpers/required-records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { BinaryExpression_OperatorToken, Node_Expression, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { analyzeRust, compileRust } from "../../../helpers/rust-session.mjs";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

function fixture(text, surfaces) {
  const { source, program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": text } });
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.filter(file => source.ast.getFileName(file) === "/src/index.ts").forEach(visit);
  return { ast: source.ast, nodes, records: program.records, requiredRecords };
}

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  test(`checked ${surface} async bodies publish exact native int64 output and their independent suspension protocol`, () => {
    const { ast, nodes, records, requiredRecords } = fixture(`
      import type { int64 } from "@tsonic/core/types.js";
      export async function echo(value: int64): Promise<int64> { return value; }
      export function* values(value: int64): Generator<int64, int64, int64> {
        const next: int64 = yield value; return next;
      }
    `, surfaces);
    const declaration = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "echo");
    const generator = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "values");
    assert.equal(declaration !== undefined && generator !== undefined, true);
    const selected = records.asyncFunction.get(declaration);
    const yielded = records.generator.get(generator);
    assert.equal(selected !== undefined && yielded !== undefined, true);
    assert.equal(selected.kind, surfaces.length === 0 ? "native-future" : "js-promise");
    assert.equal(selected.outputCarrier.kind, "source-primitive");
    assert.equal(selected.outputCarrier.name, "int64");
    assert.equal(rustTargetTypeRefEquals(records.sourceCallableReturn.get(declaration).returnCarrier, selected.outputCarrier), true);
    assert.equal(records.asyncFunction.get(generator) === undefined, true, "generator storage is not an ordinary future");
    assert.equal(records.generator.get(declaration) === undefined, true, "ordinary async has no generator protocol");
    assert.equal(records.asyncFunction.get({}) === undefined, true);
    if (selected.kind === "js-promise") {
      assert.equal(selected.capturedParameters.every(parameter => ast.parameters(declaration).includes(parameter)), true);
      assert.equal(selected.storage.kind, "static");
      assert.equal(selected.futureCarrier.genericArguments[2].type.id, "rust.program.TsonicError");
    } else {
      assert.equal(Object.hasOwn(selected, "storage"), false);
    }
  });

  test(`checked ${surface} value and delegated yields retain exact source owner, next and return carriers`, () => {
    const { ast, nodes, records, requiredRecords } = fixture(`
      import type { int32 } from "@tsonic/core/types.js";
      function* inner(seed: int32): Generator<int32, int32, int32> { const next: int32 = yield seed; return next; }
      export function* outer(seed: int32): Generator<int32, int32, int32> { return yield* inner(seed); }
      export async function* asynchronous(seed: int32): AsyncGenerator<int32, int32, int32> {
        const next: int32 = yield seed; return next;
      }
    `, surfaces);
    const yields = nodes.filter(node => ast.kindName(node) === "KindYieldExpression");
    assert.equal(yields.length, 3);
    const kinds = [];
    for (const expression of yields) {
      assertRustRecordRequirement(requiredRecords, "yield", expression);
      const selected = records.yield.get(expression);
      const owner = sourceEnclosingCallable(expression, ast);
      assertRustRecordRequirement(requiredRecords, "generator", owner);
      assert.equal(selected !== undefined && owner !== undefined, true);
      assert.equal(selected.generatorDeclaration === owner, true);
      const protocol = records.generator.get(owner);
      assert.equal(protocol !== undefined, true);
      assert.equal(selected.yieldType === protocol.yieldType, true);
      kinds.push(selected.kind);
      if (selected.kind === "value") {
        assert.equal(selected.resultType === protocol.nextType, true);
        assert.equal(Object.hasOwn(selected, "delegatedCarrier"), false);
      } else {
        const operand = Node_Expression(ast, expression);
        assert.equal(operand !== undefined, true);
        assert.equal(rustTargetTypeRefEquals(selected.delegatedCarrier, records.runtimeCarrier.get(operand).carrier), true);
        assert.equal(rustTargetTypeRefEquals(selected.resultType, protocol.returnType), true);
      }
    }
    assert.deepEqual(kinds, ["value", "delegate", "value"]);
    assert.equal(records.yield.get({}) === undefined, true);
  });

  test(`checked ${surface} computed fields distinguish static receivers, authored keys and read-write effects`, () => {
    const { ast, nodes, records, requiredRecords } = fixture(`
      class Value { amount = 3; static fixed = 7; }
      function key(): "amount" { return "amount"; }
      export function read(value: Value): number {
        value["amount"] += 1;
        value["amount"]++;
        return value[key()] + Value["fixed"];
      }
    `, surfaces);
    const computed = nodes.filter(node => records.computedMember.get(node) !== undefined);
    const expectedComputed = nodes.filter(node => ast.is.IsElementAccessExpression(node));
    assert.equal(expectedComputed.length, 4);
    for (const expression of expectedComputed) assertRustRecordRequirement(requiredRecords, "computedMember", expression);
    assert.equal(computed.length, 4);
    assert.deepEqual(computed.map(node => records.computedMember.get(node).accessMode),
      ["read-write", "read-write", "read", "read"]);
    assert.deepEqual(computed.map(node => records.computedMember.get(node).evaluateKey), [false, false, true, false]);
    assert.deepEqual(computed.map(node => records.computedMember.get(node).evaluateReceiver), [true, true, true, false]);
    for (const expression of computed) {
      const syntax = ast.as.AsElementAccessExpression(expression);
      const selected = records.computedMember.get(expression);
      assert.equal(syntax !== undefined && Object.isFrozen(selected), true);
      assert.equal(selected.receiver === syntax.Expression && selected.key === syntax.ArgumentExpression, true);
    }
    assert.equal(records.computedMember.get({}) === undefined, true);
  });

  test(`checked ${surface} compound indices retain only their selected surface's exact setter ABI`, () => {
    const { ast, nodes, records, requiredRecords } = fixture(`
      export function update(values: number[], index: number): number {
        const first = values[index]++;
        values[index] += 3;
        return first + values[index];
      }
    `, surfaces);
    const writes = nodes.filter(node => records.compoundWrite.get(node) !== undefined);
    const expectedWrites = nodes.filter(node => ast.kindName(node) === "KindPostfixUnaryExpression" ||
      (ast.kindName(node) === "KindBinaryExpression" && ast.kindName(BinaryExpression_OperatorToken(ast, node)) === "KindPlusEqualsToken"));
    assert.equal(expectedWrites.length, 2);
    for (const expression of expectedWrites) {
      assert.equal(requiredRecords.some(row => row.family === "compoundWrite" && row.subject === expression), surfaces.length !== 0);
    }
    assert.equal(writes.length, surfaces.length === 0 ? 0 : 2);
    if (surfaces.length !== 0) {
      assert.deepEqual(writes.map(node => ast.kindName(node)), ["KindPostfixUnaryExpression", "KindBinaryExpression"]);
      for (const expression of writes) {
        const selected = records.compoundWrite.get(expression);
        assert.equal(selected.kind, "runtime-set");
        assert.equal(selected.abi.operationKind, "index-set");
        assert.equal(selected.abi.sourceArguments.length, 2);
        assert.deepEqual(selected.abi.sourceArguments.map(argument => argument.sourceIndex), [0, 1]);
        assert.equal(selected.abi.targetReceiver.kind, "input");
        assert.equal(selected.abi.targetReceiver.input.mode, "ref");
        assert.equal(selected.abi.result.kind, "sync");
        assert.equal(selected.abi.effects.awaiting, "not-applicable");
      }
    }
    assert.equal(records.compoundWrite.get({}) === undefined, true);
  });
}

test("ambiguous contextual async alternatives retain the original precise pre-seal refusal", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
    const source: () => Promise<number | void> | Promise<string | void> = async () => undefined;
    export function read() { return source(); }
  ` } });
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.program === undefined, true);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "RUST_ASYNC_CONTEXTUAL_PROMISE_NOT_CLOSED");
});
