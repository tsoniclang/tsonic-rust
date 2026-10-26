import assert from "node:assert/strict";
import test from "node:test";
import { checkedRustCompileInput } from "../../helpers/rust-session.mjs";
import { createRustSafetyApplicationFactIndex } from "../../../dist/analysis/safety/application-index.js";

// Membership is decided once by @tsonic/target-api's createTargetSafetyApplicationIndex.
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

function membership(body) {
  const { source } = checkedRustCompileInput({ files: { "index.ts": `${header}${body}\n` } });
  const { ast } = source;
  const sourceFiles = source.sourceFiles.filter(file => !ast.isDeclarationFile(file));
  assert.equal(sourceFiles.length, 1, "the complete authored safety source is checked");
  const safetyApplications = createRustSafetyApplicationFactIndex({
    ast, sourceFiles, sourceFacts: source.sourceFacts, navigation: source.navigation,
  });
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  sourceFiles.forEach(visit);
  const find = predicate => {
    const found = nodes.find(predicate);
    assert.ok(found);
    return found;
  };
  const placements = node => safetyApplications.forDeclaration(node)
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
      exact: safetyApplications.operationForSubject(expression)?.kind,
      expression: safetyApplications.operationForExpression(expression)?.kind,
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
