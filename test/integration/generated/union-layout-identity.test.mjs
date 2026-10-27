import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustUnionEntryTransferIssue } from "../../../dist/policy/conversions/union-injection.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustCallableTargetType, rustFutureTargetType, rustJsArrayTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType,
  rustSourceUnionTargetType, rustVecTargetType } from "../../../dist/target-model/types/index.js";
import { selectRustNativeFutureTypeDemand } from "../../../dist/analysis/callables/native/native-future-inputs.js";
import { createRustNativeStorageJoins } from "../../../dist/analysis/callables/storage/native-storage-joins.js";

const bodyType = "string | number | boolean | null | Record<string, unknown> | unknown[]";
const identityCode = "RUST_UNION_ENTRY_STORAGE_IDENTITY_NOT_PRESERVED";

for (const [label, body, mutable, written] of [
  ["selected native vector", `
type Body = boolean | unknown[];
export function inspect(value: Body): boolean {
  if (typeof value === "boolean") return value;
  value[0] = 2;
  return value[0] === 2;
}`, true, true],
  ["shared object interior", `
class Box { count: number = 0; }
type Body = boolean | Box;
export function inspect(value: Body): boolean {
  if (typeof value === "boolean") return value;
  const alias = value;
  value.count = 2;
  return alias.count === 2;
}`, false, true],
  ["untouched native vector", `
type Body = boolean | unknown[];
export function inspect(value: Body): boolean {
  if (typeof value === "boolean") return value;
  return value[0] === 2;
}`, false, false],
]) test(`native written-path mutability follows the actual union use: ${label}`, () => {
  const { program } = analyzeRust({ files: { "index.ts": body } });
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  const parameter = nodes.find(node => ast.is.IsParameterDeclaration(node) && ast.text(ast.name(node)) === "value");
  assert.equal(parameter !== undefined, true, `${label}: use the original checked source parameter`);
  assert.equal(program.records.mutatedReferent.get(parameter) !== undefined, written,
    `${label}: source writes are retained without inventing a write for an untouched union`);
  assert.equal(program.records.mutatedReferentBinding.get(parameter) !== undefined, mutable,
    `${label}: the sole final decision follows the actual native write path, not all declared union arms`);
  const selected = program.records.callableParameter.get(parameter);
  assert.equal(selected !== undefined, true, `${label}: the native parameter consumes its completed required records`);
  assert.equal(selected.parameterMutable, mutable,
    `${label}: native parameter emission consumes exactly the final binding fact`);
});

test("native TYPE demand distinguishes metadata from real Future and callable storage before projecting a source", () => {
  const number = rustSourcePrimitiveTargetType("float64");
  const future = rustFutureTargetType(number);
  const callable = rustCallableTargetType([number], number, { kind: "static" });
  for (const [label, carrier, hasFuture, hasImplementation] of [
    ["native scalar", number, false, false],
    ["native array", rustVecTargetType(number), false, false],
    ["native shared array", rustJsArrayTargetType(number), false, false],
    ["native optional array", rustOptionTargetType(rustVecTargetType(number)), false, false],
    ["native tuple", { kind: "tuple", elements: [number, rustVecTargetType(number)] }, false, false],
    ["native Future", future, true, false],
    ["native Future array", rustVecTargetType(future), true, false],
    ["native optional Future array", rustOptionTargetType(rustVecTargetType(future)), true, false],
    ["native callable array", rustVecTargetType(callable), false, true],
    ["native Future tuple", { kind: "tuple", elements: [number, future] }, true, false],
    ["native callable tuple", { kind: "tuple", elements: [number, callable] }, false, true],
    ["native optional shared array", rustOptionTargetType(rustJsArrayTargetType(number)), false, false],
  ]) {
    let remaining = 4096;
    const selected = selectRustNativeFutureTypeDemand(carrier, emptyRustTypeDefinitions,
      depth => remaining-- > 0 && depth <= 128, 0);
    assert.equal(selected.kind, "resolved", label + ": the actual admitted native carrier has a finite TYPE inventory");
    assert.equal(selected.future, hasFuture, label + ": only a real Future value demands Future provenance");
    let physicalRemaining = 4096;
    const physical = createRustNativeStorageJoins({
      input: { storage: { subject() { assert.fail(label + ": TYPE demand must not project source storage"); } },
        definitions: emptyRustTypeDefinitions,
        structuralShapes: {
          field() { assert.fail(label + ": scalar and wrapper controls have no structural field"); },
          definitionForCarrier() { assert.fail(label + ": scalar and wrapper controls have no structural definition"); },
        }, producerErrorFor: () => undefined },
      boundaries: [], joinWrites: new Map(), step: depth => physicalRemaining-- > 0 && depth <= 128,
      fail(message) { assert.fail(label + ": " + message); },
    });
    assert.equal(physical.requiresPhysicalSelection(carrier, 0), hasFuture || hasImplementation,
      label + ": only a real native Future or implementation demands value storage");
  }
  const missing = selectRustNativeFutureTypeDemand(rustSourceUnionTargetType("/src/index.ts", "Missing"),
    emptyRustTypeDefinitions, () => true, 0);
  assert.equal(missing.kind, "unresolved", "a missing source-union payload inventory is not treated as closed-empty metadata");
  assert.equal(missing.reason, "Native storage TYPE demand requires its admitted source union payload inventory.",
    "the refusal identifies the actual missing native TYPE evidence");
  const exhausted = selectRustNativeFutureTypeDemand(rustVecTargetType(future), emptyRustTypeDefinitions, () => false, 0);
  assert.equal(exhausted.kind, "unresolved", "the real existing native projection budget is not bypassed");
  assert.equal(exhausted.reason, "Native storage TYPE demand exceeds its bounded carrier projection budget.",
    "budget exhaustion is not an identity result");
});

test("native array entry admits a real transfer or native reference identity, never a deep array clone", () => {
  const number = rustSourcePrimitiveTargetType("float64");
  const vector = rustVecTargetType(number);
  const optional = rustOptionTargetType(vector);
  for (const read of ["clone", "borrow", "copy", undefined]) {
    assert.equal(typeof rustUnionEntryTransferIssue(vector, optional, read, false, emptyRustTypeDefinitions), "string",
      `${read ?? "missing"}: an owned native array needs an actual transfer`);
  }
  assert.equal(rustUnionEntryTransferIssue(vector, optional, "move", false, emptyRustTypeDefinitions), undefined,
    "a fresh or transferred Vec keeps its backing allocation");
  assert.equal(typeof rustUnionEntryTransferIssue(vector, optional, "move", true, emptyRustTypeDefinitions), "string",
    "a selected borrowed native array cannot be moved out of its storage");
  const shared = rustJsArrayTargetType(number);
  assert.equal(rustUnionEntryTransferIssue(shared, rustOptionTargetType(shared), "clone", false, emptyRustTypeDefinitions), undefined,
    "the actual JsArray Clone retains the same Rc allocation");
  const reference = { kind: "reference", mutable: false, referent: vector };
  assert.equal(rustUnionEntryTransferIssue(reference, rustOptionTargetType(reference), "copy", false, emptyRustTypeDefinitions), undefined,
    "copying an actual native reference preserves its referent identity");
});

test("one checked Body type has one native enum independently of its value subjects", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
type Body = ${bodyType};
export function select(first: Body, second: Body): Body {
  let selected: Body = first;
  selected = second;
  return selected;
}
` } });
  const ast = program.source.ast;
  const parameters = [];
  const entries = [];
  const visit = node => {
    if (ast.is.IsParameterDeclaration(node) && ["first", "second"].includes(ast.text(ast.name(node)))) parameters.push(node);
    if (ast.is.IsIdentifier(node) && ["first", "second"].includes(ast.text(node)) && ast.name(ast.parent(node)) !== node) entries.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(parameters.length, 2, "both authored Body parameters are checked");
  const carriers = parameters.map(node => program.records.sourceParameterAbi.get(node)?.valueCarrier);
  assert.equal(carriers.every(carrier => carrier !== undefined), true, "both parameters have required native ABI carriers");
  assert.equal(rustTargetTypeRefEquals(carriers[0], carriers[1]), true, "value subjects cannot select different enum layouts");
  assert.equal(entries.length, 2, "the declaration and assignment have exactly their two real source operands");
  for (const node of entries) {
    assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(node)?.carrier, carriers[0]), true,
      `${ast.text(node)}: the same checked Body retains the same native enum`);
    assert.equal(program.records.contextualValueConversion.get(node) === undefined, true,
      `${ast.text(node)}: identical enum assignment needs no conversion`);
  }
});

test("native array union literals retain checked indexed mutation without selecting JS APIs", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
type Body = boolean | unknown[];
function inspect(body: Body): boolean {
  if (typeof body === "boolean") return body;
  body[0] = 2;
  return body[0] === 2;
}
function dynamicProbe(state: boolean[]): Body {
  state[0] = !state[0];
  return [1];
}
function staticProbe(state: boolean[]): boolean {
  state[0] = !state[0];
  return state[0];
}
export function main(): void {
  if (!inspect([1]) || !inspect(true)) throw new Error("native array union storage changed");
  const dynamicState = [false];
  const staticState = [false];
  if (typeof dynamicProbe(dynamicState) !== "object" || !dynamicState[0] ||
      typeof staticProbe(staticState) !== "boolean" || !staticState[0]) {
    throw new Error("native runtime and static category operands must execute exactly once");
  }
}
main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("union-layout-native-indexed-storage", result.artifacts, { run: true });
});

test("JSON-shaped union literals retain checked array push/read and every other arm on the selected JS API", { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
type Body = ${bodyType};
function inspect(body: Body): boolean {
  if (Array.isArray(body)) {
    body.push(2);
    return body.length === 2 && body[0] === 1 && body[1] === 2;
  }
  if (body === null) return true;
  if (typeof body === "string") return body === "text";
  if (typeof body === "number") return body === 7;
  if (typeof body === "boolean") return body;
  return body["name"] === "entry";
}
export function main(): void {
  if (!inspect([1]) || !inspect(null) || !inspect("text") || !inspect(7) || !inspect(true) || !inspect({ name: "entry" })) {
    throw new Error("union layout, guarded array mutation, or retained arm changed");
  }
}
main();
` } });
    assertNoTargetDiagnostics(result.diagnostics);
    assert.doesNotMatch(rustSourceText(result), /transmute|from_raw_parts/u, "layout identity is not repaired by unsafe reinterpretation");
    validateGeneratedProject("union-layout-identity-js", result.artifacts, { run: true });
});

const aliasedEntries = [
  ["declaration", "const body: Body = values; values[0] = 1; return typeof body === 'boolean' ? 0 : body[0] === 1 ? 1 : 0;"],
  ["assignment", "let body: Body = false; body = values; values[0] = 1; return typeof body === 'boolean' ? 0 : body[0] === 1 ? 1 : 0;"],
  ["return", "const read = (): Body => values; values[0] = 1; const body = read(); values[0] = 2; return typeof body === 'boolean' ? 0 : body[0] === 2 ? 1 : 0;"],
  ["assertion", "const body = values as Body; values[0] = 1; return typeof body === 'boolean' ? 0 : body[0] === 1 ? 1 : 0;"],
  ["parenthesized assertion", "const body = ((values as Body)); values[0] = 1; return typeof body === 'boolean' ? 0 : body[0] === 1 ? 1 : 0;"],
  ["nested identity assertion", "const body = (values as Body) as Body; values[0] = 1; return typeof body === 'boolean' ? 0 : body[0] === 1 ? 1 : 0;"],
  ["satisfies assertion", "const body = (values as Body) satisfies Body; values[0] = 1; return typeof body === 'boolean' ? 0 : body[0] === 1 ? 1 : 0;"],
  ["identity non-null assertion", "const body = (values as Body)!; values[0] = 1; return typeof body === 'boolean' ? 0 : body[0] === 1 ? 1 : 0;"],
  ["source call", "const count = accept(values); values[0] = 1; return count;"],
  ["provider input", "const bodies: Body[] = [false]; bodies[0] = values; values[0] = 1; return typeof bodies[0] === 'boolean' ? 0 : bodies[0][0] === 1 ? 1 : 0;"],
];

for (const [label, entry] of aliasedEntries) {
  test(`native ${label} refuses an aliased Vec entry at the exact pre-seal identity owner`, () => {
    const { source, result } = compileRust({ files: { "index.ts": `
type Body = boolean | unknown[];
function accept(body: Body): number { return typeof body === "boolean" ? 0 : body[0] === 0 ? 1 : 0; }
export function enter(): number {
  const values: unknown[] = [0];
  ${entry}
}
` } });
    assert.equal(result.diagnostics.length, 1, `${label}: one precise source refusal, not an arbitrary diagnostic: ${
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message} (${
        issue.sourceNode === undefined ? "absent" : source.ast.kindName(issue.sourceNode)})`).join("; ")}`);
    const diagnostic = result.diagnostics[0];
    assert.equal(diagnostic.code, identityCode, `${label}: the exact native identity admission owns the refusal`);
    assert.equal(diagnostic.message.startsWith("A native union entry requires an identity-preserving array transfer;"), true,
      `${label}: the refusal identifies the actual unsupported borrowed/aliased transfer`);
    assert.equal(diagnostic.sourceNode !== undefined, true, `${label}: the original source entry is retained`);
    assert.equal(source.ast.text(diagnostic.sourceNode), "values", `${label}: refusal is attached to the actual array value`);
    assert.equal(result.artifacts.length, 0, `${label}: refused storage never reaches native publication`);
    assert.equal(result.program === undefined, true, `${label}: no sealed program escapes the rejected admission`);
  });
}

test("native assertion materializes an owned union result once without copying its transferred array", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
type Body = boolean | unknown[];
function create(state: boolean[]): unknown[] {
  state[0] = !state[0];
  return [2];
}
export function main(): void {
  const state = [false];
  const body = (((create(state) as Body) as Body) satisfies Body)!;
  if (!state[0] || typeof body === "boolean" || body[0] !== 2) {
    throw new Error("owned union assertion changed evaluation or its transferred payload");
  }
}
main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.doesNotMatch(rustSourceText(result), /create\([^;]*\.clone\(\)/su,
    "a materialized assertion result is not another stored native union read");
  validateGeneratedProject("union-layout-owned-assertion", result.artifacts, { run: true });
});

test("an actual aliasable JS array retains identity when entering the type-only union arm", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
type Body = boolean | unknown[];
export function main(): void {
  const values: unknown[] = [];
  const body: Body = values;
  values.push(1);
  if (!Array.isArray(body) || body.length !== 1 || body[0] !== 1) throw new Error("array alias identity changed");
  body.push(2);
  if (values.length !== 2 || values[1] !== 2) throw new Error("reverse array alias identity changed");
}
main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("union-layout-shared-array-identity", result.artifacts, { run: true });
});

for (const surface of [undefined, "js"]) {
  test(`the CLR reference-array counterpart preserves union-entry alias identity on ${surface ?? "native"}`, { timeout: 300_000 }, async () => {
    const { compileCsharpSource, assertCsharpCompilationSucceeded } = await import("../../../../tsonic-csharp/test/helpers/direct-csharp-session.mjs");
    const { executeCsharpConstruction } = await import("../../../../tsonic-csharp/test/helpers/native-construction.mjs");
    const compiled = compileCsharpSource({ surface, sourceText: surface === undefined ? `
type Body = boolean | unknown[];
export function run(): boolean {
  const values: unknown[] = [0];
  const first: Body = values;
  const second: Body = first;
  values[0] = 1;
  if (typeof second === "boolean" || second[0] !== 1) return false;
  second[0] = 2;
  return values[0] === 2;
}
` : `
type Body = boolean | unknown[];
export function run(): boolean {
  const values: unknown[] = [];
  const first: Body = values;
  const second: Body = first;
  values.push(1);
  if (!Array.isArray(second) || second.length !== 1 || second[0] !== 1) return false;
  second.push(2);
  return values.length === 2 && values[1] === 2;
}
` });
    assertCsharpCompilationSucceeded(compiled);
    executeCsharpConstruction(compiled, `union-layout-identity-${surface ?? "native"}`);
  });
}
