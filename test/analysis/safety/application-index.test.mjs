import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { compileRust } from "../../helpers/rust-session.mjs";
import { createRustSafetyApplicationFactIndex } from "../../../dist/analysis/safety/application-index.js";

// Paired with the C# owner test test/analysis/safety/application-index.test.mjs: the same sources and the same
// expected membership. Membership is decided once by @tsonic/target-api's createTargetSafetyApplicationIndex.
const header = `import { safety, unsafecontext } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export class Value {
  private stored: int32 = 1;
  get current(): int32 { return this.stored; }
  set current(value: int32) { this.stored = value; }
}
export class Built {
  value: int32;
  constructor(value: int32) { this.value = value; }
}
export interface Indexed { [key: string]: int32; }
`;
const cases = [
  ["a getter contract covers only the get accessor",
    `safety<Value>().property(value => value.current).getter().requiresunsafe();`,
    { get: ["getter:requires-unsafe"], set: [] }],
  ["a setter contract covers only the set accessor",
    `safety<Value>().property(value => value.current).setter().requiresunsafe();`,
    { get: [], set: ["setter:requires-unsafe"] }],
  ["getter and setter contracts stay independent",
    `safety<Value>().property(value => value.current).getter().safe();
safety<Value>().property(value => value.current).setter().requiresunsafe();`,
    { get: ["getter:safe"], set: ["setter:requires-unsafe"] }],
  ["a parenthesized builder statement is still one application",
    `(safety<Value>().property(value => value.current).getter().requiresunsafe());
export function read(value: Value): int32 { return unsafecontext(value.current); }`,
    { get: ["getter:requires-unsafe"], set: [] }],
  ["a constructor contract covers the class and its constructor",
    `safety<Built>().constructor().requiresunsafe();`,
    { class: ["constructor:requires-unsafe"], constructor: ["constructor:requires-unsafe"] }],
  ["an indexer getter contract covers the index signature",
    `safety<Indexed>().indexer(value => value[""]).getter().requiresunsafe();`,
    { index: ["getter:requires-unsafe"] }],
];

function safetyIndex(body) {
  const { result, source } = compileRust({ files: { "index.ts": `${header}${body}\n` } });
  const program = createTargetSourceProgram(source);
  const { ast } = program;
  const sourceFiles = program.sourceFiles.filter(file => file !== undefined && !ast.isDeclarationFile(file));
  const index = createRustSafetyApplicationFactIndex({ ast, sourceFiles, sourceFacts: program.sourceFacts, navigation: program.navigation });
  return { result, ast, sourceFiles, index };
}

function membership(body) {
  const { ast, sourceFiles, index } = safetyIndex(body);
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  sourceFiles.forEach(visit);
  const find = predicate => {
    const found = nodes.find(predicate);
    assert.ok(found);
    return found;
  };
  const placements = node => index.safetyApplication.get(node)
    .map(application => `${application.applicationPlacement}:${application.contract}`);
  const parenthesized = nodes.filter(node => ast.is.IsExpressionStatement(node))
    .map(node => ast.as.AsExpressionStatement(node).Expression)
    .filter(expression => ast.is.IsParenthesizedExpression(expression));
  return {
    get: placements(find(node => ast.is.IsGetAccessorDeclaration(node))),
    set: placements(find(node => ast.is.IsSetAccessorDeclaration(node))),
    class: placements(find(node => ast.is.IsClassDeclaration(node) && ast.text(ast.name(node)) === "Built")),
    constructor: placements(find(node => ast.is.IsConstructorDeclaration(node))),
    index: placements(find(node => ast.is.IsIndexSignatureDeclaration(node))),
    parenthesizedOperations: parenthesized.map(expression => ({
      exact: index.safetySubjectOperation.get(expression)?.kind,
      expression: index.safetyOperation.get(expression)?.kind,
    })),
  };
}

for (const [name, body, expected] of cases) {
  test(`Rust safety membership: ${name}`, { timeout: 300_000 }, () => {
    const actual = membership(body);
    for (const [declaration, placements] of Object.entries(expected)) {
      assert.deepEqual(actual[declaration], placements, declaration);
    }
  });
}

test("Rust finds a parenthesized builder statement as a compile-time safety operation", { timeout: 300_000 }, () => {
  const actual = membership(cases[3][1]);
  assert.deepEqual(actual.parenthesizedOperations, [{ exact: undefined, expression: "safety-builder" }]);
});

const findingCases = [
  ["opposite contracts on one declaration conflict once",
    `export function selected(value: int32): int32 { return value; }
safety(selected).safe();
safety(selected).requiresunsafe();`,
    ["RUST_SAFETY_CONTRACT_CONFLICT"]],
  ["a setter placement on a getter-only property resolves no target, beside a setter conflict",
    `export class Snapshot { get only(): int32 { return 1; } }
safety<Snapshot>().property(snapshot => snapshot.only).setter().requiresunsafe();
safety<Value>().property(value => value.current).setter().safe();
safety<Value>().property(value => value.current).setter().requiresunsafe();`,
    ["RUST_SAFETY_CONTRACT_CONFLICT", "RUST_SAFETY_APPLICATION_TARGET_NOT_RESOLVED"]],
  ["matching contracts produce no shared finding",
    `safety<Value>().property(value => value.current).getter().requiresunsafe();`,
    []],
];

for (const [name, body, codes] of findingCases) {
  test(`Rust reports exactly the shared safety findings: ${name}`, { timeout: 300_000 }, () => {
    const { result, sourceFiles, index } = safetyIndex(body);
    const expected = sourceFiles.flatMap(sourceFile => {
      const findings = index.findings.get(sourceFile);
      return [
        ...findings.conflicts.map(conflict => ({ code: "RUST_SAFETY_CONTRACT_CONFLICT", node: conflict.first.sourceSubject })),
        ...findings.applications.filter(entry => entry.status === "target-not-resolved")
          .map(entry => ({ code: "RUST_SAFETY_APPLICATION_TARGET_NOT_RESOLVED", node: entry.application.sourceSubject })),
      ];
    });
    assert.deepEqual(expected.map(entry => entry.code), codes, "the shared findings name the expected classes");
    const shared = new Set(["RUST_SAFETY_CONTRACT_CONFLICT", "RUST_SAFETY_APPLICATION_TARGET_NOT_RESOLVED"]);
    const reported = result.diagnostics.filter(diagnostic => shared.has(diagnostic.code));
    assert.deepEqual(reported.map(diagnostic => diagnostic.code), codes);
    assert.deepEqual(reported.map((diagnostic, position) => diagnostic.sourceNode === expected[position].node), codes.map(() => true),
      "each diagnostic is reported at its finding's application subject");
    const statuses = sourceFiles.flatMap(sourceFile => index.findings.get(sourceFile).applications.map(entry => entry.status));
    assert.equal(statuses.length, (body.match(/\.(?:safe|requiresunsafe)\(\)/gu) ?? []).length, "every application has one status");
  });
}
