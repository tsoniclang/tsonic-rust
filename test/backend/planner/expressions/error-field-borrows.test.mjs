import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, rustSourceText } from "../../../helpers/rust-session.mjs";
import { rustNativeFixtureNodes } from "../../../helpers/records.mjs";
import { analyzeRustErrorFieldBorrows } from "../../../../dist/analysis/operations/error-field-borrows.js";
import { createRustErrorFieldProducer } from "../../../../dist/analysis/program/records/errors/error-field-borrows.js";
import { assertRustRequiredRecords } from "../../../../dist/analysis/program/records/objects/required-records.js";

// Error property reads in comparisons borrow the Error's field where nothing later can change it, and take an
// owned value first where a later operand writes the same Error. Analysis seals the decision
// (errorFieldEmission / errorFieldSnapshot, analyzeRustErrorFieldBorrows); the cases compile real programs and
// check the generated comparison. Cases about the analysis queries replace only errorStorageDemands.
const mutate = "function mutate(e: Error): string { e.message = 'changed'; return 'changed'; }\n";

function probe(source, surfaces = []) {
  const { result } = compileRust({ surfaces, files: { "index.ts": source } });
  assert.deepEqual(result.diagnostics, []);
  const body = rustSourceText(result).match(/pub fn probe[\s\S]*?\n\}\n/u)?.[0];
  assert.equal(body !== undefined, true, "the probe function is emitted");
  return body;
}

// Runs the analysis owner over a real program with errorStorageDemands answering through `answer`.
function borrowDecisions(source, answer, surfaces = []) {
  const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
  const queries = [];
  const selected = { ...program, errorStorageDemands: { ...program.errorStorageDemands,
    invalidationFor: (subject, expression, pure) => { queries.push({ subject, expression, pure }); return answer(expression); } } };
  const producer = createRustErrorFieldProducer(() => {});
  const required = [];
  const issues = analyzeRustErrorFieldBorrows(selected, rustNativeFixtureNodes(program), producer, required);
  const { ast } = program.source;
  let comparison;
  const visit = node => {
    if (comparison === undefined && ast.is.IsBinaryExpression(node) && producer.records.errorFieldEmission.get(ast.as.AsBinaryExpression(node).Left)?.kind === "property")
      comparison = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(comparison !== undefined, true, "one Error property comparison");
  const left = ast.as.AsBinaryExpression(comparison).Left;
  const right = ast.as.AsBinaryExpression(comparison).Right;
  assert.equal(required.some(requirement => requirement.subject === left && requirement.family === "errorFieldEmission"), true,
    "the real observation owner registers its final publication before sealing");
  assertRustRequiredRecords({ ...program.records, ...producer.records }, required);
  return { program, ast, queries, issues, left, right, records: producer.records };
}

test("immutable native Error name/message never acquire mutation guards or snapshots", () => {
  for (const property of ["name", "message"]) {
    const body = probe(`function read(e: Error): string { return e.name; }
export function probe(error: Error): boolean { return error.${property} === read(error); }`);
    assert.doesNotMatch(body, /error_snapshot/u, property);
    const decisions = borrowDecisions(`function read(e: Error): string { return e.name; }
export function probe(error: Error): boolean { return error.${property} === read(error); }`, () => ({ kind: "invalidated" }));
    assert.equal(decisions.records.errorFieldEmission.get(decisions.left).guarded, false);
    assert.deepEqual(decisions.queries, []);
  }
});

test("actual same-owner writes consume guarded fields before mutation", () => {
  for (const property of ["name", "message"]) {
    const body = probe(`${mutate}export function probe(error: Error): boolean { return error.${property} === mutate(error); }`);
    assert.match(body, new RegExp(`let error_snapshot = String::from\\(rt::ErrorObject::error_${property}\\(&error(?:\\.clone\\(\\))?\\)\\);\\s*error_snapshot\\s*\\}\\) == core::convert::AsRef::<str>::as_ref\\(&mutate\\(error\\)\\)`, "u"));
    assert.equal(Array.from(body.matchAll(/mutate\(error\)/gu)).length, 1,
      `${property}: the owned snapshot precedes exactly one same-owner mutation`);
  }
  const stack = probe(`${mutate}export function probe(error: Error): boolean { return error.stack === mutate(error); }`);
  assert.match(stack, /error_stack\(&error(?:\.clone\(\))?\)\s*\.map\(String::from\)[\s\S]*mutate\(error/u, "the stack is owned before the write");
  const decisions = borrowDecisions(`${mutate}export function probe(error: Error): boolean { return error.message === mutate(error); }`,
    () => ({ kind: "invalidated" }));
  assert.equal(decisions.records.errorFieldSnapshot.get(decisions.left, decisions.right), true);
  assert.equal(decisions.ast.text(decisions.queries[0].subject), "error");
});

test("native captured stacks release their guard before exact recapture", () => {
  const decisions = borrowDecisions(`${mutate}export function probe(error: Error): boolean { return error.stack === mutate(error); }`,
    () => ({ kind: "invalidated" }));
  assert.equal(decisions.records.errorFieldEmission.get(decisions.left).guarded, true);
  assert.equal(decisions.records.errorFieldSnapshot.get(decisions.left, decisions.right), true);
});

test("valid uncertain effects release guarded fields while actual analysis failures still reject", () => {
  for (const property of ["name", "message", "stack"]) {
    const source = `${mutate}export function probe(error: Error): boolean { return error.${property} === mutate(error); }`;
    const unproven = borrowDecisions(source, () => ({ kind: "unproven", reason: "exact checked native receiver has an open admission domain" }));
    assert.equal(unproven.records.errorFieldSnapshot.get(unproven.left, unproven.right), true, property);
    assert.deepEqual(unproven.issues, []);
    const unresolved = borrowDecisions(source, () => ({ kind: "unresolved", reason: "exact storage analysis exhausted its finite budget" }));
    assert.equal(unresolved.records.errorFieldSnapshot.get(unresolved.left, unresolved.right), undefined);
    assert.equal(unresolved.issues.length === 1 && unresolved.issues[0].message.includes("finite budget"), true,
      "missing or exhausted evidence never becomes a conservative runtime fallback");
  }
});

test("read-only callbacks and unrelated writes remain zero-copy instead of all-invocation snapshots", () => {
  for (const source of [
    "function read(e: Error): string { return e.name; }\nexport function probe(error: Error): boolean { return error.message === read(error); }",
    "let counter = 0;\nfunction other(): string { counter = counter + 1; return 'x'; }\nexport function probe(error: Error): boolean { return error.message === other(); }",
    "export function probe(error: Error): boolean { return error.message === 'x'; }",
  ]) assert.doesNotMatch(probe(source), /error_snapshot/u);
});

test("pure provider evidence exempts its invocation, not independently evaluated mutations", () => {
  const source = `${mutate}export function probe(error: Error, text: string): boolean { mutate(error); return error.message === text[0]; }`;
  assert.doesNotMatch(probe(source, ["js"]), /error_snapshot/u);
  const decisions = borrowDecisions(source, () => ({ kind: "preserved" }), ["js"]);
  const [query] = decisions.queries;
  assert.equal(query.pure.has(decisions.right), true);
  assert.equal([...query.pure].some(node => decisions.ast.is.IsIdentifier(node)), false, "the independently evaluated argument is not exempt");
});

test("transparent syntax retains the original selected Error owner", () => {
  const decisions = borrowDecisions(`${mutate}export function probe(error: Error): boolean { return (error.message) === mutate(error); }`,
    () => ({ kind: "invalidated" }));
  assert.equal(decisions.ast.text(decisions.queries[0].subject), "error");
  assert.match(probe(`${mutate}export function probe(error: Error): boolean { return (error.message) === mutate(error); }`), /error_snapshot/u);
});

test("shared ErrorField reads borrow native str; optional presence does not copy captured stack", () => {
  assert.match(probe(`${mutate}export function probe(error: Error): boolean { mutate(error); return error.message === 'stack'; }`),
    /&\*rt::ErrorObject::error_message\(&error\) == "stack"/u);
  assert.doesNotMatch(probe(`${mutate}export function probe(error: Error): boolean { mutate(error); return error.stack !== undefined; }`),
    /map\(String::from\)/u);
});

test("optional stack equality borrows the original guard without a String snapshot", () => {
  const body = probe(`${mutate}export function probe(error: Error): boolean { mutate(error); return error.stack === 'trace'; }`);
  assert.match(body, /rt::ErrorObject::error_stack\(&error\)\.as_deref\(\)/u);
  assert.doesNotMatch(body, /map\(String::from\)|error_snapshot/u);
});

test("optional stack equality consumes its guard before a same-owner mutation or recapture", () => {
  const body = probe(`${mutate}export function probe(error: Error): boolean { return error.stack === mutate(error); }`);
  assert.match(body, /error_stack\(&error(?:\.clone\(\))?\)\s*\.map\(String::from\)\s*\.as_deref\(\)/u);
});

test("stack/string equality uses borrowed literals and native str guarded views", () => {
  assert.match(probe(`${mutate}export function probe(error: Error): boolean { mutate(error); return error.message === 'stack'; }`),
    /&\*rt::ErrorObject::error_message\(&error\) == "stack"/u);
  assert.match(probe(`${mutate}export function probe(error: Error): boolean { mutate(error); return error.stack === 'trace'; }`),
    /== Some\("trace"\)/u);
});
