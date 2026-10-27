import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { analyzeRustErrorEffects } from "../../../helpers/rust-error-analysis.mjs";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { assertRustRecordRequirement } from "../../../helpers/required-records.mjs";
import { assertRustRequiredRecords } from "../../../../dist/analysis/program/records/objects/required-records.js";

function fixture(text, surfaces) {
  const context = analyzeRustErrorEffects(text, { surfaces });
  assertRustRequiredRecords(context.records, context.requiredRecords);
  const nodes = context.sourceStorage.nodes;
  const required = (family, subject) => {
    assert.equal(subject !== undefined, true, family + " has an exact checked subject");
    assert.equal(context.requiredRecords.some(row => row.family === family && row.subject === subject), true,
      family + " is required at the selected source identity");
  };
  const absent = (family, subject) => {
    assert.equal(subject !== undefined, true, family + " exclusion has an exact checked subject");
    assert.equal(context.requiredRecords.some(row => row.family === family && row.subject === subject), false,
      family + " is intentionally absent for this construct");
  };
  const named = (predicate, name) => nodes.find(node => predicate(node) &&
    context.ast.text(context.ast.name(node)) === name);
  return { context, nodes, required, absent, named, ast: context.ast };
}

test("independent requirement capture preserves the real integrated program and exact checked source identities", () => {
  const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces: [], files: {
    "index.ts": "export function selected(value: number): number { return value; }",
  } });
  const file = program.sourceFiles.find(candidate => program.source.ast.getFileName(candidate) === "/src/index.ts");
  const declaration = program.source.ast.statements(file).find(node => program.source.ast.is.IsFunctionDeclaration(node));
  assertRustRecordRequirement(requiredRecords, "sourceCallableReturn", declaration);
  assert.equal(program.records.sourceCallableReturn.get(declaration) !== undefined, true);
  assert.equal(Object.isFrozen(requiredRecords), true);
  assert.equal(Object.hasOwn(program, "requiredRecords"), false);
});

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  test(`required ${surface} parameter, reference and wrapper proofs keep distinct checked identities`, () => {
    const current = fixture(`
export function selected(input: number, other: number = 3, ...values: number[]): number {
  const value = (input);
  return value + other;
}
`, surfaces);
    const declaration = current.named(current.ast.is.IsFunctionDeclaration, "selected");
    for (const parameter of current.ast.parameters(declaration)) {
      current.required("sourceParameterAbi", parameter);
      current.required("runtimeCarrier", parameter);
    }
    const parameter = current.ast.parameters(declaration)[0];
    const reference = current.nodes.find(node => current.ast.is.IsIdentifier(node) &&
      current.context.source.navigation.sourceReferenceFor(node)?.declaration === parameter && node !== current.ast.name(parameter));
    current.required("sourceParameterAbi", reference);
    current.required("sourceBinding", reference);
    const wrapper = current.nodes.find(node => current.ast.kindName(node) === "KindParenthesizedExpression" &&
      Node_Expression(current.ast, node) === reference);
    current.required("sourceParameterAbi", wrapper);
    current.required("runtimeCarrier", wrapper);
    current.absent("sourceBinding", parameter);
    current.required("sourceCallableReturn", declaration);
  });

  test(`required ${surface} generator, async and yield proofs follow the actual owning callable`, () => {
    const current = fixture(`
import type { int32 } from "@tsonic/core/types.js";
export function* ordinary(seed: int32): Generator<int32, int32, int32> {
  const value: int32 = yield seed;
  return value;
}
export async function* asynchronous(seed: int32): AsyncGenerator<int32, int32, int32> {
  const value: int32 = yield seed;
  return value;
}
export async function pending(seed: int32): Promise<int32> { return seed; }
export async function consumer(seed: int32): Promise<int32> { return await pending(seed); }
`, surfaces);
    const ordinary = current.named(current.ast.is.IsFunctionDeclaration, "ordinary");
    const asynchronous = current.named(current.ast.is.IsFunctionDeclaration, "asynchronous");
    const pending = current.named(current.ast.is.IsFunctionDeclaration, "pending");
    current.required("generator", ordinary);
    current.required("generator", asynchronous);
    current.absent("asyncFunction", ordinary);
    current.absent("asyncFunction", asynchronous);
    current.required("asyncFunction", pending);
    current.absent("generator", pending);
    for (const expression of current.nodes.filter(node => current.ast.kindName(node) === "KindYieldExpression")) {
      current.required("yield", expression);
      current.absent("yield", sourceEnclosingCallable(expression, current.ast));
    }
    const awaited = current.nodes.find(node => current.ast.kindName(node) === "KindAwaitExpression");
    current.required("awaitValue", awaited);
    current.required("awaitSourceErrorEffects", awaited);
    current.required("futureValue", Node_Expression(current.ast, awaited));
    current.absent("awaitValue", Node_Expression(current.ast, awaited));
  });

  test(`required ${surface} setter, constructor and static method exclusions remain independent`, () => {
    const current = fixture(`
class Counter {
  value: number;
  constructor(value: number) { this.value = value; }
  get current(): number { return this.value; }
  set current(value: number) { this.value = value; }
  static identity(value: number): number { return value; }
}
export function selected(): number { const value = new Counter(3); value.current = 4; return value.current; }
`, surfaces);
    const setter = current.nodes.find(node => current.ast.kindName(node) === "KindSetAccessor");
    const constructor = current.nodes.find(node => current.ast.kindName(node) === "KindConstructor");
    const method = current.named(current.ast.is.IsMethodDeclaration, "identity");
    current.required("sourceCallableReturn", setter);
    current.required("selfMode", setter);
    current.absent("sourceCallableReturn", constructor);
    current.absent("selfMode", method);
    current.required("sourceCallableReturn", method);
  });
}

test("required false guards and direct optional exclusions are independent source selections", () => {
  const current = fixture(`
interface Value { count: number; }
export function selected(value: Value | undefined): number {
  if (false) return 99;
  return value?.count ?? 0;
}
export function direct(value: Value): number { return value.count; }
`, ["js"]);
  const condition = current.nodes.find(node => current.ast.kindName(node) === "KindFalseKeyword");
  current.required("nativeGuardResult", condition);
  assert.equal(current.context.records.nativeGuardResult.get(condition), false);
  const optional = current.nodes.find(node => current.ast.is.IsPropertyAccessExpression(node) &&
    current.ast.as.AsPropertyAccessExpression(node)?.QuestionDotToken !== undefined);
  current.required("optionalChain", optional);
  const direct = current.named(current.ast.is.IsFunctionDeclaration, "direct");
  const access = current.nodes.find(node => current.ast.is.IsPropertyAccessExpression(node) &&
    sourceEnclosingCallable(node, current.ast) === direct);
  current.absent("optionalChain", access);
});
