import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import { getRustTypeofRuntimeKind } from "../../dist/policy/operations/syntax/runtime-kind.js";
import { rustOptionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType, rustJsValueTargetType, rustJsSymbolTargetType, rustJsStringTargetType, rustJsArrayTargetType } from "../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../dist/target-model/types/source-union-definitions.js";
import { planRustRuntimeCategory } from "../../dist/backend/planner/expressions/runtime-category.js";
import { rustClosedValueCategoryProjection } from "../../dist/policy/conversions/closed-values.js";
import { rustUnionLeaves } from "../../dist/target-model/types/union-relations.js";
import { rustUnionProjectionContract } from "../../dist/policy/conversions/union-relations.js";
import { rustJsArrayValueTargetType } from "../../dist/target-model/types/carriers/array-values.js";
import { rustBorrowedStrTargetType } from "../../dist/target-model/types/carriers/native.js";
import { rustJsIntlGroupingTargetId, rustJsNumericTargetId, rustJsStringNumberTargetId } from "../../dist/target-model/types/carriers/source-types.js";
import { rustRuntimeUnionContract } from "../../dist/target-model/types/carriers/runtime-unions.js";
import { analyzeRust, compileRust } from "../helpers/rust-session.mjs";
import { Node_Expression } from "@tsonic/target-api/source";

test("closed runtime values expose exact categories without claiming exhaustive union arms", () => {
  const source = rustJsValueTargetType();
  const selected = getRustTypeofRuntimeKind(source, emptyRustTypeDefinitions);
  assert.deepEqual(selected, { kind: "runtime-method", sourceCarrier: source, method: "type_of" });
  const context = { input: { program: { typeDefinitions: emptyRustTypeDefinitions } } };
  const input = { kind: "path", path: "value" };
  assert.deepEqual(planRustRuntimeCategory(input, selected, context), {
    kind: "method-call", receiver: input, method: "type_of", args: [],
  });
  assert.equal(selected.method, "type_of", "the one producer publishes only the method admitted by its literal type contract");
  assert.equal(selected.sourceCarrier === source, true, "the actual native source identity is retained, not reconstructed");
  for (const id of [rustJsStringNumberTargetId, rustJsNumericTargetId, rustJsIntlGroupingTargetId]) {
    const native = { kind: "target-named", id };
    const contract = rustRuntimeUnionContract(native);
    assert.equal(contract?.typeofMethod, "type_of", `${id}: the existing native runtime contract fixes the exact method`);
    const result = getRustTypeofRuntimeKind(native, emptyRustTypeDefinitions);
    assert.deepEqual(result, { kind: "runtime-method", sourceCarrier: native, method: "type_of" },
      `${id}: no caller-supplied or guessed method is admitted to the producer`);
  }
  assert.equal(rustUnionLeaves(source, emptyRustTypeDefinitions), undefined);
  for (const [carrier, variant, category] of [
    [rustStringTargetType(), "String", true],
    [rustSourcePrimitiveTargetType("bool"), "Bool", true],
    [rustJsSymbolTargetType(), "Symbol", true],
    [rustJsStringTargetType(), "Utf16String", false],
    [rustSourcePrimitiveTargetType("uint64"), "UnsignedInteger", false],
    [rustSourcePrimitiveTargetType("native-uint"), "NativeUint", false],
    [rustSourcePrimitiveTargetType("int32"), "Int32", false],
    [rustSourcePrimitiveTargetType("float32"), "Float32", false],
    [rustSourcePrimitiveTargetType("float64"), "Number", false],
    [rustJsArrayValueTargetType(), "Array", false],
  ]) {
    assert.deepEqual(rustUnionProjectionContract(source, carrier, emptyRustTypeDefinitions)?.variant,
      { kind: "payload", name: variant });
    assert.equal(rustClosedValueCategoryProjection(carrier), category);
  }
  assert.equal(getRustTypeofRuntimeKind(rustJsSymbolTargetType(), emptyRustTypeDefinitions), "symbol");
  assert.equal(rustUnionProjectionContract(source, rustSourcePrimitiveTargetType("int128"), emptyRustTypeDefinitions), undefined);
  assert.equal(rustUnionProjectionContract(source, rustJsArrayTargetType(source), emptyRustTypeDefinitions), undefined);
  assert.equal(rustUnionProjectionContract(source, rustJsArrayTargetType(rustStringTargetType()), emptyRustTypeDefinitions), undefined);
});

test("optional runtime categories preserve exact single-producer source and payload correspondence", () => {
  for (const [value, kind] of [[rustStringTargetType(), "string"], [rustBorrowedStrTargetType(), "string"],
    [rustSourcePrimitiveTargetType("uint64"), "bigint"]]) {
    const sourceCarrier = rustOptionTargetType(value);
    const selected = getRustTypeofRuntimeKind(sourceCarrier, emptyRustTypeDefinitions);
    assert.deepEqual(selected, { kind: "optional", sourceCarrier, value: kind });
    const context = { input: { program: { typeDefinitions: emptyRustTypeDefinitions } }, syntheticNames: {} };
    const input = { kind: "path", path: "value" };
    const planned = planRustRuntimeCategory(input, selected, context);
    assert.equal(planned.kind, "match");
    assert.deepEqual(planned.expression, { kind: "reference", expr: input });
    assert.deepEqual(planned.arms[0].expression, { kind: "str-literal", value: kind });
    assert.deepEqual(planned.arms[1].expression, { kind: "str-literal", value: "object" });
    assert.equal(selected.sourceCarrier === sourceCarrier, true,
      "the dependent source carrier is the actual optional input, not its nonoptional payload");
    assert.equal(selected.value, getRustTypeofRuntimeKind(value, emptyRustTypeDefinitions),
      "the dependent present category comes from the actual native payload owner");
    assert.equal(selected.value === "boolean", false, "neither String nor native uint64 is misclassified as a boolean");
    assert.equal(getRustTypeofRuntimeKind(value, emptyRustTypeDefinitions), kind,
      "the nonoptional input independently keeps its primitive category instead of acquiring an optional descriptor");
    const boolean = getRustTypeofRuntimeKind(rustOptionTargetType(rustSourcePrimitiveTargetType("bool")), emptyRustTypeDefinitions);
    assert.equal(boolean?.kind, "optional", "a genuine optional native bool remains a different valid producer input");
    assert.equal(boolean.value, "boolean", "only the bool input gets the distinct dependent category");
  }
});

test("checked typeof publication retains exact physical native carriers and categories", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32, uint64 } from "@tsonic/core/types.js";
export function closed(value: unknown): string { return typeof value; }
export function optional(value: string | undefined): string { return typeof value; }
export function text(value: string): string { return typeof value; }
export function wide(value: uint64): string { return typeof value; }
export function native(value: int32): string { return typeof value; }
` } });
  const nodes = [];
  const ast = program.source.ast;
  const visit = node => {
    if (ast.kindName(node) === "KindTypeOfExpression") nodes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(nodes.length, 5, "closed, optional, String, uint64 and int32 all use the real typeof producer");
  for (const [index, node] of nodes.entries()) {
    const operand = Node_Expression(ast, node);
    const carrier = program.records.runtimeCarrier.get(operand)?.carrier;
    const operation = program.records.targetOperation.get(node);
    assert.equal(carrier !== undefined, true, "the source evidence owner completed the actual operand");
    assert.equal(operation?.kind, "typeof", "the native descriptor is published before rendering");
    assert.equal(isDeepStrictEqual(operation.result, getRustTypeofRuntimeKind(carrier, program.typeDefinitions)), true,
      "the selected operation has the exact policy result for its actual physical source");
    if (index === 0) assert.equal(operation.result.method, "type_of", "closed native values use the admitted method literal");
    else if (index === 1) {
      assert.equal(operation.result.kind, "optional");
      assert.equal(operation.result.sourceCarrier === carrier, true, "the optional descriptor retains its original native carrier");
      assert.equal(operation.result.value, "string");
    } else assert.equal(operation.result, ["string", "bigint", "number"][index - 2]);
  }
});

test("an actually unsupported native typeof carrier is rejected by its source owner before publication", () => {
  const { source, result } = compileRust({ files: { "index.ts": `
export function category<Value>(value: Value): string { return typeof value; }
` } });
  assert.equal(result.diagnostics.length, 1, "there is one precise native typeof refusal, not a downstream render failure");
  const issue = result.diagnostics[0];
  assert.equal(issue.code, "RUST_TYPEOF_CARRIER_UNSUPPORTED");
  assert.equal(issue.message, "typeof requires one exact closed Rust carrier with preserved TypeScript runtime category.");
  assert.equal(source.ast.kindName(issue.sourceNode), "KindTypeOfExpression", "the refusal belongs to the actual original typeof");
  assert.equal(source.ast.text(Node_Expression(source.ast, issue.sourceNode)), "value", "the exact unsupported checked operand is retained");
  assert.equal(result.program === undefined, true, "the invalid source never publishes an analysis program");
  assert.equal(result.plan === undefined, true, "no invalid typeof reaches target planning");
  assert.equal(result.artifacts.length, 0, "no native artifact is emitted for a refused carrier");
});
