import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustUnionEntryTransferIssue } from "../../../dist/policy/conversions/union-injection.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustJsArrayTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType, rustVecTargetType } from "../../../dist/target-model/types/index.js";

const bodyType = "string | number | boolean | null | Record<string, unknown> | unknown[]";
const identityCode = "RUST_UNION_ENTRY_STORAGE_IDENTITY_NOT_PRESERVED";

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

for (const surfaces of [[], ["js"]]) {
  test(`JSON-shaped union literals retain checked array push/read and every other arm on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
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
    validateGeneratedProject(`union-layout-identity-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

const aliasedEntries = [
  ["declaration", "const body: Body = values; values.push(1); return Array.isArray(body) ? body.length : 0;"],
  ["assignment", "let body: Body = false; body = values; values.push(1); return Array.isArray(body) ? body.length : 0;"],
  ["return", "const read = (): Body => values; values.push(1); const body = read(); values.push(2); return Array.isArray(body) ? body.length : 0;"],
  ["assertion", "const body = values as Body; values.push(1); return Array.isArray(body) ? body.length : 0;"],
  ["source call", "const count = accept(values); values.push(1); return count;"],
  ["provider input", "const bodies: Body[] = []; bodies.push(values); values.push(1); return bodies.length;"],
];

for (const [label, entry] of aliasedEntries) {
  test(`native ${label} refuses an aliased Vec entry at the exact pre-seal identity owner`, () => {
    const { source, result } = compileRust({ files: { "index.ts": `
type Body = boolean | unknown[];
function accept(body: Body): number { return Array.isArray(body) ? body.length : 0; }
export function enter(): number {
  const values: unknown[] = [];
  ${entry}
}
` } });
    assert.equal(result.diagnostics.length, 1, `${label}: one precise source refusal, not an arbitrary diagnostic`);
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
    const compiled = compileCsharpSource({ surface, sourceText: `
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
